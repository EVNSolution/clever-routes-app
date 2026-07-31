import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyDriverAppUpdate,
  readDriverAppReleaseManifest,
  shouldPresentDriverAppUpdate,
} from './driverAppUpdate';

const releasePayload = {
  distributionChannel: 'direct',
  installUrl: 'https://delivery.example.com/routes-app',
  latestVersionCode: 3,
  latestVersionName: '1.1.0',
  minimumSupportedVersionCode: 2,
  platform: 'android',
} as const;

describe('driver app update classification', () => {
  it('distinguishes current, optional, and required direct releases by versionCode', () => {
    const release = readDriverAppReleaseManifest(releasePayload);

    assert.equal(classifyDriverAppUpdate({ currentVersionCode: 3, release }).kind, 'up_to_date');
    assert.equal(classifyDriverAppUpdate({ currentVersionCode: 2, release }).kind, 'optional_update');
    assert.equal(classifyDriverAppUpdate({ currentVersionCode: 1, release }).kind, 'required_update');
  });

  it('accepts only a consistent direct Android release contract', () => {
    assert.deepEqual(readDriverAppReleaseManifest(releasePayload), releasePayload);

    for (const invalidPayload of [
      { ...releasePayload, distributionChannel: 'play' },
      { ...releasePayload, installUrl: 'file:///tmp/driver.apk' },
      { ...releasePayload, latestVersionCode: 0 },
      { ...releasePayload, latestVersionCode: 2.5 },
      { ...releasePayload, latestVersionName: ' ' },
      { ...releasePayload, minimumSupportedVersionCode: 4 },
      { ...releasePayload, platform: 'ios' },
    ]) {
      assert.throws(() => readDriverAppReleaseManifest(invalidPayload));
    }
  });

  it('never covers restore, route loading, or an active delivery', () => {
    const optionalState = classifyDriverAppUpdate({
      currentVersionCode: 2,
      release: readDriverAppReleaseManifest(releasePayload),
    });

    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: null,
      hasActiveRoute: false,
      isRestoreComplete: true,
      isRouteSyncLoading: false,
      state: optionalState,
    }), true);
    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: null,
      hasActiveRoute: true,
      isRestoreComplete: true,
      isRouteSyncLoading: false,
      state: optionalState,
    }), false);
    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: null,
      hasActiveRoute: false,
      isRestoreComplete: false,
      isRouteSyncLoading: false,
      state: optionalState,
    }), false);
    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: null,
      hasActiveRoute: false,
      isRestoreComplete: true,
      isRouteSyncLoading: true,
      state: optionalState,
    }), false);
    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: 3,
      hasActiveRoute: false,
      isRestoreComplete: true,
      isRouteSyncLoading: false,
      state: optionalState,
    }), false);
  });
});
