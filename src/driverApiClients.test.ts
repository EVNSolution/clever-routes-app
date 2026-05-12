import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiClientsFromRouteAccess } from './driverApiClients';
import { sampleInvitedRouteAccess } from './routeAccess';

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
});
