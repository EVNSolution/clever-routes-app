import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const locationServicePath = join(currentDirectory, 'expoContinuousLocationStreamService.ts');
const queueStoragePath = join(currentDirectory, '..', 'storage', 'expoOfflineSubmissionQueueStorage.ts');
const secureStorePath = join(currentDirectory, '..', 'secureStore', 'expoSecureDriverAccessTokenStore.ts');
const appRootPath = join(currentDirectory, '..', '..', '..', 'app', 'AppRoot.tsx');

describe('Expo continuous location wiring', () => {
  it('binds the global TaskManager executor to persisted task processing', () => {
    const source = readFileSync(locationServicePath, 'utf8');

    assert.match(source, /processContinuousLocationTaskBatch/u);
    assert.match(source, /getExpoOfflineSubmissionQueue/u);
    assert.match(source, /stopContinuousLocationTaskIfInactive/u);
    assert.match(source, /activeTaskExecutions/u);
    assert.match(source, /ensureLocationUpdatesStarted/u);
    assert.doesNotMatch(source, /let continuousLocationTaskHandler/u);
    assert.doesNotMatch(source, /registerContinuousLocationTaskHandler/u);
  });

  it('shares one lazy persistent queue between AppRoot and the background task', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const locationSource = readFileSync(locationServicePath, 'utf8');
    const storageSource = readFileSync(queueStoragePath, 'utf8');
    const secureStoreSource = readFileSync(secureStorePath, 'utf8');

    assert.match(appSource, /getExpoOfflineSubmissionQueue/u);
    assert.match(locationSource, /getExpoOfflineSubmissionQueue/u);
    assert.match(storageSource, /offlineSubmissionQueuePromise/u);
    assert.match(secureStoreSource, /driverAccessTokenStore \?\?=/u);
  });
});
