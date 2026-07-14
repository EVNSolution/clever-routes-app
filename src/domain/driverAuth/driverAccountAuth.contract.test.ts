import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAuthApiClient } from './driverAuth';

const accountEnvelope = {
  data: {
    accessToken: 'account-access-token',
    expiresAt: '2026-07-14T08:00:00.000Z',
    refreshToken: 'account-refresh-token',
    refreshTokenExpiresAt: '2026-08-13T08:00:00.000Z',
    tokenType: 'Bearer',
    ttlSeconds: 900,
    use: 'driver_account',
  },
  error: null,
};

describe('driver phone PIN auth contract', () => {
  it('logs an existing account in with phone and six-digit PIN', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    const client = createDriverAuthApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (url, init) => {
        requestUrl = url;
        requestBody = JSON.parse(init?.body ?? '{}') as unknown;
        return { json: async () => accountEnvelope, ok: true, status: 200 };
      },
    });

    const result = await client.login({ phoneE164: '+821012345678', pin: '012345' });

    assert.equal(requestUrl, 'https://delivery.example.com/driver/auth/login');
    assert.deepEqual(requestBody, { phone: '+821012345678', pin: '012345' });
    assert.equal(result.accountAccess.use, 'driver_account');
  });

  it('registers a first-time account without sending a display name', async () => {
    let requestBody: Record<string, unknown> = {};
    const client = createDriverAuthApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
        return { json: async () => accountEnvelope, ok: true, status: 200 };
      },
    });

    await client.register({ phoneE164: '+821012345678', inviteCode: 'ABC123', pin: '012345' });

    assert.deepEqual(requestBody, {
      phone: '+821012345678',
      inviteCode: 'ABC123',
      pin: '012345',
    });
    assert.equal('displayName' in requestBody, false);
  });
});
