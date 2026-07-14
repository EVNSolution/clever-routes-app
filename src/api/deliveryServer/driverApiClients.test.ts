import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverApiClientsFromPersistedDriverAccess,
  createDriverApiClientsFromRouteAccess,
} from './driverApiClients';
import { sampleInvitedRouteAccess } from '../../domain/routeAccess/routeAccess';

describe('driver API client token handoff', () => {
  it('builds consent and assigned-route clients from route access token evidence', async () => {
    const requests: { headers: Record<string, string>; method: string; url: string }[] = [];
    const clients = createDriverApiClientsFromRouteAccess({
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          headers: init?.headers ?? {},
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          json: async () => ({
            data: String(url).includes('/driver/consents')
              ? {
                  status: 'CONSENT_RECORDED',
                  recordedAt: '2026-05-12T06:55:00.000Z',
                  records: [
                    { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
                    { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
                  ],
                }
              : { status: 'NO_ASSIGNED_ROUTE' },
            error: null,
          }),
        };
      },
      routeAccess: sampleInvitedRouteAccess,
    });

    await clients.driverConsentService.recordDriverConsents({
      appContext: null,
      consents: [
        { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
        { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
      ],
      deviceContext: null,
      recordedAt: new Date('2026-05-12T06:55:00.000Z'),
      routeContext: sampleInvitedRouteAccess.routeAccess.routeContext,
    });
    await clients.assignedRouteService.getAssignedRoute({
      routeContext: sampleInvitedRouteAccess.routeAccess.routeContext,
    });

    assert.deepEqual(
      requests.map((request) => request.headers.Authorization),
      ['Bearer fixture-driver-access-token', 'Bearer fixture-driver-access-token'],
    );
  });

  it('builds downstream clients from active persisted driver access', async () => {
    const requests: { headers: Record<string, string>; url: string }[] = [];
    const clients = createDriverApiClientsFromPersistedDriverAccess({
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({ headers: init?.headers ?? {}, url: String(url) });
        return {
          ok: true,
          json: async () => ({ data: { status: 'NO_ASSIGNED_ROUTE' }, error: null }),
        };
      },
      persistedAccess: {
        accountAccess: {
          accessToken: 'account-access-token',
          expiresAt: '2026-05-12T07:10:00.000Z',
          refreshToken: 'account-refresh-token',
          refreshTokenExpiresAt: '2026-06-12T07:00:00.000Z',
          tokenType: 'Bearer',
          ttlSeconds: 900,
          use: 'driver_account',
        },
        driverAccess: sampleInvitedRouteAccess.driverAccess,
        driverProfile: { phoneE164: '+14165550123' },
        routeAccess: sampleInvitedRouteAccess.routeAccess,
      },
    });

    await clients.assignedRouteService.getAssignedRoute({
      routeContext: sampleInvitedRouteAccess.routeAccess.routeContext,
    });

    assert.equal(requests[0]?.headers.Authorization, 'Bearer fixture-driver-access-token');
    assert.equal(
      requests[0]?.url,
      'https://delivery.example.com/driver/assigned-route?routeContext=11111111-1111-4111-8111-111111111111',
    );
  });

  it('retries a driver API call once with refreshed access after an expired driver token', async () => {
    const requests: { headers: Record<string, string>; url: string }[] = [];
    let refreshCount = 0;
    const clients = createDriverApiClientsFromRouteAccess({
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({ headers: init?.headers ?? {}, url: String(url) });

        if (requests.length === 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ data: null, error: { code: 'UNAUTHORIZED' } }),
          };
        }

        return {
          ok: true,
          json: async () => ({ data: { status: 'NO_ASSIGNED_ROUTE' }, error: null }),
        };
      },
      refreshDriverAccess: async () => {
        refreshCount += 1;
        return {
          ...sampleInvitedRouteAccess.driverAccess,
          accessToken: 'fresh-driver-token',
        };
      },
      routeAccess: sampleInvitedRouteAccess,
    });

    await clients.assignedRouteService.getAssignedRoute({
      routeContext: sampleInvitedRouteAccess.routeAccess.routeContext,
    });

    assert.equal(refreshCount, 1);
    assert.deepEqual(
      requests.map((request) => request.headers.Authorization),
      ['Bearer fixture-driver-access-token', 'Bearer fresh-driver-token'],
    );
  });
});
