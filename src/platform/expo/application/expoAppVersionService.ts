import * as Application from 'expo-application';

export type InstalledDriverAppVersion = {
  packageId: string;
  versionCode: number;
  versionName: string;
};

export function readInstalledDriverAppVersion(): InstalledDriverAppVersion | null {
  const packageId = Application.applicationId?.trim();
  const versionCode = Number(Application.nativeBuildVersion);
  const versionName = Application.nativeApplicationVersion?.trim();

  if (
    packageId === undefined
    || packageId === ''
    || !Number.isInteger(versionCode)
    || versionCode <= 0
    || versionName === undefined
    || versionName === ''
  ) {
    return null;
  }

  return { packageId, versionCode, versionName };
}
