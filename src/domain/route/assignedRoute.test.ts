import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAssignedRouteApiClient,
  createMockAssignedRouteService,
  formatAssignedRouteDistance,
  formatAssignedRouteDuration,
  formatAssignedRouteEta,
  formatAssignedRoutePickupTiming,
  formatAssignedRouteItemLine,
  formatAssignedRouteCompactPaymentAmount,
  hasAssignedRouteGeometry,
  formatAssignedRoutePaymentStatus,
  formatAssignedRoutePaymentSummary,
  isAssignedRoutePickupStop,
  loadAssignedRouteAfterConsent,
  resolveRouteMapPreviewState,
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
    assert.equal(formatAssignedRouteEta(result.route.stops[0]?.estimatedArrivalAt, result.route.timezone), '7:08 AM');
    assert.equal(hasAssignedRouteGeometry(result.route), true);
    assert.deepEqual(
      result.route.stops.map((stop) => stop.sequence),
      [1, 2],
    );
    assert.deepEqual(
      result.route.stops.map((stop) => stop.normalizedPaymentStatus),
      ['CASH_COLLECT_REQUIRED', 'TRANSFER_CHECK_PENDING'],
    );
    assert.equal(result.route.stops[0]?.items[0]?.name, 'Tomato box');
    assert.equal(result.route.stops[0]?.customerNote, null);
    assert.equal(result.route.stops[0]?.distanceFromPreviousMeters, null);
    assert.equal(formatAssignedRouteItemLine(result.route.stops[0]!.items[0]!), 'Tomato box (Size: Large): 2');
    assert.equal(JSON.stringify(result).includes('tomatono.myshopify.com'), true);
  });

  it('formats pickup timing from the scheduled start and route duration', () => {
    assert.deepEqual(
      formatAssignedRoutePickupTiming(
        {
          ...sampleAssignedRoute,
          routeMetrics: { distanceMeters: 58_000, durationSeconds: 10_320 },
          scheduledStartAt: '2026-08-07T02:30:00.000Z',
          timezone: 'America/Toronto',
        },
        Date.parse('2026-08-07T02:21:30.000Z'),
      ),
      {
        finish: '1:22 AM',
        leave: 'In 9 min',
        routeTime: '2 hr 52 min',
      },
    );
  });

  it('starts pickup timing now when the schedule is missing or has passed', () => {
    assert.deepEqual(
      formatAssignedRoutePickupTiming(
        {
          ...sampleAssignedRoute,
          routeMetrics: { distanceMeters: 9_600, durationSeconds: 1_080 },
          scheduledStartAt: null,
          timezone: 'America/Toronto',
        },
        Date.parse('2026-08-07T02:30:00.000Z'),
      ),
      {
        finish: '10:48 PM',
        leave: 'Now',
        routeTime: '18 min',
      },
    );
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
      message: 'No ready or in-progress route is available for this driver and route context.',
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


  it('accepts assigned routes when the server omits shop timezone', async () => {
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
              timezone: null,
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.timezone, 'America/Toronto');
  });

  it('accepts optional READY etaSnapshot from the assigned-route contract', async () => {
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
              etaSnapshot: {
                calculatedAt: '2026-05-12T11:00:00.000Z',
                failureCode: null,
                failureMessage: null,
                nextStopEta: {
                  deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
                  distanceFromPreviousMeters: 100,
                  estimatedArrivalAt: '2026-05-12T11:15:00.000Z',
                  sequence: 1,
                },
                pickupCompletedAt: '2026-05-12T10:58:00.000Z',
                remainingRouteEta: {
                  distanceMeters: 3500,
                  estimatedCompletionAt: '2026-05-12T11:40:00.000Z',
                },
                status: 'READY',
              },
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });
    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.etaSnapshot?.status, 'READY');
    assert.equal(result.route.etaSnapshot?.nextStopEta?.distanceFromPreviousMeters, 100);
    assert.equal(result.route.etaSnapshot?.remainingRouteEta?.estimatedCompletionAt, '2026-05-12T11:40:00.000Z');
  });

  it('accepts and normalizes stop distanceFromPreviousMeters from assigned-route responses', async () => {
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
              stops: sampleAssignedRoute.stops.map((stop, index) => ({
                ...stop,
                ...(index === 0 ? { distanceFromPreviousMeters: 1250 } : {}),
              })),
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });
    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.stops[0]?.distanceFromPreviousMeters, 1250);
    assert.equal(result.route.stops[1]?.distanceFromPreviousMeters, null);
  });

  it('normalizes explicit null etaSnapshot from assigned-route responses', async () => {
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
              etaSnapshot: null,
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });
    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.etaSnapshot, null);
  });

  it('accepts PRE_PICKUP etaSnapshot only with exact null fields', async () => {
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
              etaSnapshot: {
                calculatedAt: null,
                failureCode: null,
                failureMessage: null,
                nextStopEta: null,
                pickupCompletedAt: null,
                remainingRouteEta: null,
                status: 'PRE_PICKUP',
              },
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });
    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.equal(result.route.etaSnapshot?.status, 'PRE_PICKUP');
    assert.equal(result.route.etaSnapshot.nextStopEta, null);
    assert.equal(result.route.etaSnapshot.remainingRouteEta, null);
  });

  it('rejects assigned route payloads that omit required stop item arrays', async () => {
    const routePayload = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map(({ items: _items, ...stop }) => stop),
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
      () => client.getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
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

  it('accepts static route map preview metadata from assigned-route responses', async () => {
    const preview = {
      altText: 'Static route preview for 2 stops.',
      contentType: 'image/png',
      expiresAt: '2026-05-12T07:00:00.000Z',
      generatedAt: '2026-05-12T06:50:00.000Z',
      height: 430,
      imageUrl: 'https://delivery.example.com/driver/route-map-preview/opaque?expires=1781142000000&signature=preview',
      kind: 'static_route_map',
      routeSequenceChecksum: 'sample-route-checksum',
      width: 720,
    };
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
              routeMapPreview: preview,
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.getAssignedRoute({ routeContext: sampleAssignedRoute.id });

    assert.equal(result.status, 'ASSIGNED_ROUTE');
    assert.deepEqual(result.route.routeMapPreview, preview);
    assert.deepEqual(
      resolveRouteMapPreviewState({
        loadStatus: 'idle',
        now: new Date('2026-05-12T06:55:00.000Z'),
        preview: result.route.routeMapPreview,
      }),
      {
        accessibilityLabel: preview.altText,
        imageUrl: preview.imageUrl,
        kind: 'available',
      },
    );
  });

  it('defines tab-level synthetic validation scenarios with safe coordinates and OSRM evidence expectations', () => {
    assert.deepEqual(
      assignedRouteValidationScenarios.map((scenario) => scenario.tab),
      ['ready', 'active', 'completed'],
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
      routeMapPreview: _routeMapPreview,
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
    assert.equal(result.route.routeMapPreview, null);
    assert.equal(result.route.routeMetrics, null);
    assert.deepEqual(result.route.routeStopPoints, []);
    assert.equal(formatAssignedRouteDistance(result.route.routeMetrics), 'Not available');
    assert.equal(formatAssignedRouteDuration(result.route.routeMetrics), 'Not available');
  });

  it('maps route map preview helper states for missing, expired, and failed images', () => {
    assert.deepEqual(
      resolveRouteMapPreviewState({
        loadStatus: 'idle',
        now: new Date('2026-05-12T06:55:00.000Z'),
        preview: null,
      }),
      {
        kind: 'missing',
        message: 'Route preview unavailable. You can still open navigation for each stop.',
      },
    );

    assert.deepEqual(
      resolveRouteMapPreviewState({
        loadStatus: 'idle',
        now: new Date('2026-05-12T07:01:00.000Z'),
        preview: sampleAssignedRoute.routeMapPreview,
      }),
      {
        kind: 'expired',
        message: 'Map preview couldn’t load. Route details are still available.',
      },
    );

    assert.deepEqual(
      resolveRouteMapPreviewState({
        loadStatus: 'failed',
        now: new Date('2026-05-12T06:55:00.000Z'),
        preview: sampleAssignedRoute.routeMapPreview,
      }),
      {
        kind: 'failed',
        message: 'Map preview couldn’t load. Route details are still available.',
      },
    );
  });

  it('rejects malformed etaSnapshot from assigned-route payloads', async () => {
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
              etaSnapshot: {
                calculatedAt: '2026-05-12T11:00:00.000Z',
                status: 'READY',
                remainingRouteEta: {
                  distanceMeters: 'invalid',
                  estimatedCompletionAt: '2026-05-12T11:40:00.000Z',
                },
              },
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
  });

  it('rejects PRE_PICKUP etaSnapshot payloads with post-pickup fields', async () => {
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
              etaSnapshot: {
                calculatedAt: null,
                failureCode: null,
                failureMessage: null,
                nextStopEta: {
                  deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
                  distanceFromPreviousMeters: 100,
                  estimatedArrivalAt: '2026-05-12T11:15:00.000Z',
                  sequence: 1,
                },
                pickupCompletedAt: null,
                remainingRouteEta: null,
                status: 'PRE_PICKUP',
              },
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
  });

  it('rejects READY etaSnapshot payloads without required ETA clocks', async () => {
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
              etaSnapshot: {
                calculatedAt: '2026-05-12T11:00:00.000Z',
                failureCode: null,
                failureMessage: null,
                nextStopEta: {
                  deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
                  distanceFromPreviousMeters: null,
                  estimatedArrivalAt: null,
                  sequence: 1,
                },
                pickupCompletedAt: '2026-05-12T10:58:00.000Z',
                remainingRouteEta: {
                  distanceMeters: null,
                  estimatedCompletionAt: '2026-05-12T11:40:00.000Z',
                },
                status: 'READY',
              },
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
  });

  it('rejects READY etaSnapshot payloads without a concrete next stop id', async () => {
    const makeClient = (deliveryStopId: string | null) => createAssignedRouteApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'ASSIGNED_ROUTE',
            route: {
              ...sampleAssignedRoute,
              etaSnapshot: {
                calculatedAt: '2026-05-12T11:00:00.000Z',
                failureCode: null,
                failureMessage: null,
                nextStopEta: {
                  deliveryStopId,
                  distanceFromPreviousMeters: null,
                  estimatedArrivalAt: '2026-05-12T11:15:00.000Z',
                  sequence: 1,
                },
                pickupCompletedAt: '2026-05-12T10:58:00.000Z',
                remainingRouteEta: {
                  distanceMeters: null,
                  estimatedCompletionAt: '2026-05-12T11:40:00.000Z',
                },
                status: 'READY',
              },
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => makeClient(null).getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
    await assert.rejects(
      () => makeClient('').getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
  });

  it('rejects malformed stop distanceFromPreviousMeters from assigned-route responses', async () => {
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
              stops: sampleAssignedRoute.stops.map((stop, index) => ({
                ...stop,
                ...(index === 0 ? { distanceFromPreviousMeters: Number.NaN } : {}),
              })),
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: sampleAssignedRoute.id }),
      /Invalid assigned route response/u,
    );
  });

  it('rejects malformed route map preview metadata from the assigned-route contract', async () => {
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
              routeMapPreview: {
                ...sampleAssignedRoute.routeMapPreview,
                contentType: 'image/svg+xml',
              },
            },
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.getAssignedRoute({ routeContext: 'route-id' }),
      /Invalid assigned route response/u,
    );
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

  it('formats actionable cash and eTransfer totals without guessing missing amounts', () => {
    assert.deepEqual(formatAssignedRoutePaymentSummary({
      currencyCode: 'CAD',
      normalizedPaymentStatus: 'CASH_COLLECT_REQUIRED',
      paymentMethodTitle: 'Cash on delivery',
      totalPriceAmount: '84.5',
    }), {
      amountLabel: 'CAD 84.50',
      detail: 'Collect exactly CAD 84.50 from the customer.',
      methodLabel: 'Cash on delivery',
      notificationLabel: 'Cash on delivery, Collect cash, CAD 84.50',
      status: {
        detail: 'Cash was selected. Collect payment directly at delivery.',
        label: 'Collect cash',
        tone: 'warning',
      },
    });
    assert.deepEqual(formatAssignedRoutePaymentSummary({
      currencyCode: 'CAD',
      normalizedPaymentStatus: 'TRANSFER_CHECK_PENDING',
      paymentMethodTitle: 'eTransfer',
      totalPriceAmount: '52.00',
    }), {
      amountLabel: 'CAD 52.00',
      detail: 'Transfer is not confirmed. Ask the customer only when dispatch requires collection.',
      methodLabel: 'eTransfer',
      notificationLabel: 'eTransfer, Transfer pending, CAD 52.00',
      status: {
        detail: 'E-mail/bank transfer still needs WooCommerce/admin confirmation. Do not ask again until confirmed by dispatch.',
        label: 'Transfer pending',
        tone: 'warning',
      },
    });
    assert.deepEqual(formatAssignedRoutePaymentSummary({
      currencyCode: null,
      normalizedPaymentStatus: 'CASH_COLLECT_REQUIRED',
      paymentMethodTitle: null,
      totalPriceAmount: null,
    }), {
      amountLabel: 'Amount unavailable',
      detail: 'Do not request cash until dispatch provides the exact total.',
      methodLabel: 'Cash',
      notificationLabel: 'Cash, Amount unavailable',
      status: {
        detail: 'The exact cash total is missing from the server response.',
        label: 'Amount unavailable',
        tone: 'warning',
      },
    });
  });

  it('formats compact route totals with a narrow currency sign', () => {
    assert.equal(formatAssignedRouteCompactPaymentAmount('84.5', 'CAD'), '$84.50');
    assert.equal(formatAssignedRouteCompactPaymentAmount(null, 'CAD'), 'Amount unavailable');
    assert.equal(formatAssignedRouteCompactPaymentAmount('84.5', null), 'Amount unavailable');
  });

  it('identifies pickup orders from the server route classification', () => {
    const stop = sampleAssignedRoute.stops[0]!;

    assert.equal(isAssignedRoutePickupStop({
      ...stop,
      deliverySession: 'PICKUP',
      serviceType: 'DELIVERY',
    }), true);
    assert.equal(isAssignedRoutePickupStop({
      ...stop,
      deliverySession: 'DELIVERY',
      serviceType: 'pickup',
    }), true);
    assert.equal(isAssignedRoutePickupStop({
      ...stop,
      deliverySession: 'DELIVERY',
      serviceType: 'DELIVERY',
    }), false);
  });

  it('shows Pickup instead of an unknown payment warning for pickup orders', () => {
    assert.deepEqual(formatAssignedRoutePaymentSummary({
      currencyCode: 'CAD',
      deliverySession: 'PICKUP',
      normalizedPaymentStatus: 'UNKNOWN_REVIEW',
      paymentMethodTitle: null,
      serviceType: 'PICKUP',
      totalPriceAmount: '40.00',
    }), {
      amountLabel: 'CAD 40.00',
      detail: '',
      methodLabel: 'Pickup',
      notificationLabel: 'Pickup',
      status: {
        detail: '',
        label: 'Pickup',
        tone: 'warning',
      },
    });
  });
});
