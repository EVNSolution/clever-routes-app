import type { DriveReleaseFile, PublicAndroidRelease } from './androidReleasePublisher';

type FetchResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponse>;

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
      files?: { appProperties?: { sha256?: string }; id?: string; name?: string }[];
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
