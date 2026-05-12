import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContinuousLocationStreamService } from './continuousLocationStream';
import { finishDeliveryAfterActive } from './deliveryFinish';
import { createDriverApiHttpError } from './driverApiError';
import { createMockDriverEventService } from './driverEvents';
import { createInMemoryOfflineSubmissionQueue } from './offlineSubmissionQueue';

function createMockStreamService() {
  const stoppedTasks: string[] = [];
  const service: ContinuousLocationStreamService = {
    getBackgroundAvailability: async () => true,
    hasStartedLocationUpdates: async () => true,
    requestBackgroundPermission: async () => 'granted',
    startLocationUpdates: async () => undefined,
    stopLocationUpdates: async (taskName) => {
      stoppedTasks.push(taskName);
    },
  };

  return { service, stoppedTasks };
}

describe('delivery finish route cleanup', () => {
  it('blocks route completion before delivery_active', async () => {
    const driverEvents = createMockDriverEventService();
    const stream = createMockStreamService();

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'route_ready',
        kind: 'permission_denied',
        message: 'denied',
        reason: 'foreground_location_denied',
      },
      driverEventService: driverEvents,
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'blocked');
    assert.deepEqual(driverEvents.recordedEvents, []);
    assert.deepEqual(stream.stoppedTasks, []);
  });

  it('stops tracking and records a ROUTE_COMPLETED event after delivery_active', async () => {
    const driverEvents = createMockDriverEventService();
    const stream = createMockStreamService();

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      driverEventService: driverEvents,
      now: new Date('2026-05-12T08:30:00.000Z'),
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.flowState, 'delivery_finished');
    assert.deepEqual(stream.stoppedTasks, ['clever-driver-continuous-location']);
    assert.deepEqual(driverEvents.recordedEvents.map((event) => ({
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      routePlanId: event.routePlanId,
    })), [
      {
        eventType: 'ROUTE_COMPLETED',
        occurredAt: '2026-05-12T08:30:00.000Z',
        routePlanId: 'route-1',
      },
    ]);
  });

  it('queues route completion when live event recording fails and keeps the queued completion evidence', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const stream = createMockStreamService();

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      driverEventService: {
        recordDriverEvent: async () => {
          throw new Error('network offline');
        },
      },
      now: new Date('2026-05-12T08:35:00.000Z'),
      offlineQueue: queue,
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.flowState, 'delivery_finished');
    assert.deepEqual(stream.stoppedTasks, ['clever-driver-continuous-location']);
    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, 'driver_event');
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'ROUTE_COMPLETED');
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.routePlanId : null, 'route-1');
  });

  it('marks queued route completion as requiring route lookup when live event returns unauthorized', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const stream = createMockStreamService();

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      driverEventService: {
        recordDriverEvent: async () => {
          throw createDriverApiHttpError({ endpoint: 'Driver event record', status: 401 });
        },
      },
      now: new Date('2026-05-12T08:36:00.000Z'),
      offlineQueue: queue,
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.requiresRouteLookup, true);
    assert.match(result.message, /Driver session expired/iu);
    assert.match(result.message, /HTTP 401/iu);
  });

  it('discards route-scoped queued submissions only after route completion is recorded', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'location-route-1',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-05-12T08:10:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'location-route-2',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-05-12T08:10:00.000Z'),
      routePlanId: 'route-2',
    });
    const stream = createMockStreamService();

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      driverEventService: createMockDriverEventService(),
      now: new Date('2026-05-12T08:40:00.000Z'),
      offlineQueue: queue,
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.kind === 'recorded' ? result.discardedQueuedItems : null, 1);
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), ['driver-event:location-route-2']);
  });
});
