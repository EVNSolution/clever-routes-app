import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDriverAccessTokenStore,
  DRIVER_ACCESS_TOKEN_STORAGE_KEY,
  type SecureTokenStorage,
} from './driverAccessTokenStore';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';

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

test('saves verified driver profile before any route is assigned', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveVerifiedDriver({
    displayName: 'Minji Kim',
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      refreshToken: 'valid-rt',
      refreshTokenExpiresAt: '2026-06-12T06:55:00.000Z',
    },
    phoneE164: '+821089216198',
  });
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }
  assert.deepEqual(restored.driverProfile, {
    displayName: 'Minji Kim',
    phoneE164: '+821089216198',
  });
  assert.equal(restored.routeAccess, undefined);
});

test('preserves verified driver profile when saving route access later', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveVerifiedDriver({
    displayName: 'Minji Kim',
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      refreshToken: 'valid-rt',
      refreshTokenExpiresAt: '2026-06-12T06:55:00.000Z',
    },
    phoneE164: '+821089216198',
  });
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }
  assert.deepEqual(restored.driverProfile, {
    displayName: 'Minji Kim',
    phoneE164: '+821089216198',
  });
  assert.deepEqual(restored.routeAccess, sampleInvitedRouteAccess.routeAccess);
});

test('preserves verified refresh token when route lookup access is saved later', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveVerifiedDriver({
    displayName: 'Minji Kim',
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      accessToken: 'verified-access-token',
      refreshToken: 'valid-rt',
      refreshTokenExpiresAt: '2026-06-12T06:55:00.000Z',
    },
    phoneE164: '+821089216198',
  });
  await store.saveFromInvitedRouteAccess({
    ...sampleInvitedRouteAccess,
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      accessToken: 'route-lookup-access-token',
    },
  });
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }
  assert.equal(restored.driverAccess.accessToken, 'route-lookup-access-token');
  assert.equal(restored.driverAccess.refreshToken, 'valid-rt');
  assert.equal(restored.driverAccess.refreshTokenExpiresAt, '2026-06-12T06:55:00.000Z');
});


test('saves and restores the active in-progress route session', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 2,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }

  assert.deepEqual(restored.activeRouteSession, {
    navigationStepIndex: 2,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    status: 'active',
    updatedAt: '2026-05-12T06:45:00.000Z',
  });
});

test('preserves active route session when route access refreshes', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 1,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }

  assert.equal(restored.activeRouteSession?.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
  assert.equal(restored.activeRouteSession?.navigationStepIndex, 1);
});

test('clears only the active route session without signing the driver out', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 1,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });
  await store.clearActiveRouteSession();

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') {
    return;
  }

  assert.equal(restored.activeRouteSession, undefined);
  assert.deepEqual(restored.routeAccess, sampleInvitedRouteAccess.routeAccess);
});

test('clears and refuses to restore an expired driver access token', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T07:00:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  const restored = await store.loadActiveDriverAccess();

  assert.deepEqual(restored, { kind: 'expired', isReturningDriver: true, routeAccess: sampleInvitedRouteAccess.routeAccess });
  assert.equal(storage.values[DRIVER_ACCESS_TOKEN_STORAGE_KEY], null);
});

test('returns refresh_required when AT is expired but RT is valid', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T07:00:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess({
    ...sampleInvitedRouteAccess,
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      expiresAt: '2026-05-12T06:55:00.000Z',
      refreshToken: 'valid-rt',
      refreshTokenExpiresAt: '2026-06-12T06:55:00.000Z',
    }
  });

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'refresh_required');
});

test('returns expired with isReturningDriver when both AT and RT are expired', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-06-13T07:00:00.000Z'),
    storage,
  });

  await store.saveFromInvitedRouteAccess({
    ...sampleInvitedRouteAccess,
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      expiresAt: '2026-05-12T06:55:00.000Z',
      refreshToken: 'expired-rt',
      refreshTokenExpiresAt: '2026-06-12T06:55:00.000Z',
    }
  });

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'expired');
  if (restored.kind === 'expired') {
    assert.equal(restored.isReturningDriver, true);
  }
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
