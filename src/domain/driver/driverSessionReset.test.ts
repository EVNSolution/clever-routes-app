import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAccessTokenStore, DRIVER_ACCESS_TOKEN_STORAGE_KEY } from './driverAccessTokenStore';
import { resetDriverSession } from './driverSessionReset';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';

describe('driver session reset cleanup', () => {
  it('clears secure driver access and pending offline submissions', async () => {
    const deletedKeys: string[] = [];
    const storage = new Map<string, string>();
    const tokenStore = createDriverAccessTokenStore({
      now: () => new Date('2026-05-12T06:50:00.000Z'),
      storage: {
        deleteItemAsync: async (key) => {
          deletedKeys.push(key);
          storage.delete(key);
        },
        getItemAsync: async (key) => storage.get(key) ?? null,
        setItemAsync: async (key, value) => {
          storage.set(key, value);
        },
      },
    });
    await tokenStore.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);

    const queue = createInMemoryOfflineSubmissionQueue({ now: () => new Date('2026-05-12T06:50:00.000Z') });
    queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      deliveryStopId: null,
      eventType: 'ROUTE_STARTED',
      occurredAt: new Date('2026-05-12T06:50:00.000Z'),
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      uri: 'file:///proof/stop-1.jpg',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      source: 'camera',
    });

    const result = await resetDriverSession({
      driverAccessTokenStore: tokenStore,
      offlineQueue: queue,
    });

    assert.deepEqual(result, {
      clearedDriverAccess: true,
      clearedOfflineSubmissions: 2,
      kind: 'reset',
    });
    assert.deepEqual(deletedKeys, [DRIVER_ACCESS_TOKEN_STORAGE_KEY]);
    assert.deepEqual(await tokenStore.loadActiveDriverAccess(), { kind: 'missing' });
    assert.deepEqual(queue.listPending(), []);
  });

  it('waits for queue persistence after clearing retry state', async () => {
    let clearCalls = 0;
    let persisted = false;

    const result = await resetDriverSession({
      driverAccessTokenStore: {
        clear: async () => undefined,
      },
      offlineQueue: {
        clear: () => {
          clearCalls += 1;
          return 3;
        },
        whenPersisted: async () => {
          persisted = true;
        },
      },
    });

    assert.equal(clearCalls, 1);
    assert.equal(persisted, true);
    assert.equal(result.clearedOfflineSubmissions, 3);
  });
});
