export type AndroidApkMetadata = {
  appName: string;
  packageName: string;
  sha256: string;
  versionCode: number;
  versionName: string;
};

export type ReleaseSourceState = {
  branch: string;
  clean: boolean;
  headSha: string;
  remoteHeadSha: string;
};

export type PublicAndroidRelease = {
  installUrl: string;
  latestVersionCode: number;
  latestVersionName: string;
  minimumSupportedVersionCode: number;
  platform: string;
};

export type DriveReleaseFile = {
  id: string;
  name: string;
  sha256?: string;
};

export type AndroidReleasePublisherInput = {
  apk?: AndroidApkMetadata;
  bootstrapSha256?: string;
  currentRelease?: PublicAndroidRelease;
  drive: {
    existingFiles: DriveReleaseFile[];
    folderId: string;
  };
  gcloudAccount: string;
  minimumVersionCode?: number;
  mode: 'publish' | 'bootstrap-legacy';
  publicInstallUrl: string;
  publishedRelease?: PublicAndroidRelease;
  publishedSha256?: string;
  source: ReleaseSourceState;
  ssm: {
    instanceId: string;
    region: string;
  };
};

export type AndroidReleasePublicationPlan = {
  apk?: AndroidApkMetadata;
  downloadUrl: string;
  driveFileId?: string;
  driveFileName?: string;
  needsDriveUpload: boolean;
  mode: AndroidReleasePublisherInput['mode'];
  ssmCommand: string[];
  validations: string[];
};

const approvedGcloudAccount = 'dlajiin@gmail.com';
const approvedDriveFolderId = '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ';
const officialSourceBranches = new Set(['dev', 'main']);
const expectedPackageName = 'com.evnsolution.clever.routes';
const expectedAppName = 'CLEVER Routes';
const legacyDriveFileId = '1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2';
const legacyVersionCode = 8;
const legacyVersionName = '1.1.1';

export function parseAaptBadging(output: string, sha256: string): AndroidApkMetadata {
  const packageMatch = output.match(/package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/u);
  const appNameMatch = output.match(/application-label(?:-[^:]+)?:'([^']+)'/u);

  if (packageMatch === null) {
    throw new Error('APK badging output does not include package, versionCode, and versionName.');
  }

  if (appNameMatch === null) {
    throw new Error('APK badging output does not include an application label.');
  }

  return {
    appName: appNameMatch[1],
    packageName: packageMatch[1],
    sha256,
    versionCode: Number(packageMatch[2]),
    versionName: packageMatch[3],
  };
}

export function buildVersionedApkFileName(apk: AndroidApkMetadata): string {
  return `${apk.packageName}-${apk.versionName}-${apk.versionCode}.apk`;
}

export function buildDriveDownloadUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

export function buildSsmPublishCommand(input: {
  apkSha256: string;
  downloadUrl: string;
  instanceId: string;
  minimumVersionCode?: number;
  region: string;
  versionCode: number;
  versionName: string;
}): string[] {
  const publisherArgs = [
    'cd /srv/clever-route-server && docker compose --env-file .deploy/current-image.env -f infra/compose/docker-compose.prod.yml exec -T clever-route-api node dist/scripts/publish-routes-app-release.js',
    `--version-code ${input.versionCode}`,
    `--version-name ${shellQuote(input.versionName)}`,
    ...(input.minimumVersionCode === undefined ? [] : [`--minimum-version-code ${input.minimumVersionCode}`]),
    `--apk-sha256 ${shellQuote(input.apkSha256)}`,
    `--download-url ${shellQuote(input.downloadUrl)}`,
  ].join(' ');

  return [
    'aws',
    'ssm',
    'send-command',
    '--region',
    input.region,
    '--instance-ids',
    input.instanceId,
    '--document-name',
    'AWS-RunShellScript',
    '--parameters',
    JSON.stringify({ commands: [publisherArgs] }),
    '--query',
    'Command.CommandId',
    '--output',
    'text',
  ];
}

export function createAndroidReleasePublicationPlan(input: AndroidReleasePublisherInput): AndroidReleasePublicationPlan {
  const validations: string[] = [];
  validateSource(input.source);
  validations.push(`source ${input.source.branch}@${input.source.headSha} matches origin/${input.source.branch}`);

  if (input.gcloudAccount !== approvedGcloudAccount) {
    throw new Error(`gcloud account must be ${approvedGcloudAccount}.`);
  }
  validations.push(`gcloud account ${approvedGcloudAccount} approved`);

  if (input.drive.folderId !== approvedDriveFolderId) {
    throw new Error(`Drive folder must be ${approvedDriveFolderId}.`);
  }
  validations.push(`Drive folder ${approvedDriveFolderId} approved`);

  if (input.mode === 'bootstrap-legacy') {
    return createLegacyBootstrapPlan(input, validations);
  }

  if (input.apk === undefined) {
    throw new Error('publish mode requires APK metadata.');
  }

  validateApk(input.apk);
  const fileName = buildVersionedApkFileName(input.apk);
  const sameNameFiles = input.drive.existingFiles.filter((file) => file.name === fileName);
  const conflictingFile = sameNameFiles.find((file) => file.sha256 !== input.apk?.sha256);
  if (conflictingFile !== undefined) {
    throw new Error(`Drive already contains ${fileName} with a different or unverifiable sha256; refusing conflicting retry.`);
  }

  validateVersionAdvance(input.currentRelease, input.apk.versionCode);
  const minimumVersionCode = input.minimumVersionCode ?? input.currentRelease?.minimumSupportedVersionCode;
  if (minimumVersionCode !== undefined && minimumVersionCode > input.apk.versionCode) {
    throw new Error('minimumVersionCode must not exceed versionCode.');
  }

  const driveFileId = sameNameFiles[0]?.id;
  const downloadUrl = buildDriveDownloadUrl(driveFileId ?? 'NEW_FILE_ID_AFTER_UPLOAD');
  const ssmCommand = buildSsmPublishCommand({
    apkSha256: input.apk.sha256,
    downloadUrl,
    instanceId: input.ssm.instanceId,
    minimumVersionCode,
    region: input.ssm.region,
    versionCode: input.apk.versionCode,
    versionName: input.apk.versionName,
  });

  verifyPublishedState(input.publishedRelease, input.publishedSha256, {
    publicInstallUrl: input.publicInstallUrl,
    sha256: input.apk.sha256,
    versionCode: input.apk.versionCode,
    versionName: input.apk.versionName,
  });

  return {
    apk: input.apk,
    downloadUrl,
    driveFileId,
    driveFileName: fileName,
    needsDriveUpload: driveFileId === undefined,
    mode: input.mode,
    ssmCommand,
    validations: [
      ...validations,
      ...(driveFileId === undefined
        ? []
        : [`existing Drive APK ${fileName} with matching sha256 will be reused`]),
    ],
  };
}

function createLegacyBootstrapPlan(
  input: AndroidReleasePublisherInput,
  validations: string[],
): AndroidReleasePublicationPlan {
  const apkSha256 = input.bootstrapSha256;
  if (apkSha256 === undefined || apkSha256.trim() === '') {
    throw new Error('bootstrap-legacy mode requires --apk-sha256 for the existing legacy Drive file.');
  }

  validateLegacyBootstrapCurrentRelease(input.currentRelease);
  const downloadUrl = buildDriveDownloadUrl(legacyDriveFileId);
  const ssmCommand = buildSsmPublishCommand({
    apkSha256,
    downloadUrl,
    instanceId: input.ssm.instanceId,
    minimumVersionCode: input.minimumVersionCode,
    region: input.ssm.region,
    versionCode: legacyVersionCode,
    versionName: legacyVersionName,
  });

  verifyPublishedState(input.publishedRelease, input.publishedSha256, {
    publicInstallUrl: input.publicInstallUrl,
    sha256: apkSha256,
    versionCode: legacyVersionCode,
    versionName: legacyVersionName,
  });

  validations.push(`legacy Drive file ${legacyDriveFileId} reused without content replacement`);

  return {
    downloadUrl,
    driveFileId: legacyDriveFileId,
    needsDriveUpload: false,
    mode: input.mode,
    ssmCommand,
    validations,
  };
}

function validateSource(source: ReleaseSourceState): void {
  if (!officialSourceBranches.has(source.branch)) {
    throw new Error(`branch "${source.branch || 'detached HEAD'}" is not an official release source.`);
  }
  if (!source.clean) {
    throw new Error('worktree must be clean before Android release publication.');
  }
  if (source.headSha !== source.remoteHeadSha) {
    throw new Error(`local ${source.branch} does not match origin/${source.branch}.`);
  }
}

function validateApk(apk: AndroidApkMetadata): void {
  if (apk.packageName !== expectedPackageName) {
    throw new Error(`APK package must be ${expectedPackageName}.`);
  }
  if (apk.appName !== expectedAppName) {
    throw new Error(`APK app name must be ${expectedAppName}.`);
  }
  if (!Number.isInteger(apk.versionCode) || apk.versionCode <= 0) {
    throw new Error('APK versionCode must be a positive integer.');
  }
  if (apk.versionName.trim() === '') {
    throw new Error('APK versionName must be present.');
  }
  if (!/^[a-f0-9]{64}$/u.test(apk.sha256)) {
    throw new Error('APK sha256 must be a lowercase 64-character hex digest.');
  }
}

function validateVersionAdvance(currentRelease: PublicAndroidRelease | undefined, nextVersionCode: number): void {
  if (currentRelease === undefined) {
    return;
  }
  if (currentRelease.latestVersionCode >= nextVersionCode) {
    throw new Error(
      `versionCode rollback blocked: current public release is ${currentRelease.latestVersionCode}, candidate is ${nextVersionCode}.`,
    );
  }
}

function validateLegacyBootstrapCurrentRelease(currentRelease: PublicAndroidRelease | undefined): void {
  if (currentRelease === undefined) {
    return;
  }
  if (currentRelease.latestVersionCode > legacyVersionCode) {
    throw new Error(
      `versionCode rollback blocked: current public release is ${currentRelease.latestVersionCode}, legacy bootstrap is ${legacyVersionCode}.`,
    );
  }
  if (
    currentRelease.latestVersionCode === legacyVersionCode
    && currentRelease.latestVersionName !== legacyVersionName
  ) {
    throw new Error(
      `legacy bootstrap versionName mismatch: current versionCode ${legacyVersionCode} is ${currentRelease.latestVersionName}, expected ${legacyVersionName}.`,
    );
  }
}

function verifyPublishedState(
  publishedRelease: PublicAndroidRelease | undefined,
  publishedSha256: string | undefined,
  expected: {
    publicInstallUrl: string;
    sha256: string;
    versionCode: number;
    versionName: string;
  },
): void {
  if (publishedRelease === undefined && publishedSha256 === undefined) {
    return;
  }
  if (publishedRelease === undefined || publishedSha256 === undefined) {
    throw new Error('post-publish verification requires both public release response and anonymous download sha256.');
  }
  if (publishedRelease.platform !== 'android') {
    throw new Error('public release response platform must remain android.');
  }
  if (publishedRelease.latestVersionCode !== expected.versionCode) {
    throw new Error('public release response versionCode does not match the published artifact.');
  }
  if (publishedRelease.latestVersionName !== expected.versionName) {
    throw new Error('public release response versionName does not match the published artifact.');
  }
  if (publishedRelease.installUrl !== expected.publicInstallUrl) {
    throw new Error('public /routes-app/release/android installUrl must stay on the server-owned /routes-app URL.');
  }
  if (publishedSha256 !== expected.sha256) {
    throw new Error('anonymous /routes-app/download checksum does not match the published APK.');
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
