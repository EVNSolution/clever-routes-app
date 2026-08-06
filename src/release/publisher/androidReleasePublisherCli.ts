import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildDriveDownloadUrl,
  buildVersionedApkFileName,
  createAndroidReleasePublicationPlan,
  parseAaptBadging,
  validateReleaseSource,
  type AndroidApkMetadata,
  type ReleaseSourceState,
} from './androidReleasePublisher';
import {
  ensureDriveAnyoneReaderPermission,
  fetchOptionalRelease,
  fetchRelease,
  listDriveFiles,
  selectSingleOnlineSsmTarget,
  sha256File,
  sha256ResponseBody,
  uploadDriveFileResumable,
} from './androidReleasePublisherCliSupport';

type CliArgs = {
  apkSha256?: string;
  deliveryServerBaseUrl: string;
  execute: boolean;
  mode: 'publish' | 'bootstrap-legacy';
  minimumVersionCode?: number;
  ssmRegion: string;
};

const approvedDriveFolderId = '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ';
const builtApkPath = 'android/app/build/outputs/apk/release/app-release.apk';
const legacyDriveFileId = '1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2';
const ssmServiceTagKey = 'Service';
const ssmServiceTagValue = 'clever-delivery-server';
const supportedOptions = new Set([
  '--apk-sha256',
  '--delivery-server-base-url',
  '--execute',
  '--minimum-version-code',
  '--mode',
  '--ssm-region',
]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let source = readSourceState();
  validateReleaseSource(source);
  const gcloudAccount = readGcloudAccount();
  const existingFiles = await listDriveFiles({
    folderId: approvedDriveFolderId,
    token: readGcloudAccessToken(),
  });
  const currentRelease = await fetchOptionalRelease(args.deliveryServerBaseUrl);
  const instanceId = discoverSsmTarget(args.ssmRegion);
  let apk: AndroidApkMetadata | undefined;
  if (args.mode === 'publish') {
    runChecked('npm', ['run', 'build:android:distribution']);
    const sourceAfterBuild = readSourceState();
    validateReleaseSource(sourceAfterBuild);
    if (sourceAfterBuild.headSha !== source.headSha || sourceAfterBuild.branch !== source.branch) {
      throw new Error('release source changed while the APK was being built.');
    }
    source = sourceAfterBuild;
    apk = await readApkMetadata(builtApkPath, source.headSha);
  }
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
      instanceId,
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
    : await uploadImmutableApk(builtApkPath, requireValue(apk, 'APK metadata is required.'));
  await ensureDriveAnyoneReaderPermission({
    fileId: extractDriveFileId(downloadUrl),
    token: readGcloudAccessToken(),
  });
  const ssmCommand = plan.ssmCommand.map((part) => part.replace('NEW_FILE_ID_AFTER_UPLOAD', extractDriveFileId(downloadUrl)));
  runSsmPublishAndWait(ssmCommand, {
    instanceId,
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
          sourceSha: apk?.sourceSha,
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
      instanceId,
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
    if (!supportedOptions.has(arg)) {
      throw new Error(`Unsupported argument: ${arg}`);
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
    apkSha256: stringValue(values.get('--apk-sha256')),
    deliveryServerBaseUrl: stringValue(values.get('--delivery-server-base-url')) ?? 'https://clever-route.cleversystem.ai',
    execute: values.get('--execute') === true,
    minimumVersionCode: minimumVersionCode === undefined ? undefined : Number(minimumVersionCode),
    mode,
    ssmRegion: stringValue(values.get('--ssm-region')) ?? 'ap-northeast-2',
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

async function readApkMetadata(apkPath: string, sourceSha: string): Promise<AndroidApkMetadata> {
  const resolvedApkPath = resolve(process.cwd(), apkPath);
  if (!existsSync(resolvedApkPath)) {
    throw new Error(`APK not found: ${resolvedApkPath}`);
  }
  const sha256 = await sha256File(resolvedApkPath);
  const badging = execFileSync(resolveAaptPath(), ['dump', 'badging', resolvedApkPath], { encoding: 'utf8' });
  return {
    ...parseAaptBadging(badging, sha256),
    sourceSha,
  };
}

function resolveAaptPath(): string {
  const pathLookup = spawnSync('which', ['aapt'], { encoding: 'utf8' });
  if (pathLookup.status === 0 && pathLookup.stdout.trim() !== '') {
    return pathLookup.stdout.trim();
  }

  const sdkRoots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]
    .filter((value): value is string => value !== undefined && value.trim() !== '');
  for (const sdkRoot of sdkRoots) {
    const buildToolsRoot = resolve(sdkRoot, 'build-tools');
    if (!existsSync(buildToolsRoot)) {
      continue;
    }
    const versions = readdirSync(buildToolsRoot).sort((left, right) => (
      right.localeCompare(left, undefined, { numeric: true })
    ));
    for (const version of versions) {
      const candidate = resolve(buildToolsRoot, version, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error('aapt is required; add Android build-tools to PATH or configure ANDROID_SDK_ROOT.');
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
  const fileId = await uploadDriveFileResumable({
    apk,
    apkPath: resolve(process.cwd(), apkPath),
    fileName,
    folderId: approvedDriveFolderId,
    token,
  });
  return buildDriveDownloadUrl(fileId);
}

async function downloadSha256(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Anonymous APK download returned HTTP ${response.status}.`);
  }
  if (response.body === null) {
    throw new Error('Anonymous APK download returned an empty response body.');
  }
  return sha256ResponseBody(response.body);
}

function discoverSsmTarget(region: string): string {
  const output = execFileSync('aws', [
    'ssm',
    'describe-instance-information',
    '--region',
    region,
    '--filters',
    `Key=tag:${ssmServiceTagKey},Values=${ssmServiceTagValue}`,
    '--query',
    'InstanceInformationList[].{instanceId:InstanceId,pingStatus:PingStatus}',
    '--output',
    'json',
  ], { encoding: 'utf8' });
  return selectSingleOnlineSsmTarget(JSON.parse(output) as { instanceId?: string; pingStatus?: string }[]);
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
