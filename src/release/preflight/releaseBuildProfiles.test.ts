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
