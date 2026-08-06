import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildDriveDownloadUrl,
  buildVersionedApkFileName,
  createAndroidReleasePublicationPlan,
  parseAaptBadging,
  type AndroidApkMetadata,
  type ReleaseSourceState,
} from './androidReleasePublisher';
import {
  ensureDriveAnyoneReaderPermission,
  fetchOptionalRelease,
  fetchRelease,
  listDriveFiles,
} from './androidReleasePublisherCliSupport';

type CliArgs = {
  apk?: string;
  apkSha256?: string;
  deliveryServerBaseUrl: string;
  execute: boolean;
  mode: 'publish' | 'bootstrap-legacy';
  minimumVersionCode?: number;
  ssmInstanceId?: string;
  ssmRegion: string;
};

const approvedDriveFolderId = '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ';
const legacyDriveFileId = '1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = readSourceState();
  const gcloudAccount = readGcloudAccount();
  const existingFiles = await listDriveFiles({
    folderId: approvedDriveFolderId,
    token: readGcloudAccessToken(),
  });
  const currentRelease = await fetchOptionalRelease(args.deliveryServerBaseUrl);
  const apk = args.mode === 'publish' ? readApkMetadata(args.apk) : undefined;
  const plan = createAndroidReleasePublicationPlan({
    apk,
    bootstrapSha256: args.apkSha256,
    currentRelease,
    drive: {
      existingFiles,
      folderId: approvedDriveFolderId,
    },
    gcloudAccount,
    minimumVersionCode: args.minimumVersionCode,
    mode: args.mode,
    publicInstallUrl: `${trimTrailingSlash(args.deliveryServerBaseUrl)}/routes-app`,
    source,
    ssm: {
      instanceId: requireValue(args.ssmInstanceId, '--ssm-instance-id is required.'),
      region: args.ssmRegion,
    },
  });

  if (!args.execute) {
    console.log(JSON.stringify({
      dryRun: true,
      plan,
    }, null, 2));
    return;
  }

  const downloadUrl = !plan.needsDriveUpload
    ? plan.downloadUrl
    : args.mode === 'bootstrap-legacy'
    ? buildDriveDownloadUrl(legacyDriveFileId)
    : await uploadImmutableApk(requireValue(args.apk, '--apk is required.'), requireValue(apk, 'APK metadata is required.'));
  await ensureDriveAnyoneReaderPermission({
    fileId: extractDriveFileId(downloadUrl),
    token: readGcloudAccessToken(),
  });
  const ssmCommand = plan.ssmCommand.map((part) => part.replace('NEW_FILE_ID_AFTER_UPLOAD', extractDriveFileId(downloadUrl)));
  runSsmPublishAndWait(ssmCommand, {
    instanceId: requireValue(args.ssmInstanceId, '--ssm-instance-id is required.'),
    region: args.ssmRegion,
  });

  const publishedRelease = await fetchRelease(args.deliveryServerBaseUrl);
  const publishedSha256 = await downloadSha256(`${trimTrailingSlash(args.deliveryServerBaseUrl)}/routes-app/download`);
  const verifiedPlan = createAndroidReleasePublicationPlan({
    apk,
    bootstrapSha256: args.apkSha256,
    currentRelease,
    drive: {
      existingFiles: [
        ...existingFiles,
        ...(plan.needsDriveUpload ? [{
          id: extractDriveFileId(downloadUrl),
          name: requireValue(plan.driveFileName, 'Drive file name is required.'),
          sha256: apk?.sha256 ?? args.apkSha256,
        }] : []),
      ],
      folderId: approvedDriveFolderId,
    },
    gcloudAccount,
    minimumVersionCode: args.minimumVersionCode,
    mode: args.mode,
    publicInstallUrl: `${trimTrailingSlash(args.deliveryServerBaseUrl)}/routes-app`,
    publishedRelease,
    publishedSha256,
    source,
    ssm: {
      instanceId: requireValue(args.ssmInstanceId, '--ssm-instance-id is required.'),
      region: args.ssmRegion,
    },
  });

  console.log(JSON.stringify({
    dryRun: false,
    plan: {
      ...verifiedPlan,
      downloadUrl,
      ssmCommand,
    },
  }, null, 2));
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    if (arg === '--execute') {
      values.set(arg, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value.`);
    }
    values.set(arg, value);
    index += 1;
  }

  const mode = values.get('--mode') ?? 'publish';
  if (mode !== 'publish' && mode !== 'bootstrap-legacy') {
    throw new Error('--mode must be publish or bootstrap-legacy.');
  }

  const minimumVersionCode = values.get('--minimum-version-code');
  return {
    apk: stringValue(values.get('--apk')),
    apkSha256: stringValue(values.get('--apk-sha256')),
    deliveryServerBaseUrl: stringValue(values.get('--delivery-server-base-url')) ?? 'https://clever-delivery-server.evnsolution.com',
    execute: values.get('--execute') === true,
    minimumVersionCode: minimumVersionCode === undefined ? undefined : Number(minimumVersionCode),
    mode,
    ssmInstanceId: stringValue(values.get('--ssm-instance-id')),
    ssmRegion: stringValue(values.get('--ssm-region')) ?? 'us-east-1',
  };
}

function readSourceState(): ReleaseSourceState {
  const branch = git('branch', '--show-current');
  return {
    branch,
    clean: git('status', '--porcelain') === '',
    headSha: git('rev-parse', 'HEAD'),
    remoteHeadSha: git('rev-parse', `origin/${branch}`),
  };
}

function readApkMetadata(apkPath: string | undefined): AndroidApkMetadata {
  const resolvedApkPath = resolve(process.cwd(), requireValue(apkPath, '--apk is required in publish mode.'));
  if (!existsSync(resolvedApkPath)) {
    throw new Error(`APK not found: ${resolvedApkPath}`);
  }
  const sha256 = createHash('sha256').update(readFileSync(resolvedApkPath)).digest('hex');
  const badging = execFileSync('aapt', ['dump', 'badging', resolvedApkPath], { encoding: 'utf8' });
  return parseAaptBadging(badging, sha256);
}

function readGcloudAccount(): string {
  const output = execFileSync('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], {
    encoding: 'utf8',
  }).trim();
  const accounts = output.split('\n').filter((line) => line.trim() !== '');
  if (accounts.length !== 1) {
    throw new Error('Exactly one active gcloud account is required.');
  }
  return accounts[0];
}

async function uploadImmutableApk(apkPath: string, apk: AndroidApkMetadata): Promise<string> {
  const token = readGcloudAccessToken();
  const fileName = buildVersionedApkFileName(apk);
  const metadata = {
    appProperties: {
      packageName: apk.packageName,
      sha256: apk.sha256,
      versionCode: String(apk.versionCode),
      versionName: apk.versionName,
    },
    mimeType: 'application/vnd.android.package-archive',
    name: fileName,
    parents: [approvedDriveFolderId],
  };
  const boundary = `clever-routes-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n`),
    readFileSync(resolve(process.cwd(), apkPath)),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    method: 'POST',
  });
  if (!uploadResponse.ok) {
    throw new Error(`Drive APK upload failed with HTTP ${uploadResponse.status}.`);
  }
  const uploaded = await uploadResponse.json() as { id?: string };
  const fileId = requireValue(uploaded.id, 'Drive upload did not return a file id.');

  return buildDriveDownloadUrl(fileId);
}

async function downloadSha256(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Anonymous APK download returned HTTP ${response.status}.`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  return createHash('sha256').update(data).digest('hex');
}

function readGcloudAccessToken(): string {
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
}

function runSsmPublishAndWait(command: string[], ssm: { instanceId: string; region: string }): void {
  const commandId = execFileSync(command[0], command.slice(1), { encoding: 'utf8' }).trim();
  if (commandId === '') {
    throw new Error('SSM send-command did not return a command id.');
  }
  runChecked('aws', [
    'ssm',
    'wait',
    'command-executed',
    '--region',
    ssm.region,
    '--command-id',
    commandId,
    '--instance-id',
    ssm.instanceId,
  ]);
  const invocation = execFileSync('aws', [
    'ssm',
    'get-command-invocation',
    '--region',
    ssm.region,
    '--command-id',
    commandId,
    '--instance-id',
    ssm.instanceId,
    '--output',
    'json',
  ], { encoding: 'utf8' });
  const result = JSON.parse(invocation) as {
    StandardErrorContent?: string;
    StandardOutputContent?: string;
    Status?: string;
  };
  if (result.StandardOutputContent?.trim()) {
    console.info(result.StandardOutputContent.trim());
  }
  if (result.Status !== 'Success') {
    throw new Error(`SSM publisher command ${commandId} finished with status ${result.Status ?? 'unknown'}: ${result.StandardErrorContent ?? ''}`);
  }
}

function runChecked(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function extractDriveFileId(downloadUrl: string): string {
  return new URL(downloadUrl).searchParams.get('id') ?? 'NEW_FILE_ID_AFTER_UPLOAD';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

function stringValue(value: string | true | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === '') {
    throw new Error(message);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
