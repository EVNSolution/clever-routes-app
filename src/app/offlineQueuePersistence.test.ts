import assert from 'node:assert/strict';
import { it } from 'node:test';

import { persistOfflineQueueAndSyncState } from './offlineQueuePersistence';

it('syncs the degraded storage state even when terminal queue persistence rejects', async () => {
  const queue = {
    storageState: () => 'STORAGE_DEGRADED' as const,
    whenPersisted: async () => {
      throw new Error('disk full');
    },
  };
  let visibleStorageState = 'READY';

  await assert.rejects(
    persistOfflineQueueAndSyncState(queue, (settledQueue) => {
      visibleStorageState = settledQueue.storageState();
    }),
    /disk full/u,
  );

  assert.equal(visibleStorageState, 'STORAGE_DEGRADED');
});
