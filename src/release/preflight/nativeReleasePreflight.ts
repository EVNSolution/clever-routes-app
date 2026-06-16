export type NativeReleasePreflightCheckId =
  | 'eas.preview'
  | 'eas.production'
  | 'expo.identity'
  | 'expo.permissions'
  | 'ios.native'
  | 'runtime.env.example';

export type NativeReleasePreflightCheck = {
  id: NativeReleasePreflightCheckId;
  message: string;
  ok: boolean;
};

export type NativeReleasePreflightResult = {
  checks: NativeReleasePreflightCheck[];
  externalBlockers: string[];
  failures: Pick<NativeReleasePreflightCheck, 'id' | 'message'>[];
  ok: boolean;
};

export type NativeReleasePreflightInput = {
  appConfig: {
    expo?: {
      android?: {
        package?: string;
        permissions?: string[];
        versionCode?: number;
      };
      extra?: Record<string, unknown>;
      ios?: {
        buildNumber?: string;
        bundleIdentifier?: string;
        infoPlist?: Record<string, unknown>;
        supportsTablet?: boolean;
      };
      plugins?: unknown[];
      scheme?: string;
      slug?: string;
      version?: string;
    };
  };
  easConfig: {
    build?: Record<string, {
      android?: Record<string, unknown>;
      autoIncrement?: boolean;
      distribution?: string;
      environment?: string;
    }>;
    cli?: {
      appVersionSource?: string;
      requireCommit?: boolean;
    };
    submit?: Record<string, unknown>;
  };
  envExample: string;
  iosNativeProject?: {
    infoPlist?: string;
    privacyManifest?: string;
    projectPbxproj?: string;
  };
};

const FORBIDDEN_CONTACTS_ANDROID_PERMISSIONS = new Set([
  'GET_ACCOUNTS',
  'READ_CONTACTS',
  'WRITE_CONTACTS'
]);
const FORBIDDEN_CONTACTS_IOS_INFO_PLIST_KEYS = new Set([
  'NSContactsUsageDescription'
]);

export function runNativeReleasePreflight(input: NativeReleasePreflightInput): NativeReleasePreflightResult {
  const checks = [
    checkExpoIdentity(input.appConfig),
    checkExpoPermissions(input.appConfig),
    checkEasPreview(input.easConfig),
    checkEasProduction(input.easConfig),
    checkRuntimeEnvExample(input.envExample),
    checkIosNativeProject(input.iosNativeProject, input.appConfig)
  ];
  const failures = checks
    .filter((check) => !check.ok)
    .map(({ id, message }) => ({ id, message }));

  return {
    checks,
    externalBlockers: [
      'Expo/EAS project ownership and preview/production environment values must be confirmed outside git.',
      'Apple team/signing and Google Play/signing authority must be confirmed outside git.',
      'Store/private distribution path, privacy disclosure copy, background location rationale, photo/video permission rationale, and license decision require owner/legal approval.'
    ],
    failures,
    ok: failures.length === 0
  };
}

function checkExpoIdentity(appConfig: NativeReleasePreflightInput['appConfig']): NativeReleasePreflightCheck {
  const expo = appConfig.expo;
  if (expo === undefined) {
    return fail('expo.identity', 'Expo app config is required.');
  }
  if (expo.slug !== 'clever-driver-app') {
    return fail('expo.identity', 'Expo slug must be clever-driver-app.');
  }
  if (expo.scheme !== 'clever-driver') {
    return fail('expo.identity', 'Expo URL scheme must be clever-driver.');
  }
  if (expo.version !== '0.1.0') {
    return fail('expo.identity', 'Expo app version must be 0.1.0 until owner-approved release versioning changes.');
  }
  if (expo.ios?.bundleIdentifier !== 'com.evns.cleverdriverapp') {
    return fail('expo.identity', 'iOS bundleIdentifier must be com.evns.cleverdriverapp.');
  }
  if (expo.ios?.buildNumber !== '1') {
    return fail('expo.identity', 'iOS buildNumber must remain 1 before the first EAS remote version sync.');
  }
  if (expo.ios?.supportsTablet !== false) {
    return fail('expo.identity', 'iOS supportsTablet must remain false for the phone-first driver MVP.');
  }
  if (expo.android?.package !== 'com.evns.cleverdriverapp') {
    return fail('expo.identity', 'Android package must be com.evns.cleverdriverapp.');
  }
  if (expo.android?.versionCode !== 1) {
    return fail('expo.identity', 'Android versionCode must remain 1 before the first EAS remote version sync.');
  }
  if (expo.extra?.projectStartIssue !== 'EVNSolution/clever-change-control#145') {
    return fail('expo.identity', 'Expo extra.projectStartIssue must reference EVNSolution/clever-change-control#145.');
  }

  return pass('expo.identity', 'Expo app identity and native version pins match the release baseline.');
}

function checkExpoPermissions(appConfig: NativeReleasePreflightInput['appConfig']): NativeReleasePreflightCheck {
  const plugins = appConfig.expo?.plugins ?? [];
  const locationPlugin = tuplePluginConfig(plugins, 'expo-location');
  if (locationPlugin === null) {
    return fail('expo.permissions', 'expo-location plugin with native permission copy is required.');
  }
  if (locationPlugin.isIosBackgroundLocationEnabled !== true) {
    return fail('expo.permissions', 'iOS background location must be explicitly enabled for active delivery tracking.');
  }
  if (locationPlugin.isAndroidBackgroundLocationEnabled !== true) {
    return fail('expo.permissions', 'Android background location must be explicitly enabled for active delivery tracking.');
  }
  if (locationPlugin.isAndroidForegroundServiceEnabled !== true) {
    return fail('expo.permissions', 'Android foreground service must be explicitly enabled for active delivery tracking.');
  }
  if (typeof locationPlugin.locationWhenInUsePermission !== 'string' || locationPlugin.locationWhenInUsePermission.trim() === '') {
    return fail('expo.permissions', 'Location when-in-use permission copy is required.');
  }
  if (
    typeof locationPlugin.locationAlwaysAndWhenInUsePermission !== 'string' ||
    locationPlugin.locationAlwaysAndWhenInUsePermission.trim() === ''
  ) {
    return fail('expo.permissions', 'Background location permission copy is required.');
  }

  const imagePickerPlugin = tuplePluginConfig(plugins, 'expo-image-picker');
  if (
    imagePickerPlugin === null ||
    typeof imagePickerPlugin.cameraPermission !== 'string' ||
    imagePickerPlugin.cameraPermission.trim() === '' ||
    typeof imagePickerPlugin.photosPermission !== 'string' ||
    imagePickerPlugin.photosPermission.trim() === ''
  ) {
    return fail('expo.permissions', 'expo-image-picker camera/photos permission copy is required.');
  }

  if (!plugins.includes('expo-secure-store')) {
    return fail('expo.permissions', 'expo-secure-store plugin is required for native driver token storage.');
  }
  if (hasForbiddenContactsAndroidPermission(appConfig.expo?.android?.permissions)) {
    return fail('expo.permissions', 'Contacts/address-book permissions must stay absent from the driver app native config.');
  }
  if (hasForbiddenContactsIosInfoPlistKey(appConfig.expo?.ios?.infoPlist)) {
    return fail('expo.permissions', 'Contacts/address-book permissions must stay absent from the driver app native config.');
  }

  return pass('expo.permissions', 'Native location, proof photo, and secure storage permissions are declared.');
}


function checkIosNativeProject(
  iosNativeProject: NativeReleasePreflightInput['iosNativeProject'],
  appConfig: NativeReleasePreflightInput['appConfig'],
): NativeReleasePreflightCheck {
  if (iosNativeProject === undefined) {
    return pass('ios.native', 'No source-controlled iOS native project is present; Expo config remains the native source of truth.');
  }

  const pbxproj = iosNativeProject.projectPbxproj ?? '';
  const infoPlist = iosNativeProject.infoPlist ?? '';
  const privacyManifest = iosNativeProject.privacyManifest ?? '';
  const expectedVersion = appConfig.expo?.version ?? '';
  const expectedBuildNumber = appConfig.expo?.ios?.buildNumber ?? '';
  const expectedBundleIdentifier = appConfig.expo?.ios?.bundleIdentifier ?? '';

  if (pbxproj.includes('DEVELOPMENT_TEAM =')) {
    return fail('ios.native', 'Source-controlled iOS project must not pin a local Apple DEVELOPMENT_TEAM.');
  }
  if (!pbxproj.includes(`MARKETING_VERSION = ${expectedVersion};`)) {
    return fail('ios.native', 'iOS MARKETING_VERSION must match the Expo app version baseline.');
  }
  if (!pbxproj.includes(`CURRENT_PROJECT_VERSION = ${expectedBuildNumber};`)) {
    return fail('ios.native', 'iOS CURRENT_PROJECT_VERSION must match the Expo iOS buildNumber baseline.');
  }
  if (!pbxproj.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${expectedBundleIdentifier};`)) {
    return fail('ios.native', 'iOS PRODUCT_BUNDLE_IDENTIFIER must match the Expo bundleIdentifier baseline.');
  }
  if (infoPlist.includes('NSContactsUsageDescription')) {
    return fail('ios.native', 'Contacts usage description must stay absent from the source-controlled iOS project.');
  }
  if (infoPlist.includes('NSMicrophoneUsageDescription')) {
    return fail('ios.native', 'Microphone usage description must stay absent until an approved audio feature exists.');
  }
  if (infoPlist.includes('NSFaceIDUsageDescription')) {
    return fail('ios.native', 'Face ID usage description must stay absent until biometric auth is approved.');
  }
  if (!infoPlist.includes('NSLocationWhenInUseUsageDescription') || !infoPlist.includes('NSLocationAlwaysAndWhenInUseUsageDescription')) {
    return fail('ios.native', 'Source-controlled iOS project must include active-delivery location permission copy.');
  }
  if (!infoPlist.includes('NSCameraUsageDescription') || !infoPlist.includes('NSPhotoLibraryUsageDescription')) {
    return fail('ios.native', 'Source-controlled iOS project must include proof photo camera/photo permission copy.');
  }
  if (!privacyManifest.includes('NSPrivacyTracking') || !privacyManifest.includes('<false/>')) {
    return fail('ios.native', 'iOS privacy manifest must explicitly keep tracking disabled.');
  }

  return pass('ios.native', 'Source-controlled iOS native project matches app identity, permission, and privacy guardrails.');
}

function hasForbiddenContactsAndroidPermission(permissions: string[] | undefined): boolean {
  return (
    permissions?.some((permission) => {
      const normalizedPermission = permission.trim().toUpperCase().replace(/^ANDROID\.PERMISSION\./u, '');
      return FORBIDDEN_CONTACTS_ANDROID_PERMISSIONS.has(normalizedPermission);
    }) ?? false
  );
}

function hasForbiddenContactsIosInfoPlistKey(infoPlist: Record<string, unknown> | undefined): boolean {
  return Object.keys(infoPlist ?? {}).some((key) => FORBIDDEN_CONTACTS_IOS_INFO_PLIST_KEYS.has(key));
}

function checkEasPreview(easConfig: NativeReleasePreflightInput['easConfig']): NativeReleasePreflightCheck {
  const preview = easConfig.build?.preview;
  if (easConfig.cli?.requireCommit !== true) {
    return fail('eas.preview', 'EAS cli.requireCommit must be true so preview evidence ties to committed source.');
  }
  if (easConfig.cli?.appVersionSource !== 'remote') {
    return fail('eas.preview', 'EAS cli.appVersionSource must be remote.');
  }
  if (preview?.distribution !== 'internal') {
    return fail('eas.preview', 'EAS preview profile must use internal distribution.');
  }
  if (preview?.environment !== 'preview') {
    return fail('eas.preview', 'EAS preview profile must use the preview environment.');
  }
  if (preview.android?.buildType !== 'apk') {
    return fail('eas.preview', 'EAS preview Android buildType must be apk for physical-device smoke installs.');
  }

  return pass('eas.preview', 'EAS preview profile is configured for internal device evidence builds.');
}

function checkEasProduction(easConfig: NativeReleasePreflightInput['easConfig']): NativeReleasePreflightCheck {
  const production = easConfig.build?.production;
  if (production?.distribution !== 'store') {
    return fail('eas.production', 'EAS production profile must use store distribution.');
  }
  if (production?.environment !== 'production') {
    return fail('eas.production', 'EAS production profile must use the production environment.');
  }
  if (production?.autoIncrement !== true) {
    return fail('eas.production', 'EAS production profile must autoIncrement native build numbers.');
  }
  if (!isPlainRecord(easConfig.submit?.production)) {
    return fail('eas.production', 'EAS submit.production must exist as an object, even if owner-controlled submit details stay external.');
  }

  return pass('eas.production', 'EAS production profile is configured for store candidate archives.');
}

function checkRuntimeEnvExample(envExample: string): NativeReleasePreflightCheck {
  if (!envExample.includes('EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL')) {
    return fail('runtime.env.example', '.env.example must document EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL for live API mode.');
  }

  return pass('runtime.env.example', '.env.example documents the only bundled public runtime API origin key.');
}

function tuplePluginConfig(plugins: unknown[], pluginName: string): Record<string, unknown> | null {
  for (const plugin of plugins) {
    if (Array.isArray(plugin) && plugin[0] === pluginName && isPlainRecord(plugin[1])) {
      return plugin[1];
    }
  }

  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pass(id: NativeReleasePreflightCheckId, message: string): NativeReleasePreflightCheck {
  return { id, message, ok: true };
}

function fail(id: NativeReleasePreflightCheckId, message: string): NativeReleasePreflightCheck {
  return { id, message, ok: false };
}
