import * as Application from 'expo-application';

export type InstalledDriverAppVersion = {
  versionCode: number;
  versionName: string;
};

export function readInstalledDriverAppVersion(): InstalledDriverAppVersion | null {
  const versionCode = Number(Application.nativeBuildVersion);
  const versionName = Application.nativeApplicationVersion?.trim();

  if (!Number.isInteger(versionCode) || versionCode <= 0 || versionName === undefined || versionName === '') {
    return null;
  }

  return { versionCode, versionName };
}
