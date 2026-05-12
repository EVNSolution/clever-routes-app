import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  runNativeReleasePreflight,
  type NativeReleasePreflightInput
} from './nativeReleasePreflight';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
      'runtime.env.example'
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
      message: '.env.example must document EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL for live API mode.'
    }
  ]);
});
