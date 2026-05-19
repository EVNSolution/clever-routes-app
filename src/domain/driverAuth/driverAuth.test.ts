import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAuthApiClient, createMockDriverAuthService } from './driverAuth';

describe('DriverAuthService', () => {
  it('verifies code and parses tokens properly', async () => {
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
            },
          }),
        };
      },
    });

    const result = await client.verifyCode({
      phoneE164: '+1234567890',
      inviteCode: '123456',
      displayName: 'Minji Kim',
    });

    assert.equal(requestBody.phone, '+1234567890');
    assert.equal(requestBody.inviteCode, '123456');
    assert.equal(requestBody.displayName, 'Minji Kim');
    assert.equal(result.driverAccess.accessToken, 'mock-at');
    assert.equal(result.driverAccess.refreshToken, 'mock-rt');
    assert.equal(result.driverAccess.use, 'consent_and_assigned_route');
  });

  it('provides a local mock verifier without pretending to send codes', async () => {
    const client = createMockDriverAuthService();

    const result = await client.verifyCode({
      phoneE164: '+1234567890',
      inviteCode: 'ABC123',
      displayName: 'Minji Kim',
    });

    assert.equal(result.driverAccess.accessToken, 'fixture-driver-access-token');
  });
});
