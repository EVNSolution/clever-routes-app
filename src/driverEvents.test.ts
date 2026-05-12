import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverEventsApiClient,
  createMockDriverEventService,
  recordRouteStartedAfterDeliveryStart,
} from './driverEvents';
import { createInMemoryOfflineSubmissionQueue } from './offlineSubmissionQueue';

describe('driver event API boundary', () => {
  it('posts route started events with driver bearer token evidence', async () => {
    const requests: { body: unknown; headers: Record<string, string>; method: string; url: string }[] = [];
    const service = createDriverEventsApiClient({
      accessToken: 'fixture-driver-access-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(init?.body ?? '{}') as unknown,
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
      payload: { proof: { note: 'Left with concierge', source: 'driver-app-mvp', type: 'DELIVERED_NOTE' } },
      routePlanId: 'route-1',
    });

    assert.deepEqual(requests[0]?.body, {
      clientEventId: 'stop-delivered-1',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: '2026-05-12T07:15:00.000Z',
      proof: { note: 'Left with concierge', source: 'driver-app-mvp', type: 'DELIVERED_NOTE' },
      routePlanId: 'route-1',
    });
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
});
