import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  runNativeReleasePreflight,
  type NativeReleasePreflightInput
} from './nativeReleasePreflight';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as T;
}

function currentInput(): NativeReleasePreflightInput {
  return {
    appConfig: readJson('app.json'),
    easConfig: readJson('eas.json'),
    envExample: readFileSync(resolve(repoRoot, '.env.example'), 'utf8')
  };
}

test('native release preflight passes for the committed Expo and EAS config', () => {
  const result = runNativeReleasePreflight(currentInput());

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(
    result.checks.map((check) => check.id),
    [
      'expo.identity',
      'expo.permissions',
      'eas.preview',
      'eas.production',
      'runtime.env.example',
      'ios.native'
    ]
  );
});

test('native release preflight reports release-blocking config gaps without secrets', () => {
  const input = currentInput();
  const brokenInput: NativeReleasePreflightInput = {
    ...input,
    appConfig: {
      ...input.appConfig,
      expo: {
        ...input.appConfig.expo,
        ios: {
          ...input.appConfig.expo?.ios,
          bundleIdentifier: 'com.example.placeholder'
        }
      }
    },
    envExample: ''
  };

  const result = runNativeReleasePreflight(brokenInput);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    {
      id: 'expo.identity',
      message: 'iOS bundleIdentifier must be com.evns.cleverdriverapp.'
    },
    {
      id: 'runtime.env.example',
      message: '.env.example must document explicit live/mock runtime selection and the live delivery server origin.'
    }
  ]);
});

test('native release preflight rejects accidental Android Contacts permission declarations', () => {
  const input = currentInput();
  const expo = input.appConfig.expo;
  assert.ok(expo);
  assert.ok(expo.android);
  (expo.android as Record<string, unknown>).permissions = ['android.permission.READ_CONTACTS'];

  const result = runNativeReleasePreflight(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    {
      id: 'expo.permissions',
      message: 'Contacts/address-book permissions must stay absent from the driver app native config.'
    }
  ]);
});

test('native release preflight rejects accidental iOS Contacts usage descriptions', () => {
  const input = currentInput();
  const expo = input.appConfig.expo;
  assert.ok(expo);
  assert.ok(expo.ios);
  (expo.ios as Record<string, unknown>).infoPlist = {
    NSContactsUsageDescription: 'Allow Clever Driver to read contacts.'
  };

  const result = runNativeReleasePreflight(input);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    {
      id: 'expo.permissions',
      message: 'Contacts/address-book permissions must stay absent from the driver app native config.'
    }
  ]);
});

test('native release preflight rejects production signing, bundle, and dev-client drift', () => {
  const input = currentInput();
  const cases = [
    {
      expected: 'EAS production profile must explicitly use remote store-signing credentials.',
      patch: { credentialsSource: 'local' },
    },
    {
      expected: 'EAS production profile must not enable the development client.',
      patch: { developmentClient: true },
    },
    {
      expected: 'EAS production Android must build a credentialed app-bundle for Google Play.',
      patch: { android: { buildType: 'apk' } },
    },
    {
      expected: 'EAS production Android must build a credentialed app-bundle for Google Play.',
      patch: { android: { buildType: 'app-bundle', withoutCredentials: true } },
    },
  ] as const;

  for (const testCase of cases) {
    const result = runNativeReleasePreflight({
      ...input,
      easConfig: {
        ...input.easConfig,
        build: {
          ...input.easConfig.build,
          production: {
            ...input.easConfig.build?.production,
            ...testCase.patch,
          },
        },
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [{
      id: 'eas.production',
      message: testCase.expected,
    }]);
  }
});


test('native release preflight validates a source-controlled iOS project when present', () => {
  const input = currentInput();
  const result = runNativeReleasePreflight({
    ...input,
    iosNativeProject: {
      infoPlist: [
        'NSLocationWhenInUseUsageDescription',
        'NSLocationAlwaysAndWhenInUseUsageDescription',
        'NSCameraUsageDescription',
        'NSPhotoLibraryUsageDescription',
      ].join('\n'),
      privacyManifest: '<key>NSPrivacyTracking</key>\n<false/>',
      projectPbxproj: [
        'MARKETING_VERSION = 1.0.1;',
        'CURRENT_PROJECT_VERSION = 1;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.evns.cleverdriverapp;',
      ].join('\n'),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.checks.at(-1)?.id, 'ios.native');
});

test('native release preflight rejects local Apple team pins in source-controlled iOS project', () => {
  const input = currentInput();
  const result = runNativeReleasePreflight({
    ...input,
    iosNativeProject: {
      infoPlist: [
        'NSLocationWhenInUseUsageDescription',
        'NSLocationAlwaysAndWhenInUseUsageDescription',
        'NSCameraUsageDescription',
        'NSPhotoLibraryUsageDescription',
      ].join('\n'),
      privacyManifest: '<key>NSPrivacyTracking</key>\n<false/>',
      projectPbxproj: [
        'DEVELOPMENT_TEAM = Y4RMZPJAA7;',
        'MARKETING_VERSION = 1.0.1;',
        'CURRENT_PROJECT_VERSION = 1;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.evns.cleverdriverapp;',
      ].join('\n'),
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    {
      id: 'ios.native',
      message: 'Source-controlled iOS project must not pin a local Apple DEVELOPMENT_TEAM.'
    }
  ]);
});

test('native release preflight rejects unapproved generated iOS permission copy', () => {
  const input = currentInput();
  const result = runNativeReleasePreflight({
    ...input,
    iosNativeProject: {
      infoPlist: [
        'NSLocationWhenInUseUsageDescription',
        'NSLocationAlwaysAndWhenInUseUsageDescription',
        'NSCameraUsageDescription',
        'NSPhotoLibraryUsageDescription',
        'NSMicrophoneUsageDescription',
      ].join('\n'),
      privacyManifest: '<key>NSPrivacyTracking</key>\n<false/>',
      projectPbxproj: [
        'MARKETING_VERSION = 1.0.1;',
        'CURRENT_PROJECT_VERSION = 1;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.evns.cleverdriverapp;',
      ].join('\n'),
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    {
      id: 'ios.native',
      message: 'Microphone usage description must stay absent until an approved audio feature exists.'
    }
  ]);
});
