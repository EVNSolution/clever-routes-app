export type DriverAppReleaseManifest = {
  distributionChannel: 'direct';
  installation: {
    guideUrl: string;
    mode: 'package_migration';
    replacesPackageIds: string[];
    targetPackageId: string;
  };
  installUrl: string;
  latestVersionCode: number;
  latestVersionName: string;
  minimumSupportedVersionCode: number;
  platform: 'android';
};

export type DriverAppUpdateState =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'up_to_date'; release: DriverAppReleaseManifest }
  | { kind: 'optional_update'; release: DriverAppReleaseManifest }
  | { kind: 'required_update'; release: DriverAppReleaseManifest }
  | { kind: 'required_reinstall'; release: DriverAppReleaseManifest };

export function classifyDriverAppUpdate(input: {
  currentPackageId: string;
  currentVersionCode: number;
  release: DriverAppReleaseManifest;
}): DriverAppUpdateState {
  if (input.currentPackageId !== input.release.installation.targetPackageId) {
    return { kind: 'required_reinstall', release: input.release };
  }
  if (input.currentVersionCode >= input.release.latestVersionCode) {
    return { kind: 'up_to_date', release: input.release };
  }
  if (input.currentVersionCode < input.release.minimumSupportedVersionCode) {
    return { kind: 'required_update', release: input.release };
  }
  return { kind: 'optional_update', release: input.release };
}

export function shouldPresentDriverAppUpdate(input: {
  dismissedVersionCode: number | null;
  hasActiveRoute: boolean;
  isRestoreComplete: boolean;
  isRouteSyncLoading: boolean;
  state: DriverAppUpdateState;
}): boolean {
  if (
    !input.isRestoreComplete
    || input.isRouteSyncLoading
    || input.hasActiveRoute
    || (
      input.state.kind !== 'optional_update'
      && input.state.kind !== 'required_update'
      && input.state.kind !== 'required_reinstall'
    )
  ) {
    return false;
  }

  return input.state.kind === 'required_update'
    || input.state.kind === 'required_reinstall'
    || input.dismissedVersionCode !== input.state.release.latestVersionCode;
}

export function readDriverAppReleaseManifest(value: unknown): DriverAppReleaseManifest {
  if (!isRecord(value)) {
    throw new Error('Invalid driver app release manifest');
  }

  const {
    distributionChannel,
    installation,
    installUrl,
    latestVersionCode,
    latestVersionName,
    minimumSupportedVersionCode,
    platform,
  } = value;

  if (
    distributionChannel !== 'direct'
    || platform !== 'android'
    || !isPositiveInteger(latestVersionCode)
    || !isPositiveInteger(minimumSupportedVersionCode)
    || minimumSupportedVersionCode > latestVersionCode
    || typeof latestVersionName !== 'string'
    || latestVersionName.trim() === ''
    || !isHttpUrl(installUrl)
    || !isPackageMigration(installation)
  ) {
    throw new Error('Invalid driver app release manifest');
  }

  return {
    distributionChannel,
    installation,
    installUrl,
    latestVersionCode,
    latestVersionName: latestVersionName.trim(),
    minimumSupportedVersionCode,
    platform,
  };
}

function isPackageMigration(value: unknown): value is DriverAppReleaseManifest['installation'] {
  if (!isRecord(value)) {
    return false;
  }
  const {
    guideUrl,
    mode,
    replacesPackageIds,
    targetPackageId,
  } = value;
  return mode === 'package_migration'
    && isHttpUrl(guideUrl)
    && isNonEmptyString(targetPackageId)
    && Array.isArray(replacesPackageIds)
    && replacesPackageIds.length > 0
    && replacesPackageIds.every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
