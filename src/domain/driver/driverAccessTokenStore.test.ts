import assert from 'node:assert/strict';
import test from 'node:test';

import type { DriverAccountAccessToken } from '../driverAuth/driverAuth';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';
import {
  createDriverAccessTokenStore,
  DRIVER_ACCESS_TOKEN_STORAGE_KEY,
  type SecureTokenStorage,
} from './driverAccessTokenStore';

function createMemoryStorage(seed: Record<string, string | null> = {}): SecureTokenStorage & {
  values: Record<string, string | null>;
} {
  const values = { ...seed };
  return {
    values,
    deleteItemAsync: async (key) => { values[key] = null; },
    getItemAsync: async (key) => values[key] ?? null,
    setItemAsync: async (key, value) => { values[key] = value; },
  };
}

function accountAccess(overrides: Partial<DriverAccountAccessToken> = {}): DriverAccountAccessToken {
  return {
    accessToken: 'account-access-token',
    expiresAt: '2026-05-12T07:00:00.000Z',
    refreshToken: 'account-refresh-token',
    refreshTokenExpiresAt: '2026-06-12T07:00:00.000Z',
    tokenType: 'Bearer',
    ttlSeconds: 900,
    use: 'driver_account',
    ...overrides,
  };
}

async function saveAccount(
  store: ReturnType<typeof createDriverAccessTokenStore>,
  access = accountAccess(),
): Promise<void> {
  await store.saveAuthenticatedDriver({
    accountAccess: access,
    phoneE164: '+821089216198',
  });
}

test('saves a phone account before any route is assigned', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.accountAccess.use, 'driver_account');
  assert.deepEqual(restored.driverProfile, { phoneE164: '+821089216198' });
  assert.equal(restored.driverAccess, undefined);
  assert.equal(restored.routeAccess, undefined);
});

test('keeps account access separate when saving selected route access', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.accountAccess.accessToken, 'account-access-token');
  assert.equal(restored.driverAccess?.accessToken, 'fixture-driver-access-token');
  assert.deepEqual(restored.routeAccess, sampleInvitedRouteAccess.routeAccess);
});

test('does not overwrite persisted access for a different active route', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 1,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });
  const saved = await store.saveFromInvitedRouteAccess({
    ...sampleInvitedRouteAccess,
    driverAccess: {
      ...sampleInvitedRouteAccess.driverAccess,
      accessToken: 'different-route-token',
    },
    routeAccess: {
      ...sampleInvitedRouteAccess.routeAccess,
      routePlanId: 'different-route',
    },
  });
  const activeRouteSaved = await store.saveActiveRouteSession({
    navigationStepIndex: 0,
    routePlanId: 'different-route',
  });

  assert.equal(saved, false);
  assert.equal(activeRouteSaved, false);
  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.driverAccess?.accessToken, sampleInvitedRouteAccess.driverAccess.accessToken);
  assert.equal(restored.routeAccess?.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
  assert.equal(restored.activeRouteSession?.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
});

test('serializes concurrent token refresh and active route cleanup', async () => {
  const storage = createMemoryStorage();
  const baseSetItem = storage.setItemAsync;
  let delayNextWrite = false;
  storage.setItemAsync = async (key, value) => {
    if (delayNextWrite) {
      delayNextWrite = false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await baseSetItem(key, value);
  };
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 1,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });
  delayNextWrite = true;
  await Promise.all([
    store.clearActiveRouteSession(),
    store.saveRefreshedAccountAccess(accountAccess({ accessToken: 'refreshed-account-access' })),
  ]);

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.activeRouteSession, undefined);
  assert.equal(restored.accountAccess.accessToken, 'refreshed-account-access');
});

test('refreshes only account access and preserves route and active session', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({ navigationStepIndex: 2, routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId });
  await store.saveRefreshedAccountAccess(accountAccess({ accessToken: 'refreshed-account-access' }));
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.accountAccess.accessToken, 'refreshed-account-access');
  assert.equal(restored.driverAccess?.accessToken, 'fixture-driver-access-token');
  assert.equal(restored.activeRouteSession?.navigationStepIndex, 2);
});

test('keeps a stable route-session generation and route-start acknowledgement', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });
  const startedAt = '2026-05-12T06:44:00.000Z';

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 0,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    startedAt,
  });
  assert.equal(
    await store.markActiveRouteStarted(sampleInvitedRouteAccess.routeAccess.routePlanId, startedAt),
    true,
  );
  await store.saveActiveRouteSession({
    completedStopIds: ['stop-1'],
    navigationStepIndex: 1,
    pickupCompleted: true,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });
  await store.saveActiveRouteSession({
    navigationStepIndex: 2,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.activeRouteSession?.startedAt, startedAt);
  assert.equal(restored.activeRouteSession?.pickupCompletedAt, '2026-05-12T06:45:00.000Z');
  assert.equal(restored.activeRouteSession?.routeStartedRecordedAt, '2026-05-12T06:45:00.000Z');
  assert.deepEqual(restored.activeRouteSession?.completedStopIds, ['stop-1']);
  assert.equal(
    await store.clearActiveRouteSession(
      sampleInvitedRouteAccess.routeAccess.routePlanId,
      '2026-05-12T06:43:00.000Z',
    ),
    false,
  );
  assert.equal(
    await store.clearActiveRouteSession(sampleInvitedRouteAccess.routeAccess.routePlanId, startedAt),
    true,
  );
});

test('clears only the active route session without signing out', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({ navigationStepIndex: 1, routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId });
  await store.clearActiveRouteSession();
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.activeRouteSession, undefined);
  assert.deepEqual(restored.routeAccess, sampleInvitedRouteAccess.routeAccess);
  assert.equal(restored.accountAccess.accessToken, 'account-access-token');
});

test('clears deleted route cache while keeping the account signed in', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({ navigationStepIndex: 1, routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId });
  await store.clearCachedRouteAccess();
  const restored = await store.loadActiveDriverAccess();

  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.accountAccess.accessToken, 'account-access-token');
  assert.equal(restored.driverAccess, undefined);
  assert.equal(restored.routeAccess, undefined);
  assert.equal(restored.activeRouteSession, undefined);
});

test('does not clear targeted route access while that route is active', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T06:45:00.000Z'),
    storage,
  });

  await saveAccount(store);
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({
    navigationStepIndex: 1,
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  });

  assert.equal(
    await store.clearCachedRouteAccess(sampleInvitedRouteAccess.routeAccess.routePlanId),
    false,
  );
  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.activeRouteSession?.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
  assert.equal(restored.driverAccess?.accessToken, sampleInvitedRouteAccess.driverAccess.accessToken);
});

test('returns refresh_required when account access expires but refresh remains valid', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-05-12T07:00:00.000Z'),
    storage,
  });

  await saveAccount(store);
  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'refresh_required');
});

test('clears an account session after both access and refresh expire', async () => {
  const storage = createMemoryStorage();
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-06-13T07:00:00.000Z'),
    storage,
  });

  await saveAccount(store);
  const restored = await store.loadActiveDriverAccess();

  assert.deepEqual(restored, {
    driverProfile: { phoneE164: '+821089216198' },
    kind: 'expired',
  });
  assert.equal(storage.values[DRIVER_ACCESS_TOKEN_STORAGE_KEY], null);
});

test('invalidates legacy and malformed token payloads', async () => {
  const storage = createMemoryStorage({
    [DRIVER_ACCESS_TOKEN_STORAGE_KEY]: JSON.stringify({
      driverAccess: sampleInvitedRouteAccess.driverAccess,
      savedAt: '2026-05-12T06:45:00.000Z',
      schemaVersion: 3,
    }),
  });
  const store = createDriverAccessTokenStore({ storage });

  assert.deepEqual(await store.loadActiveDriverAccess(), { kind: 'invalid' });
  assert.equal(storage.values[DRIVER_ACCESS_TOKEN_STORAGE_KEY], null);
});

test('persists completion_pending across restart until the server receipt is acknowledged', async () => {
  const storage = createMemoryStorage();
  const first = createDriverAccessTokenStore({
    now: () => new Date('2026-08-22T19:42:10.000Z'),
    storage,
  });
  await saveAccount(first, accountAccess({
    expiresAt: '2026-08-23T07:00:00.000Z',
    refreshTokenExpiresAt: '2026-09-12T07:00:00.000Z',
  }));
  await first.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await first.saveActiveRouteSession({ navigationStepIndex: 11, routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId });
  assert.equal(await first.markActiveRouteCompletionPending({
    clientEventId: '01K37KITCHENERCOMPLETE',
    occurredAt: '2026-08-22T19:42:10.000Z',
    routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  }), true);

  const restarted = createDriverAccessTokenStore({
    now: () => new Date('2026-08-22T19:43:00.000Z'),
    storage,
  });
  const restored = await restarted.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  assert.equal(restored.kind === 'active' ? restored.activeRouteSession?.status : null, 'completion_pending');
  assert.equal(restored.kind === 'active' ? restored.activeRouteSession?.completionClientEventId : null, '01K37KITCHENERCOMPLETE');
});
