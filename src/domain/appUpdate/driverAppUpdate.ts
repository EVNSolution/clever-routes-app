export type DriverAppReleaseManifest = {
  distributionChannel: 'direct';
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
  | { kind: 'required_update'; release: DriverAppReleaseManifest };

export function classifyDriverAppUpdate(input: {
  currentVersionCode: number;
  release: DriverAppReleaseManifest;
}): DriverAppUpdateState {
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
    || (input.state.kind !== 'optional_update' && input.state.kind !== 'required_update')
  ) {
    return false;
  }

  return input.state.kind === 'required_update'
    || input.dismissedVersionCode !== input.state.release.latestVersionCode;
}

export function readDriverAppReleaseManifest(value: unknown): DriverAppReleaseManifest {
  if (!isRecord(value)) {
    throw new Error('Invalid driver app release manifest');
  }

  const {
    distributionChannel,
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
  ) {
    throw new Error('Invalid driver app release manifest');
  }

  return {
    distributionChannel,
    installUrl,
    latestVersionCode,
    latestVersionName: latestVersionName.trim(),
    minimumSupportedVersionCode,
    platform,
  };
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
