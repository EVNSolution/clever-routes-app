import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDriverAccessTokenStore,
  DRIVER_ACCESS_TOKEN_STORAGE_KEY,
  type SecureTokenStorage,
} from './driverAccessTokenStore';
import { sampleInvitedRouteAccess } from './routeAccess';

function createMemoryStorage(seed: Record<string, string | null> = {}): SecureTokenStorage & { values: Record<string, string | null> } {
  const values = { ...seed };
  return {
    values,
    deleteItemAsync: async (key) => {
      values[key] = null;
    },
    getItemAsync: async (key) => values[key] ?? null,
    setItemAsync: async (key, value) => {
      values[key] = value;
    },
  };
}

test('saves route lookup driver access and restores it before expiry', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }
  assert.deepEqual(restored.routeAccess, sampleInvitedRouteAccess.routeAccess);
  assert.deepEqual(restored.driverAccess, sampleInvitedRouteAccess.driverAccess);
});

test('clears and refuses to restore an expired driver access token', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T07:00:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  const restored = await store.loadActiveDriverAccess();

  assert.deepEqual(restored, { kind: 'expired' });
  assert.equal(storage.values[DRIVER_ACCESS_TOKEN_STORAGE_KEY], null);
});

test('clears malformed persisted token payloads instead of reusing them', async () => {
  const storage = createMemoryStorage({
    [DRIVER_ACCESS_TOKEN_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, driverAccess: { accessToken: 'missing fields' } }),
  });
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  const restored = await store.loadActiveDriverAccess();

  assert.deepEqual(restored, { kind: 'invalid' });
  assert.equal(storage.values[DRIVER_ACCESS_TOKEN_STORAGE_KEY], null);
});
