import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAssignedRouteApiClient,
  createMockAssignedRouteService,
  formatAssignedRouteDistance,
  formatAssignedRouteDuration,
  hasAssignedRouteGeometry,
  formatAssignedRoutePaymentStatus,
  loadAssignedRouteAfterConsent,
  sampleAssignedRoute,
} from './assignedRoute';
import { assignedRouteValidationScenarios } from './assignedRouteValidationScenarios';

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
    assert.equal(formatAssignedRouteDistance(result.route.routeMetrics), '3.3 km');
    assert.equal(formatAssignedRouteDuration(result.route.routeMetrics), '14 min');
    assert.equal(hasAssignedRouteGeometry(result.route), true);
    assert.deepEqual(
      result.route.stops.map((stop) => stop.sequence),
      [1, 2],
    );
    assert.deepEqual(
      result.route.stops.map((stop) => stop.normalizedPaymentStatus),
      ['CASH_COLLECT_REQUIRED', 'TRANSFER_CHECK_PENDING'],
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
      message: 'No current or upcoming route is available for this driver and route context.',
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
    assert.equal(result.route.routeMetrics?.distanceMeters, 3250);
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


  it('accepts additive OSRM route geometry, metrics, and stop snap points from assigned-route responses', async () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.ok(firstStop);
    const client = createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'ASSIGNED_ROUTE',
            route: {
              ...sampleAssignedRoute,
              routeGeometry: {
                coordinates: [
                  [-79.3832, 43.6532],
                  [-79.3817, 43.6487],
                ],
                type: 'LineString',
              },
              routeMetrics: {
                distanceMeters: 980.5,
                durationSeconds: 420,
              },
              routeStopPoints: [
                {
                  deliveryStopId: firstStop.deliveryStopId,
                  inputCoordinates: [-79.3817, 43.6487],
                  name: 'King Street West',
                  sequence: 1,
                  snapDistanceMeters: 3.5,
                  snappedCoordinates: [-79.3818, 43.6488],
                },
              ],
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.deepEqual(result.route.routeMetrics, { distanceMeters: 980.5, durationSeconds: 420 });
    assert.equal(formatAssignedRouteDistance(result.route.routeMetrics), '981 m');
    assert.equal(formatAssignedRouteDuration(result.route.routeMetrics), '7 min');
    assert.equal(result.route.routeGeometry?.coordinates.length, 2);
    assert.equal(result.route.routeStopPoints[0]?.name, 'King Street West');
  });

  it('defines tab-level synthetic validation scenarios with safe coordinates and OSRM evidence expectations', () => {
    assert.deepEqual(
      assignedRouteValidationScenarios.map((scenario) => scenario.tab),
      ['upcoming', 'active', 'completed'],
    );

    for (const scenario of assignedRouteValidationScenarios) {
      assert.equal(scenario.route.name.startsWith('[TEST]'), true);
      assert.equal(scenario.route.shopDomain, 'validation-only.example.test');
      assert.equal(scenario.expectedEvidence.safeForOperationalSmoke, true);
      assert.equal(
        scenario.route.stops.every((stop) => stop.coordinates !== null && stop.orderName.includes('TEST-OSRM')),
        scenario.expectedEvidence.hasCoordinatesForEveryStop,
      );
      assert.equal(hasAssignedRouteGeometry(scenario.route), scenario.expectedEvidence.hasOsrmGeometry);
      assert.equal(scenario.route.routeMetrics !== null, scenario.expectedEvidence.hasOsrmMetrics);
    }
  });

  it('keeps legacy assigned-route responses compatible by defaulting OSRM fields to unavailable', async () => {
    const {
      routeGeometry: _routeGeometry,
      routeMetrics: _routeMetrics,
      routeStopPoints: _routeStopPoints,
      ...legacyRoute
    } = sampleAssignedRoute;
    const client = createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: { status: 'ASSIGNED_ROUTE', route: legacyRoute },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.routeGeometry, null);
    assert.equal(result.route.routeMetrics, null);
    assert.deepEqual(result.route.routeStopPoints, []);
    assert.equal(formatAssignedRouteDistance(result.route.routeMetrics), 'Not available');
    assert.equal(formatAssignedRouteDuration(result.route.routeMetrics), 'Not available');
  });

  it('preserves canonical normalizedPaymentStatus even when legacy payment fields conflict', async () => {
    const routePayload = {
      ...sampleAssignedRoute,
      stops: [
        {
          ...sampleAssignedRoute.stops[0],
          financialStatus: 'Cash',
          normalizedPaymentStatus: 'PAID_CONFIRMED',
          paymentStatus: 'CASH_COLLECT_REQUIRED',
        },
      ],
    };
    const client = createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: { status: 'ASSIGNED_ROUTE', route: routePayload },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: 'route-id' });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.stops[0]?.normalizedPaymentStatus, 'PAID_CONFIRMED');
  });

  it('rejects malformed normalized payment statuses from the assigned-route contract', async () => {
    const routePayload = {
      ...sampleAssignedRoute,
      stops: [
        {
          ...sampleAssignedRoute.stops[0],
          normalizedPaymentStatus: 'cash',
        },
      ],
    };
    const client = createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: { status: 'ASSIGNED_ROUTE', route: routePayload },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: 'route-id' }),
      /Invalid assigned route response/u,
    );
  });

  it('formats all normalized payment states into visible driver copy', () => {
    assert.deepEqual(formatAssignedRoutePaymentStatus('PAID_CONFIRMED'), {
      detail: 'Payment is confirmed in WooCommerce. Do not request payment at delivery.',
      label: 'Paid confirmed',
      tone: 'green',
    });
    assert.equal(formatAssignedRoutePaymentStatus('UNKNOWN_REVIEW').label, 'Review payment');
    assert.equal(formatAssignedRoutePaymentStatus('NOT_DELIVERABLE_OR_EXCEPTION').label, 'Payment exception');
    assert.equal(formatAssignedRoutePaymentStatus(null).label, 'Payment unavailable');
  });
});
