import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverRuntimeServices, readDriverRuntimeConfig } from './driverRuntimeConfig';

describe('driver runtime API config', () => {
  it('uses local mock services only when mock mode is explicit', async () => {
    const config = readDriverRuntimeConfig({ EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'mock' });
    const services = createDriverRuntimeServices({ config });

    const result = await services.routeAccessService.lookupRouteAccess({
      accountAccessToken: 'account-access-token',
      routeContext: 'route-context',
    });

    assert.equal(config.mode, 'mock');
    assert.equal(result.status, 'INVITED');
  });

  it('fails closed when neither a live server nor explicit mock mode is configured', () => {
    assert.throws(
      () => readDriverRuntimeConfig({}),
      /EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL is required unless EXPO_PUBLIC_DRIVER_RUNTIME_MODE=mock/u,
    );
  });

  it('rejects ambiguous mock mode with a live server origin', () => {
    assert.throws(
      () => readDriverRuntimeConfig({
        EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'https://delivery.example.com',
        EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'mock',
      }),
      /Mock mode cannot include EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL/u,
    );
  });

  it('rejects an insecure live server origin', () => {
    assert.throws(
      () => readDriverRuntimeConfig({
        EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'http://delivery.example.com',
        EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'live',
      }),
      /must use HTTPS/u,
    );
  });

  it('uses live route access API client when a delivery server base URL is configured', async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    const config = readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'https://delivery.example.com/',
      EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'live',
    });
    const services = createDriverRuntimeServices({
      config,
      fetchImpl: async (url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)), method: String(init?.method), url: String(url) });
        return { ok: true, json: async () => ({ data: { status: 'NOT_FOUND' }, error: null }) };
      },
    });

    const result = await services.routeAccessService.lookupRouteAccess({
      accountAccessToken: 'account-access-token',
      routeContext: 'route-context',
    });

    assert.equal(config.mode, 'live');
    assert.deepEqual(result, { status: 'NOT_FOUND' });
    assert.deepEqual(requests, [
      {
        body: { routeContext: 'route-context' },
        method: 'POST',
        url: 'https://delivery.example.com/driver/route-access/lookup',
      },
    ]);
  });

  it('uses live driver auth API client when a delivery server base URL is configured', async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    const config = readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: 'https://delivery.example.com/',
      EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'live',
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
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
            error: null,
          }),
        };
      },
    });

    const result = await services.driverAuthService.register({
      inviteCode: 'ABC123',
      phoneE164: '+14165550123',
      pin: '654321',
    });

    assert.equal(result.accountAccess.accessToken, 'access-token');
    assert.equal(result.accountAccess.refreshToken, 'refresh-token');
    assert.deepEqual(requests, [
      {
        body: { phone: '+14165550123', inviteCode: 'ABC123', pin: '654321' },
        method: 'POST',
        url: 'https://delivery.example.com/driver/auth/verify-invite',
      },
    ]);
  });
});
