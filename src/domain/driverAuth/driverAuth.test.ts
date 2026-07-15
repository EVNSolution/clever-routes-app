import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAuthApiClient, createMockDriverAuthService } from './driverAuth';

describe('DriverAuthService', () => {
  it('reads and updates the phone-account profile with the account bearer', async () => {
    const requests: { body?: string; headers?: Record<string, string>; method?: string; url: string }[] = [];
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          ...(init?.body === undefined ? {} : { body: init.body }),
          headers: init?.headers,
          method: init?.method,
          url,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              account: {
                name: init?.method === 'PATCH' ? '임 지인' : null,
                phone: '+821089216198',
              },
            },
            error: null,
          }),
        };
      },
    });

    const loaded = await client.getAccountProfile({ accountAccessToken: ' account-token ' });
    const updated = await client.updateAccountProfile({
      accountAccessToken: ' account-token ',
      name: '  임 지인  ',
    });

    assert.deepEqual(loaded.account, { name: null, phone: '+821089216198' });
    assert.deepEqual(updated.account, { name: '임 지인', phone: '+821089216198' });
    assert.deepEqual(requests, [
      {
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
        method: 'GET',
        url: 'https://test-api.com/driver/account/profile',
      },
      {
        body: JSON.stringify({ name: '임 지인' }),
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Pragma: 'no-cache',
        },
        method: 'PATCH',
        url: 'https://test-api.com/driver/account/profile',
      },
    ]);
  });

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
