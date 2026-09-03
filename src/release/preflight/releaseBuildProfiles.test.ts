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
  credentialsSource?: string;
  developmentClient?: boolean;
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
  assert.equal(eas.build?.production?.credentialsSource, 'remote');
  assert.equal(eas.build?.production?.developmentClient, undefined);
  assert.equal(eas.build?.production?.android?.buildType, 'app-bundle');
  assert.notEqual(eas.build?.production?.android?.withoutCredentials, true);
  assert.deepEqual(eas.submit?.production, {});
});

test('keeps source-controlled Android versions aligned across Expo and Gradle', () => {
  const appConfig = readJson<{
    expo?: {
      version?: string;
      ios?: { buildNumber?: string; bundleIdentifier?: string };
      android?: { package?: string; versionCode?: number };
    };
  }>('app.json');
  const androidBuildGradle = readFileSync(resolve(repoRoot, 'android/app/build.gradle'), 'utf8');
  const iosProject = readFileSync(resolve(repoRoot, 'ios/CleverRoutes.xcodeproj/project.pbxproj'), 'utf8');
  const packageConfig = readJson<{ version?: string }>('package.json');
  const packageLock = readJson<{ packages?: { ''?: { version?: string } }; version?: string }>('package-lock.json');
  const versionCode = Number(androidBuildGradle.match(/\bversionCode\s+(\d+)/u)?.[1]);
  const versionName = androidBuildGradle.match(/\bversionName\s+"([^"]+)"/u)?.[1];

  assert.equal(appConfig.expo?.version, '1.2.11');
  assert.equal(appConfig.expo?.android?.versionCode, 29);
  assert.equal(appConfig.expo?.ios?.bundleIdentifier, 'com.evnsolution.clever.routes');
  assert.equal(appConfig.expo?.ios?.buildNumber, '1');
  assert.equal(appConfig.expo?.android?.package, 'com.evnsolution.clever.routes');
  assert.equal(appConfig.expo?.android?.versionCode, versionCode);
  assert.equal(appConfig.expo?.version, versionName);
  assert.equal(appConfig.expo?.version, packageConfig.version);
  assert.equal(appConfig.expo?.version, packageLock.version);
  assert.equal(appConfig.expo?.version, packageLock.packages?.['']?.version);
  assert.deepEqual(
    [...iosProject.matchAll(/\bMARKETING_VERSION = ([^;]+);/gu)].map((match) => match[1]),
    [appConfig.expo?.version, appConfig.expo?.version],
  );
  assert.deepEqual(
    [...iosProject.matchAll(/\bCURRENT_PROJECT_VERSION = ([^;]+);/gu)].map((match) => match[1]),
    [appConfig.expo?.ios?.buildNumber, appConfig.expo?.ios?.buildNumber],
  );
});

test('documents a source-only Driver pilot candidate that cannot be mistaken for a published artifact', () => {
  const runbook = readFileSync(resolve(repoRoot, 'docs/driver-pilot-runbook.md'), 'utf8');

  assert.match(runbook, /Driver issue \| `EVNSolution\/clever-routes-app#210`/u);
  assert.match(runbook, /Change control \| `EVNSolution\/clever-change-control#265`/u);
  assert.match(runbook, /Candidate app source SHA \| `518fa106180fdd6fd96381b6945f6d146c0910c6`/u);
  assert.match(runbook, /App version \| `1\.2\.0`/u);
  assert.match(runbook, /Android version code \| `18`/u);
  assert.match(runbook, /iOS build number \| `1`/u);
  assert.match(runbook, /Publish authorized \| `no`/u);
  assert.match(runbook, /Signing performed \| `no`/u);
  assert.match(runbook, /Artifact built \| `no`/u);
  assert.match(runbook, /Synthetic data only \| `yes`/u);
  assert.match(runbook, /finishPending/u);
  assert.match(runbook, /lastAcknowledgedAt/u);
  assert.match(runbook, /five minutes/u);
});

test('keeps source version separate from public release evidence', () => {
  const appConfig = readJson<{
    expo?: {
      version?: string;
      ios?: { buildNumber?: string };
      android?: { versionCode?: number };
    };
  }>('app.json');
  const readiness = readFileSync(resolve(repoRoot, 'docs/release-readiness.md'), 'utf8');

  assert.ok(readiness.includes(
    `source version is \`${appConfig.expo?.version}\` (`
    + `\`versionCode\` \`${appConfig.expo?.android?.versionCode}\`, `
    + `iOS build \`${appConfig.expo?.ios?.buildNumber}\`)`,
  ));
  assert.match(readiness, /Publication is[\s\S]*proved separately by the public release manifest and downloadable artifact/u);
});

test('keeps the installed app name aligned across Expo, Android, and iOS', () => {
  const appConfig = readJson<{
    expo?: { name?: string };
  }>('app.json');
  const androidStrings = readFileSync(
    resolve(repoRoot, 'android/app/src/main/res/values/strings.xml'),
    'utf8',
  );
  const iosInfoPlist = readFileSync(resolve(repoRoot, 'ios/CleverRoutes/Info.plist'), 'utf8');

  assert.equal(appConfig.expo?.name, 'CLEVER Routes');
  assert.match(androidStrings, /<string name="app_name">CLEVER Routes<\/string>/u);
  assert.match(
    iosInfoPlist,
    /<key>CFBundleDisplayName<\/key>\s*<string>CLEVER Routes<\/string>/u,
  );
});

test('separates Android development, QA, and self-contained smoke commands', () => {
  const packageConfig = readJson<{
    scripts?: Record<string, string>;
  }>('package.json');
  const scripts = packageConfig.scripts ?? {};

  assert.equal(scripts.android, undefined);
  assert.match(scripts['android:dev:install'] ?? '', /expo run:android --device --variant debugOptimized/u);
  assert.match(scripts['android:dev:install'] ?? '', /reactNativeArchitectures=arm64-v8a/u);
  assert.match(scripts['android:dev:start'] ?? '', /expo start --dev-client --localhost --android/u);
  assert.match(scripts['android:qa:build'] ?? '', /eas-cli build --platform android --profile preview/u);
  assert.match(scripts['prebuild:android:device-smoke'] ?? '', /prepare:android:firebase:local/u);
  assert.match(scripts['prepare:android:firebase:local'] ?? '', /prepare-google-services\.mjs --allow-existing/u);
  assert.match(scripts['build:android:device-smoke'] ?? '', /app:assembleRelease/u);
  assert.match(scripts['build:android:device-smoke'] ?? '', /reactNativeArchitectures=arm64-v8a/u);
  assert.doesNotMatch(scripts['build:android:device-smoke'] ?? '', /app:clean/u);
});

test('keeps incremental and clean direct-download Android builds explicit', () => {
  const packageConfig = readJson<{
    scripts?: Record<string, string>;
  }>('package.json');
  const command = packageConfig.scripts?.['build:android:distribution'] ?? '';
  const cleanCommand = packageConfig.scripts?.['build:android:distribution:clean'] ?? '';
  const preflight = packageConfig.scripts?.['prebuild:android:distribution'] ?? '';
  const gradleProperties = readFileSync(resolve(repoRoot, 'android/gradle.properties'), 'utf8');

  assert.match(preflight, /verify-distribution-source\.mjs/u);
  assert.doesNotMatch(command, /app:clean/u);
  assert.match(command, /app:assembleRelease/u);
  assert.match(cleanCommand, /app:clean/u);
  assert.match(cleanCommand, /app:assembleRelease/u);
  assert.match(command, /reactNativeArchitectures=armeabi-v7a,arm64-v8a/u);
  assert.match(command, /android\.enableMinifyInReleaseBuilds=true/u);
  assert.match(command, /android\.enableShrinkResourcesInReleaseBuilds=true/u);
  assert.match(command, /expo\.useLegacyPackaging=true/u);
  assert.doesNotMatch(command, /android\.enableBundleCompression=true/u);
  assert.match(gradleProperties, /^org\.gradle\.caching=true$/mu);
  assert.match(gradleProperties, /^org\.gradle\.workers\.max=4$/mu);
  assert.match(gradleProperties, /^org\.gradle\.jvmargs=.*-XX:MaxMetaspaceSize=768m$/mu);
});

test('exposes one reviewed direct Android publisher command', () => {
  const packageConfig = readJson<{
    scripts?: Record<string, string>;
  }>('package.json');
  const publisherSource = readFileSync(
    resolve(repoRoot, 'src/release/publisher/androidReleasePublisherCli.ts'),
    'utf8',
  );

  assert.equal(
    packageConfig.scripts?.['release:android:publish'],
    'tsx src/release/publisher/androidReleasePublisherCli.ts',
  );
  assert.match(publisherSource, /npm', \['run', 'build:android:distribution'\]/u);
  assert.match(publisherSource, /https:\/\/clever-route\.cleversystem\.ai/u);
  assert.match(publisherSource, /ap-northeast-2/u);
  assert.match(publisherSource, /Service/u);
  assert.match(publisherSource, /clever-delivery-server/u);
  assert.match(publisherSource, /ls-remote/u);
  assert.doesNotMatch(publisherSource, /readFileSync|arrayBuffer|--ssm-instance-id|uploadType=multipart/u);
});

test('keeps source-controlled native release metadata aligned and minimally privileged', () => {
  const appConfig = readJson<{
    expo?: { android?: { blockedPermissions?: string[] } };
  }>('app.json');
  const androidManifest = readFileSync(resolve(repoRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const androidGradleProperties = readFileSync(resolve(repoRoot, 'android/gradle.properties'), 'utf8');
  const iosInfoPlist = readFileSync(resolve(repoRoot, 'ios/CleverRoutes/Info.plist'), 'utf8');

  assert.doesNotMatch(androidManifest, /android\.permission\.SYSTEM_ALERT_WINDOW/u);
  assert.doesNotMatch(
    androidManifest,
    /android\.permission\.(?:READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_IMAGES|READ_MEDIA_VIDEO)"(?![^>]*tools:node="remove")/u,
  );
  assert.deepEqual(appConfig.expo?.android?.blockedPermissions, [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.RECORD_AUDIO',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]);
  assert.doesNotMatch(androidGradleProperties, /^expo\.devlauncher\.configureInRelease\s*=\s*true\s*$/mu);
  assert.doesNotMatch(androidGradleProperties, /^expo\.devmenu\.configureInRelease\s*=\s*true\s*$/mu);
  assert.match(iosInfoPlist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/u);
});
