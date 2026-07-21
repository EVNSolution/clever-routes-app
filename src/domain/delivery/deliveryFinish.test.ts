import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContinuousLocationStreamService } from '../location/continuousLocationStream';
import { finishDeliveryAfterActive } from './deliveryFinish';
import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

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

  it('attaches prepared route termination metadata to the completion event', async () => {
    const driverEvents = createMockDriverEventService();
    const stream = createMockStreamService();
    const eventPayload = {
      routeTermination: { action: 'DELETE', reason: 'DRIVER_DELETED' },
      shopifyAdminNotification: { deliveryStatus: 'PENDING_INTEGRATION' },
    };

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      eventPayload,
      now: new Date('2026-07-20T02:30:00.000Z'),
      routePlanId: 'route-1',
      streamService: stream.service,
      driverEventService: driverEvents,
    });

    assert.equal(result.kind, 'recorded');
    assert.deepEqual(driverEvents.recordedEvents[0]?.payload, eventPayload);
  });

  it('records ROUTE_PAUSED when the driver releases an active session back to Ready', async () => {
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
      now: new Date('2026-07-20T03:00:00.000Z'),
      routeEnd: 'released',
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(result.flowState, 'delivery_finished');
    assert.equal(result.message, 'Route session ended and the route returned to Ready.');
    assert.deepEqual(driverEvents.recordedEvents.map((event) => ({
      clientEventId: event.clientEventId,
      eventType: event.eventType,
      routePlanId: event.routePlanId,
    })), [{
      clientEventId: 'route-released-mrsmzmo0',
      eventType: 'ROUTE_PAUSED',
      routePlanId: 'route-1',
    }]);
  });

  it('queues only the route release transition when returning to Ready fails live', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'stale-location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-20T03:04:00.000Z'),
      routePlanId: 'route-1',
    });
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
      now: new Date('2026-07-20T03:05:00.000Z'),
      offlineQueue: queue,
      routeEnd: 'released',
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'queued');
    assert.match(result.message, /returning the route to Ready was queued/iu);
    const pendingItems = queue.listPending();
    assert.equal(pendingItems.length, 1);
    const pending = pendingItems[0];
    assert.equal(pending?.kind === 'driver_event'
      ? pending.event.eventType
      : null, 'ROUTE_PAUSED');
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
