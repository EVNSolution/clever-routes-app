import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDriverRouteEtaUpdate,
  createDriverEventsApiClient,
  createMockDriverEventService,
  recordPickupCompletedAfterDeliveryStart,
  recordRouteStartedAfterDeliveryStart,
  recordStopArrivedAfterDeliveryStart,
} from './driverEvents';
import { DriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { sampleAssignedRoute } from '../route/assignedRoute';
import routeCompletedRequest from '../../test/contractFixtures/routeOperations/v1/fixtures/route-completed.request.json';

describe('driver event API boundary', () => {
  it('sends the canonical v2 lineage and build contract on every ordered event', async () => {
    let body: unknown;
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      orderedEventContract: {
        appVersion: routeCompletedRequest.appVersion,
        assignmentGeneration: routeCompletedRequest.assignmentGeneration,
        driverContractVersion: 2,
        expectedRouteVersionId: routeCompletedRequest.expectedRouteVersionId,
        versionCode: routeCompletedRequest.versionCode,
      },
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init?.body ?? '{}');
        return { json: async () => ({ data: { duplicate: false, eventId: 'event-id' }, error: null }), ok: true, status: 202 };
      },
    });

    await service.recordDriverEvent({
      clientEventId: routeCompletedRequest.clientEventId,
      deliveryStopId: null,
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date(routeCompletedRequest.occurredAt),
      routePlanId: routeCompletedRequest.routePlanId,
    });

    assert.deepEqual(body, routeCompletedRequest);
  });

  it('preserves immutable queued lineage when a reassigned route client replays an older completion', async () => {
    let body: Record<string, unknown> | undefined;
    const service = createDriverEventsApiClient({
      accessToken: 'generation-12-route-token',
      baseUrl: 'https://delivery.example.com',
      orderedEventContract: {
        appVersion: '1.2.0', assignmentGeneration: '12', driverContractVersion: 2,
        expectedRouteVersionId: '33333333-3333-4333-8333-333333333333', versionCode: 18,
      },
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
        return { json: async () => ({ data: { duplicate: false, eventId: 'older-completion' }, error: null }), ok: true, status: 202 };
      },
    });
    const queuedGeneration11 = {
      appVersion: '1.1.6', assignmentGeneration: '11', clientEventId: 'completion-generation-11',
      driverContractVersion: 2 as const, eventType: 'ROUTE_COMPLETED' as const,
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'reused-route', versionCode: 17,
    };

    await service.recordDriverEvent(queuedGeneration11);

    assert.equal(body?.assignmentGeneration, '11');
    assert.equal(body?.expectedRouteVersionId, '22222222-2222-4222-8222-222222222222');
    assert.equal(body?.appVersion, '1.1.6');
    assert.equal(body?.versionCode, 17);
    assert.equal(queuedGeneration11.assignmentGeneration, '11');
  });

  it('posts route started events with driver bearer token evidence', async () => {
    const requests: { body: unknown; cache?: string; credentials?: string; headers: Record<string, string>; method: string; url: string }[] = [];
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(init?.body ?? '{}') as unknown,
          cache: init?.cache,
          credentials: init?.credentials,
          headers: init?.headers ?? {},
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            data: { duplicate: false, eventId: 'evt_123' },
            error: null,
          }),
        };
      },
    });

    const result = await service.recordDriverEvent({
      clientEventId: 'route-started-1',
      eventType: 'ROUTE_STARTED',
      occurredAt: new Date('2026-05-12T07:00:00.000Z'),
      routePlanId: '11111111-1111-4111-8111-111111111111',
    });

    assert.deepEqual(result, { duplicate: false, eventId: 'evt_123', status: 'recorded' });
    assert.equal(requests[0]?.url, 'https://delivery.example.com/driver/events');
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.cache, 'no-store');
    assert.equal(requests[0]?.credentials, 'omit');
    assert.equal(requests[0]?.headers['Cache-Control'], 'no-store');
    assert.equal(requests[0]?.headers.Pragma, 'no-cache');
    assert.equal(requests[0]?.headers.Authorization, 'Bearer fixture-driver-access-token');
    assert.deepEqual(requests[0]?.body, {
      clientEventId: 'route-started-1',
      eventType: 'ROUTE_STARTED',
      occurredAt: '2026-05-12T07:00:00.000Z',
      routePlanId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('posts optional event payload metadata for stop proof events', async () => {
    const requests: { body: unknown }[] = [];
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (_url, init) => {
        requests.push({ body: JSON.parse(init?.body ?? '{}') as unknown });
        return {
          ok: true,
          status: 202,
          json: async () => ({ data: { duplicate: false, eventId: 'evt_stop_1' }, error: null }),
        };
      },
    });

    await service.recordDriverEvent({
      clientEventId: 'stop-delivered-1',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T07:15:00.000Z'),
      payload: { proof: { note: 'Left with concierge', source: 'clever-routes-app', type: 'DELIVERED_NOTE' } },
      routePlanId: 'route-1',
    });

    assert.deepEqual(requests[0]?.body, {
      clientEventId: 'stop-delivered-1',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: '2026-05-12T07:15:00.000Z',
      proof: { note: 'Left with concierge', source: 'clever-routes-app', type: 'DELIVERED_NOTE' },
      routePlanId: 'route-1',
    });
  });

  it('accepts the server-authoritative ETA update returned with an arrival event', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            duplicate: false,
            etaUpdate: {
              actualArrivalAt: '2026-05-12T11:12:00.000Z',
              deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
              delaySeconds: 240,
              previousEstimatedArrivalAt: '2026-05-12T11:08:00.000Z',
              serverReceivedAt: '2026-05-12T11:12:00.000Z',
              trigger: 'STOP_ARRIVED',
              updatedStops: [{
                deliveryStopId: sampleAssignedRoute.stops[1]!.deliveryStopId,
                estimatedArrivalAt: '2026-05-12T11:23:00.000Z',
                sequence: 2,
              }],
            },
            eventId: 'evt_arrived_1',
          },
          error: null,
        }),
      }),
    });

    const result = await service.recordDriverEvent({
      clientEventId: 'stop-arrived-1',
      deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
      eventType: 'STOP_ARRIVED',
      occurredAt: new Date('2026-05-12T01:00:00.000Z'),
      routePlanId: sampleAssignedRoute.id,
    });

    assert.equal(result.etaUpdate?.serverReceivedAt, '2026-05-12T11:12:00.000Z');
    assert.equal(result.etaUpdate?.delaySeconds, 240);
  });

  it('treats duplicate driver event responses as recorded idempotently', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { duplicate: true, eventId: 'route-started-1' }, error: null }),
      }),
    });

    const result = await service.recordDriverEvent({
      clientEventId: 'route-started-1',
      eventType: 'ROUTE_STARTED',
      occurredAt: new Date('2026-05-12T07:00:00.000Z'),
      routePlanId: null,
    });

    assert.deepEqual(result, { duplicate: true, eventId: 'route-started-1', status: 'recorded' });
  });

  it('preserves the server error code when a route is no longer in progress', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          data: null,
          error: { code: 'ROUTE_NOT_IN_PROGRESS', message: 'Route is not in progress' },
        }),
      }),
    });

    await assert.rejects(
      service.recordDriverEvent({
        clientEventId: 'location-1',
        eventType: 'LOCATION_UPDATED',
        latitude: 43.6532,
        longitude: -79.3832,
        occurredAt: new Date('2026-05-12T07:00:00.000Z'),
        routePlanId: 'route-1',
      }),
      (error: unknown) => (
        error instanceof DriverApiHttpError
        && error.status === 409
        && error.code === 'ROUTE_NOT_IN_PROGRESS'
      ),
    );
  });

  it('records route started only after delivery_active is reached', async () => {
    const service = createMockDriverEventService();

    const blocked = await recordRouteStartedAfterDeliveryStart({
      deliveryStart: { flowState: 'route_ready', kind: 'permission_denied', reason: 'foreground_location_denied', message: 'denied' },
      driverEventService: service,
      routePlanId: 'route-1',
    });
    const recorded = await recordRouteStartedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: service,
      routePlanId: 'route-1',
    });

    assert.equal(blocked.kind, 'blocked');
    assert.equal(recorded.kind, 'recorded');
    assert.deepEqual(service.recordedEvents.map((event) => event.eventType), ['ROUTE_STARTED']);
  });

  it('records STOP_ARRIVED only for an active delivery and applies the returned future ETA', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            duplicate: false,
            etaUpdate: {
              actualArrivalAt: '2026-05-12T11:12:00.000Z',
              deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
              delaySeconds: 240,
              previousEstimatedArrivalAt: '2026-05-12T11:08:00.000Z',
              serverReceivedAt: '2026-05-12T11:12:00.000Z',
              trigger: 'STOP_ARRIVED',
              updatedStops: [{
                deliveryStopId: sampleAssignedRoute.stops[1]!.deliveryStopId,
                estimatedArrivalAt: '2026-05-12T11:23:00.000Z',
                sequence: 2,
              }],
            },
            eventId: 'evt_arrived_1',
          },
          error: null,
        }),
      }),
    });
    const result = await recordStopArrivedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
      driverEventService: service,
      routePlanId: sampleAssignedRoute.id,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.kind === 'recorded' ? result.etaUpdate?.trigger : null, 'STOP_ARRIVED');
    const updatedRoute = result.kind === 'recorded' && result.etaUpdate !== undefined
      ? applyDriverRouteEtaUpdate(sampleAssignedRoute, result.etaUpdate)
      : sampleAssignedRoute;
    assert.equal(updatedRoute.stops[0]?.status, 'ARRIVED');
    assert.equal(updatedRoute.stops[1]?.estimatedArrivalAt, '2026-05-12T11:23:00.000Z');
  });

  it('includes the captured arrival coordinates and planned-stop distance in the first STOP_ARRIVED event', async () => {
    const service = createMockDriverEventService();
    const recordedAt = new Date('2026-08-18T15:48:00.000Z');

    const result = await recordStopArrivedAfterDeliveryStart({
      arrivalEvidence: {
        distanceToPlannedStopMeters: 37.4,
        latitude: 37.5133,
        longitude: 126.9428,
        recordedAt,
      },
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      deliveryStopId: 'stop-1',
      driverEventService: service,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'recorded');
    assert.deepEqual(service.recordedEvents[0], {
      clientEventId: `stop-arrived-stop-1-${recordedAt.getTime().toString(36)}`,
      deliveryStopId: 'stop-1',
      eventType: 'STOP_ARRIVED',
      latitude: 37.5133,
      longitude: 126.9428,
      occurredAt: recordedAt,
      payload: { distanceToPlannedStopMeters: 37.4 },
      routePlanId: 'route-1',
    });
  });

  it('queues STOP_ARRIVED when the server cannot receive the arrival signal', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const result = await recordStopArrivedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      deliveryStopId: 'stop-1',
      driverEventService: { recordDriverEvent: async () => { throw new Error('network offline'); } },
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'queued');
    const pending = queue.listPending()[0];
    assert.equal(pending?.kind === 'driver_event' ? pending.event.eventType : null, 'STOP_ARRIVED');
  });

  it('queues route started when the live event submission fails', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await recordRouteStartedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: {
        recordDriverEvent: async () => {
          throw new Error('network offline');
        },
      },
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.reason, 'record_failed');
    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, 'driver_event');
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'ROUTE_STARTED');
  });

  it('queues route started with re-lookup guidance when live driver event returns unauthorized', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const service = createDriverEventsApiClient({
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

    const result = await recordRouteStartedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: service,
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.reason, 'record_failed');
    assert.equal(result.requiresRouteLookup, true);
    assert.match(result.message, /Driver session expired/iu);
    assert.match(result.message, /HTTP 401/iu);
    assert.equal(queue.listPending().length, 1);
  });

  it('records PICKUP_COMPLETED and accepts server-returned etaSnapshot', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            duplicate: false,
            etaSnapshot: {
              calculatedAt: '2026-05-12T11:00:00.000Z',
              failureCode: null,
              failureMessage: null,
              nextStopEta: {
                deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
                distanceFromPreviousMeters: 180,
                estimatedArrivalAt: '2026-05-12T11:20:00.000Z',
                sequence: 1,
              },
              pickupCompletedAt: '2026-05-12T10:58:00.000Z',
              remainingRouteEta: {
                distanceMeters: 4500,
                estimatedCompletionAt: '2026-05-12T11:45:00.000Z',
              },
              status: 'READY',
            },
            eventId: 'evt_pickup_1',
          },
          error: null,
        }),
      }),
    });

    const result = await recordPickupCompletedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: service,
      routePlanId: sampleAssignedRoute.id,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.etaSnapshot?.status, 'READY');
    assert.equal(result.etaSnapshot?.nextStopEta?.sequence, 1);
    assert.equal(result.etaSnapshot?.remainingRouteEta?.estimatedCompletionAt, '2026-05-12T11:45:00.000Z');
  });

  it('accepts duplicate PICKUP_COMPLETED responses with etaSnapshot and omitted etaUpdate', async () => {
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            duplicate: true,
            etaSnapshot: {
              calculatedAt: '2026-05-12T11:00:00.000Z',
              failureCode: null,
              failureMessage: null,
              nextStopEta: {
                deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
                distanceFromPreviousMeters: 180,
                estimatedArrivalAt: '2026-05-12T11:20:00.000Z',
                sequence: 1,
              },
              pickupCompletedAt: '2026-05-12T10:58:00.000Z',
              remainingRouteEta: {
                distanceMeters: 4500,
                estimatedCompletionAt: '2026-05-12T11:45:00.000Z',
              },
              status: 'READY',
            },
            eventId: 'evt_pickup_original',
          },
          error: null,
        }),
      }),
    });

    const result = await recordPickupCompletedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: service,
      routePlanId: sampleAssignedRoute.id,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.duplicate, true);
    assert.equal(result.eventId, 'evt_pickup_original');
    assert.equal(result.etaUpdate, undefined);
    assert.equal(result.etaSnapshot?.status, 'READY');
  });

  it('queues PICKUP_COMPLETED when a recorded response omits etaSnapshot', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            duplicate: false,
            eventId: 'evt_pickup_missing_snapshot',
          },
          error: null,
        }),
      }),
    });

    const result = await recordPickupCompletedAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: service,
      offlineQueue: queue,
      routePlanId: sampleAssignedRoute.id,
    });

    assert.equal(result.kind, 'queued');
    assert.match(result.message, /ETA snapshot/iu);
    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'PICKUP_COMPLETED');
  });
});
