import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import type { AndroidApkMetadata, DriveReleaseFile, PublicAndroidRelease } from './androidReleasePublisher';

type FetchResponse = {
  body?: ReadableStream<Uint8Array> | null;
  headers?: Headers;
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

type StreamingRequestInit = RequestInit & { duplex?: 'half' };
type FetchLike = (url: string, init?: StreamingRequestInit) => Promise<FetchResponse>;

export type SsmTarget = {
  instanceId?: string;
  pingStatus?: string;
};

export function selectSingleOnlineSsmTarget(targets: SsmTarget[]): string {
  if (targets.length !== 1) {
    throw new Error(`expected one SSM target; got ${targets.length}`);
  }
  const target = targets[0];
  if (target.instanceId === undefined || target.instanceId === '') {
    throw new Error('SSM target instance ID is missing.');
  }
  if (target.pingStatus !== 'Online') {
    throw new Error(`SSM target is not online: ${target.instanceId}`);
  }
  return target.instanceId;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function sha256ResponseBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256');
  const reader = body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return hash.digest('hex');
      }
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function uploadDriveFileResumable(input: {
  apk: AndroidApkMetadata;
  apkPath: string;
  fetchImpl?: FetchLike;
  fileName: string;
  folderId: string;
  token: string;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const size = statSync(input.apkPath).size;
  const metadata = {
    appProperties: {
      packageName: input.apk.packageName,
      sha256: input.apk.sha256,
      sourceSha: input.apk.sourceSha,
      versionCode: String(input.apk.versionCode),
      versionName: input.apk.versionName,
    },
    mimeType: 'application/vnd.android.package-archive',
    name: input.fileName,
    parents: [input.folderId],
  };
  const sessionResponse = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,sha256Checksum,appProperties',
    {
      body: JSON.stringify(metadata),
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'application/vnd.android.package-archive',
      },
      method: 'POST',
    },
  );
  if (!sessionResponse.ok) {
    throw new Error(`Drive resumable upload initialization failed with HTTP ${sessionResponse.status}.`);
  }
  const uploadUrl = sessionResponse.headers?.get('location');
  if (uploadUrl === null || uploadUrl === undefined || !isApprovedDriveUploadUrl(uploadUrl)) {
    throw new Error('Drive resumable upload did not return an approved session URL.');
  }

  const body = Readable.toWeb(createReadStream(input.apkPath)) as ReadableStream<Uint8Array>;
  const uploadResponse = await fetchImpl(uploadUrl, {
    body: body as BodyInit,
    duplex: 'half',
    headers: {
      'Content-Length': String(size),
      'Content-Type': 'application/vnd.android.package-archive',
    },
    method: 'PUT',
  });
  if (!uploadResponse.ok) {
    throw new Error(`Drive APK upload failed with HTTP ${uploadResponse.status}.`);
  }
  const uploaded = await uploadResponse.json() as {
    appProperties?: { sha256?: string; sourceSha?: string };
    id?: string;
    sha256Checksum?: string;
  };
  if (uploaded.sha256Checksum !== input.apk.sha256 || uploaded.appProperties?.sha256 !== input.apk.sha256) {
    throw new Error('Drive upload checksum does not match the locally built APK.');
  }
  if (uploaded.appProperties.sourceSha !== input.apk.sourceSha) {
    throw new Error('Drive upload provenance does not match the verified source commit.');
  }
  if (uploaded.id === undefined || uploaded.id === '') {
    throw new Error('Drive upload did not return a file id.');
  }
  return uploaded.id;
}

function isApprovedDriveUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'www.googleapis.com'
      && (url.pathname === '/upload/drive/v3/files' || url.pathname.startsWith('/upload/drive/v3/files/'))
      && url.searchParams.has('upload_id');
  } catch {
    return false;
  }
}

export async function fetchOptionalRelease(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<PublicAndroidRelease | undefined> {
  const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}/routes-app/release/android`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

  if (response.status === 404) {
    return undefined;
  }

  return readReleaseResponse(response);
}

export async function fetchRelease(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<PublicAndroidRelease> {
  const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}/routes-app/release/android`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

  return readReleaseResponse(response);
}

export async function listDriveFiles(
  input: {
    fetchImpl?: FetchLike;
    folderId: string;
    token: string;
  },
): Promise<DriveReleaseFile[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const files: DriveReleaseFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      fields: 'nextPageToken,files(id,name,appProperties)',
      pageSize: '1000',
      q: `'${input.folderId}' in parents and trashed=false`,
    });
    if (pageToken !== undefined) {
      params.set('pageToken', pageToken);
    }

    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${input.token}` },
    });
    if (!response.ok) {
      throw new Error(`Drive folder listing failed with HTTP ${response.status}.`);
    }
    const body = await response.json() as {
      files?: { appProperties?: { sha256?: string; sourceSha?: string }; id?: string; name?: string }[];
      nextPageToken?: string;
    };

    files.push(...(body.files?.flatMap((file) => {
      if (file.id === undefined || file.name === undefined) {
        return [];
      }
      return [{
        id: file.id,
        name: file.name,
        sha256: file.appProperties?.sha256,
        ...(file.appProperties?.sourceSha === undefined ? {} : { sourceSha: file.appProperties.sourceSha }),
      }];
    }) ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken !== undefined && pageToken !== '');

  return files;
}

export async function ensureDriveAnyoneReaderPermission(
  input: {
    fetchImpl?: FetchLike;
    fileId: string;
    token: string;
  },
): Promise<'created' | 'present'> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const permissionsResponse = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions?fields=permissions(type,role)`,
    {
      headers: { Authorization: `Bearer ${input.token}` },
    },
  );
  if (!permissionsResponse.ok) {
    throw new Error(`Drive permission inspection failed with HTTP ${permissionsResponse.status}.`);
  }

  const permissionsBody = await permissionsResponse.json() as {
    permissions?: { role?: string; type?: string }[];
  };
  const hasPublicReader = permissionsBody.permissions?.some((permission) => (
    permission.type === 'anyone' && permission.role === 'reader'
  )) ?? false;
  if (hasPublicReader) {
    return 'present';
  }

  const createResponse = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions`,
    {
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!createResponse.ok) {
    throw new Error(`Drive public permission update failed with HTTP ${createResponse.status}.`);
  }

  return 'created';
}

function readReleaseResponse(response: FetchResponse): Promise<PublicAndroidRelease> {
  if (!response.ok) {
    throw new Error(`Android release endpoint returned HTTP ${response.status}.`);
  }

  return response.json().then((body) => {
    const envelope = body as { data?: PublicAndroidRelease };
    if (envelope.data === undefined) {
      throw new Error('Android release endpoint response is missing data.');
    }
    return envelope.data;
  });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}
