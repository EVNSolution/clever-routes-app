import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as T;
}

type EasBuildProfile = {
  android?: Record<string, unknown>;
  autoIncrement?: boolean;
  distribution?: string;
  environment?: string;
};

test('defines native EAS build profiles for preview and production evidence', () => {
  const eas = readJson<{
    cli?: { appVersionSource?: string; requireCommit?: boolean };
    build?: Record<string, EasBuildProfile>;
    submit?: Record<string, unknown>;
  }>('eas.json');

  assert.equal(eas.cli?.appVersionSource, 'remote');
  assert.equal(eas.cli?.requireCommit, true);

  assert.equal(eas.build?.preview?.distribution, 'internal');
  assert.equal(eas.build?.preview?.environment, 'preview');
  assert.equal(eas.build?.preview?.android?.buildType, 'apk');

  assert.equal(eas.build?.production?.distribution, 'store');
  assert.equal(eas.build?.production?.environment, 'production');
  assert.equal(eas.build?.production?.autoIncrement, true);
  assert.deepEqual(eas.submit?.production, {});
});

test('pins initial native build versions in app config before EAS remote version sync', () => {
  const appConfig = readJson<{
    expo?: {
      ios?: { buildNumber?: string; bundleIdentifier?: string };
      android?: { package?: string; versionCode?: number };
    };
  }>('app.json');

  assert.equal(appConfig.expo?.ios?.bundleIdentifier, 'com.evns.cleverdriverapp');
  assert.equal(appConfig.expo?.ios?.buildNumber, '1');
  assert.equal(appConfig.expo?.android?.package, 'com.evns.cleverdriverapp');
  assert.equal(appConfig.expo?.android?.versionCode, 1);
});

test('keeps direct-download Android optimization isolated to the distribution APK build', () => {
  const packageConfig = readJson<{
    scripts?: Record<string, string>;
  }>('package.json');
  const command = packageConfig.scripts?.['build:android:distribution'] ?? '';

  assert.match(command, /app:assembleRelease/u);
  assert.match(command, /reactNativeArchitectures=armeabi-v7a,arm64-v8a/u);
  assert.match(command, /android\.enableMinifyInReleaseBuilds=true/u);
  assert.match(command, /android\.enableShrinkResourcesInReleaseBuilds=true/u);
  assert.match(command, /expo\.useLegacyPackaging=true/u);
  assert.doesNotMatch(command, /android\.enableBundleCompression=true/u);
});

test('keeps source-controlled native release metadata aligned and minimally privileged', () => {
  const androidManifest = readFileSync(resolve(repoRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const iosInfoPlist = readFileSync(resolve(repoRoot, 'ios/CleverDriver/Info.plist'), 'utf8');

  assert.doesNotMatch(androidManifest, /android\.permission\.SYSTEM_ALERT_WINDOW/u);
  assert.match(iosInfoPlist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/u);
});
