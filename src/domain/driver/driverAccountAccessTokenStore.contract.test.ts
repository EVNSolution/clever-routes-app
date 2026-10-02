import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createDriverAccessTokenStore, type SecureTokenStorage } from './driverAccessTokenStore';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';

it('keeps account auth separate from the selected route driver token', async () => {
  const values: Record<string, string | null> = {};
  const storage: SecureTokenStorage = {
    deleteItemAsync: async (key) => { values[key] = null; },
    getItemAsync: async (key) => values[key] ?? null,
    setItemAsync: async (key, value) => { values[key] = value; },
  };
  const store = createDriverAccessTokenStore({
    now: () => new Date('2026-07-14T07:00:00.000Z'),
    storage,
  });

  await store.saveAuthenticatedDriver({
    accountAccess: {
      accessToken: 'account-access-token',
      expiresAt: '2026-07-14T07:15:00.000Z',
      refreshToken: 'account-refresh-token',
      refreshTokenExpiresAt: '2026-08-13T07:00:00.000Z',
      tokenType: 'Bearer',
      ttlSeconds: 900,
      use: 'driver_account',
    },
    phoneE164: '+821012345678',
  });
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);

  const restored = await store.loadActiveDriverAccess();
  assert.equal(restored.kind, 'active');
  if (restored.kind !== 'active') return;
  assert.equal(restored.accountAccess.accessToken, 'account-access-token');
  assert.equal(restored.driverAccess?.accessToken, sampleInvitedRouteAccess.driverAccess.accessToken);
  assert.deepEqual(restored.driverProfile, { phoneE164: '+821012345678' });
});
