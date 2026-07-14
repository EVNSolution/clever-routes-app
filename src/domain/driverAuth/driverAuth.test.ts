import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAuthApiClient, createMockDriverAuthService } from './driverAuth';

describe('DriverAuthService', () => {
  it('registers with invite and PIN and parses account tokens', async () => {
    let requestBody: any;
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com',
      fetchImpl: async (url: string, init?: any) => {
        requestBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'mock-at',
              expiresAt: '2026-05-15T00:00:00.000Z',
              refreshToken: 'mock-rt',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
          }),
        };
      },
    });

    const result = await client.register({
      phoneE164: '+1234567890',
      inviteCode: '123456',
      pin: '654321',
    });

    assert.equal(requestBody.phone, '+1234567890');
    assert.equal(requestBody.inviteCode, '123456');
    assert.equal(requestBody.pin, '654321');
    assert.equal('displayName' in requestBody, false);
    assert.equal(result.accountAccess.accessToken, 'mock-at');
    assert.equal(result.accountAccess.refreshToken, 'mock-rt');
    assert.equal(result.accountAccess.use, 'driver_account');
  });

  it('refreshes driver access with the stored refresh token', async () => {
    let requestBody: any;
    let requestUrl = '';
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url: string, init?: any) => {
        requestUrl = url;
        requestBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'refreshed-at',
              expiresAt: '2026-05-15T00:15:00.000Z',
              refreshToken: 'stored-rt',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
          }),
        };
      },
    });

    const result = await client.refreshSession({ refreshToken: ' stored-rt ' });

    assert.equal(requestUrl, 'https://test-api.com/driver/auth/refresh');
    assert.deepEqual(requestBody, { refreshToken: 'stored-rt' });
    assert.equal(result.accountAccess.accessToken, 'refreshed-at');
    assert.equal(result.accountAccess.refreshToken, 'stored-rt');
    assert.equal(result.accountAccess.use, 'driver_account');
  });

  it('provides a local mock PIN login without pretending to send SMS', async () => {
    const client = createMockDriverAuthService();

    const result = await client.login({
      phoneE164: '+1234567890',
      pin: '654321',
    });

    assert.equal(result.accountAccess.accessToken, 'fixture-driver-account-access-token');
  });
});
