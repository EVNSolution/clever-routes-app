import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverRuntimeServices, readDriverRuntimeConfig } from './driverRuntimeConfig';

describe('driver runtime API config', () => {
  it('keeps local mock services as the default without a delivery server base URL', async () => {
    const config = readDriverRuntimeConfig({});
    const services = createDriverRuntimeServices({ config });

    const result = await services.routeAccessService.lookupRouteAccess({
      routeContext: 'route-context',
      phoneE164: '+14165550123',
    });

    assert.equal(config.mode, 'mock');
    assert.equal(result.status, 'INVITED');
  });

  it('uses live route access API client when a delivery server base URL is configured', async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    const config = readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'https://delivery.example.com/',
    });
    const services = createDriverRuntimeServices({
      config,
      fetchImpl: async (url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(url) });
        return { ok: true, json: async () => ({ data: { status: 'NOT_FOUND' }, error: null }) };
      },
    });

    const result = await services.routeAccessService.lookupRouteAccess({
      routeContext: 'route-context',
      phoneE164: '+14165550123',
    });

    assert.equal(config.mode, 'live');
    assert.deepEqual(result, { status: 'NOT_FOUND' });
    assert.deepEqual(requests, [
      {
        body: { routeContext: 'route-context', phoneE164: '+14165550123' },
        method: 'POST',
        url: 'https://delivery.example.com/driver/route-access/lookup',
      },
    ]);
  });

  it('uses live driver auth API client when a delivery server base URL is configured', async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    const config = readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'https://delivery.example.com/',
    });
    const services = createDriverRuntimeServices({
      config,
      fetchImpl: async (url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(url) });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'access-token',
              expiresAt: '2026-05-15T00:15:00.000Z',
              refreshToken: 'refresh-token',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
            },
            error: null,
          }),
        };
      },
    });

    const result = await services.driverAuthService.verifyCode({
      inviteCode: 'ABC123',
      phoneE164: '+14165550123',
      displayName: 'Minji Kim',
    });

    assert.equal(result.driverAccess.accessToken, 'access-token');
    assert.equal(result.driverAccess.refreshToken, 'refresh-token');
    assert.deepEqual(requests, [
      {
        body: { phone: '+14165550123', inviteCode: 'ABC123', displayName: 'Minji Kim' },
        method: 'POST',
        url: 'https://delivery.example.com/driver/auth/verify-invite',
      },
    ]);
  });
});
