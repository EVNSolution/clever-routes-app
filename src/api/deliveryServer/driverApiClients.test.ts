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
        driverAccess: sampleInvitedRouteAccess.driverAccess,
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
});
