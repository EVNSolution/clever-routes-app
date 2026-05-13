import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAssignedRouteApiClient,
  createMockAssignedRouteService,
  loadAssignedRouteAfterConsent,
  sampleAssignedRoute,
} from './assignedRoute';

describe('driver assigned route UX flow', () => {
  it('blocks route reads before consent is recorded', async () => {
    let calls = 0;
    const result = await loadAssignedRouteAfterConsent(
      {
        consentState: 'consent_required',
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
      {
        getAssignedRoute: async () => {
          calls += 1;
          return { status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute };
        },
      },
    );

    assert.equal(calls, 0);
    assert.deepEqual(result, {
      flowState: 'consent_required',
      kind: 'blocked_until_consent',
      message: 'Record required consent before loading assigned route details.',
    });
  });

  it('maps an assigned route response to route_ready with ordered stop context', async () => {
    const result = await loadAssignedRouteAfterConsent(
      {
        consentState: 'consent_recorded',
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
      createMockAssignedRouteService(),
    );

    assert.equal(result.kind, 'route_ready');
    assert.equal(result.flowState, 'route_ready');
    assert.equal(result.route.name, 'Tuesday AM Route');
    assert.equal(result.route.stops.length, 2);
    assert.deepEqual(
      result.route.stops.map((stop) => stop.sequence),
      [1, 2],
    );
    assert.equal(JSON.stringify(result).includes('tomatono.myshopify.com'), true);
  });

  it('keeps the route screen safe when no route is assigned', async () => {
    const result = await loadAssignedRouteAfterConsent(
      {
        consentState: 'consent_recorded',
        routeContext: 'missing-route',
      },
      createMockAssignedRouteService({ status: 'NO_ASSIGNED_ROUTE' }),
    );

    assert.deepEqual(result, {
      flowState: 'consent_recorded',
      kind: 'no_assigned_route',
      message: 'No assigned route is available for this driver and route context today.',
    });
  });

  it('keeps consent_recorded state when assigned route loading fails', async () => {
    const result = await loadAssignedRouteAfterConsent(
      {
        consentState: 'consent_recorded',
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
      {
        getAssignedRoute: async () => {
          throw new Error('network down');
        },
      },
    );

    assert.deepEqual(result, {
      flowState: 'consent_recorded',
      kind: 'route_error',
      message: 'Assigned route could not be loaded. Check the connection and try again.',
    });
  });

  it('keeps route details hidden and asks for route lookup again when live assigned-route returns unauthorized', async () => {
    const client = createAssignedRouteApiClient({
      accessToken: 'expired-driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Invalid driver bearer token' },
        }),
      }),
    });

    const result = await loadAssignedRouteAfterConsent(
      {
        consentState: 'consent_recorded',
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
      client,
    );

    assert.deepEqual(result, {
      flowState: 'consent_recorded',
      kind: 'route_error',
      message: 'Driver session expired. Look up the route with route context and phone again.',
      reason: 'driver_access_expired',
    });
  });

  it('gets assigned route from the delivery-server contract endpoint', async () => {
    const requests: { cache?: string; credentials?: string; headers: Record<string, string>; method: string; url: string }[] = [];
    const client = createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          cache: init?.cache,
          credentials: init?.credentials,
          headers: init?.headers ?? {},
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          json: async () => ({
            data: { status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute },
            error: null,
          }),
        };
      },
    });

    const result = await client.getAssignedRoute({
      routeContext: '11111111-1111-4111-8111-111111111111',
    });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.deepEqual(requests, [
      {
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          Authorization: 'Bearer driver.jwt',
        },
        method: 'GET',
        url: 'https://delivery.example.com/driver/assigned-route?routeContext=11111111-1111-4111-8111-111111111111',
      },
    ]);
  });
});
