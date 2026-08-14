import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyDriverAppUpdate,
  readDriverAppReleaseManifest,
  shouldPresentDriverAppUpdate,
} from './driverAppUpdate';

const releasePayload = {
  distributionChannel: 'direct',
  installation: {
    guideUrl: 'https://delivery.example.com/driver-app',
    mode: 'package_migration',
    replacesPackageIds: ['com.evns.cleverdriverapp'],
    targetPackageId: 'com.evnsolution.clever.routes',
  },
  installUrl: 'https://delivery.example.com/routes-app',
  latestVersionCode: 3,
  latestVersionName: '1.1.0',
  minimumSupportedVersionCode: 2,
  platform: 'android',
} as const;

describe('driver app update classification', () => {
  it('distinguishes current, optional, and required direct releases by versionCode', () => {
    const release = readDriverAppReleaseManifest(releasePayload);

    assert.equal(classifyDriverAppUpdate({
      currentPackageId: 'com.evnsolution.clever.routes',
      currentVersionCode: 3,
      release,
    }).kind, 'up_to_date');
    assert.equal(classifyDriverAppUpdate({
      currentPackageId: 'com.evnsolution.clever.routes',
      currentVersionCode: 2,
      release,
    }).kind, 'optional_update');
    assert.equal(classifyDriverAppUpdate({
      currentPackageId: 'com.evnsolution.clever.routes',
      currentVersionCode: 1,
      release,
    }).kind, 'required_update');
  });

  it('requires a reinstall when the installed Android package is the legacy identity', () => {
    const release = readDriverAppReleaseManifest(releasePayload);

    assert.equal(classifyDriverAppUpdate({
      currentPackageId: 'com.evns.cleverdriverapp',
      currentVersionCode: 3,
      release,
    }).kind, 'required_reinstall');
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
      { ...releasePayload, installation: null },
      {
        ...releasePayload,
        installation: {
          ...releasePayload.installation,
          guideUrl: 'file:///tmp/reinstall.html',
        },
      },
      {
        ...releasePayload,
        installation: {
          ...releasePayload.installation,
          mode: 'upgrade',
        },
      },
      {
        ...releasePayload,
        installation: {
          ...releasePayload.installation,
          replacesPackageIds: [],
        },
      },
      {
        ...releasePayload,
        installation: {
          ...releasePayload.installation,
          targetPackageId: ' ',
        },
      },
    ]) {
      assert.throws(() => readDriverAppReleaseManifest(invalidPayload));
    }
  });

  it('keeps automatic checks out of active delivery but presents an explicit refresh result', () => {
    const optionalState = classifyDriverAppUpdate({
      currentPackageId: 'com.evnsolution.clever.routes',
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
      dismissedVersionCode: 3,
      explicitRefreshRequested: true,
      hasActiveRoute: true,
      isRestoreComplete: true,
      isRouteSyncLoading: false,
      state: optionalState,
    }), true);
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

  it('never allows a package migration reinstall to be dismissed', () => {
    const reinstallState = classifyDriverAppUpdate({
      currentPackageId: 'com.evns.cleverdriverapp',
      currentVersionCode: 3,
      release: readDriverAppReleaseManifest(releasePayload),
    });

    assert.equal(shouldPresentDriverAppUpdate({
      dismissedVersionCode: 3,
      hasActiveRoute: false,
      isRestoreComplete: true,
      isRouteSyncLoading: false,
      state: reinstallState,
    }), true);
  });
});
