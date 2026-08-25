import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContinuousLocationStreamService } from '../location/continuousLocationStream';
import { finishDeliveryAfterActive } from './deliveryFinish';
import { createDriverApiClientsFromRouteAccess } from '../../api/deliveryServer/driverApiClients';
import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  createRouteOrderedDriverEventService,
  retryOfflineSubmissions,
  type OfflineSubmissionQueueStorage,
} from '../offline/offlineSubmissionQueue';

function createMockStreamService() {
  const stoppedTasks: string[] = [];
  const service: ContinuousLocationStreamService = {
    getBackgroundAvailability: async () => true,
    hasStartedLocationUpdates: async () => true,
    getBackgroundPermission: async () => 'granted',
    requestBackgroundPermission: async () => 'granted',
    startLocationUpdates: async () => undefined,
    stopLocationUpdates: async (taskName) => {
      stoppedTasks.push(taskName);
    },
  };

  return { service, stoppedTasks };
}

describe('delivery finish route cleanup', () => {
  it('persists decorated completion before response loss and recovers APPLIED receipt after process restart', async () => {
    const values = new Map<string, string>();
    const storage: OfflineSubmissionQueueStorage = {
      getItem: async (key) => values.get(key) ?? null,
      removeItem: async (key) => { values.delete(key); },
      setItem: async (key, value) => { values.set(key, value); },
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const contract = {
      appVersion: '2.8.0',
      assignmentGeneration: sampleInvitedRouteAccess.routeAccess.assignmentGeneration,
      driverContractVersion: 2 as const,
      expectedRouteVersionId: sampleInvitedRouteAccess.routeAccess.expectedRouteVersionId,
      versionCode: 20800,
    };
    const live = createDriverApiClientsFromRouteAccess({
      appVersion: contract.appVersion,
      baseUrl: 'https://route.test',
      fetchImpl: async () => { throw new TypeError('response lost'); },
      refreshDriverAccess: async () => sampleInvitedRouteAccess.driverAccess,
      routeAccess: sampleInvitedRouteAccess,
      versionCode: contract.versionCode,
    }).driverEventService;
    const stream = createMockStreamService();
    const finish = await finishDeliveryAfterActive({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: createRouteOrderedDriverEventService({ driverEventService: live, queue, routePlanId }),
      now: new Date('2026-08-22T19:42:10.000Z'),
      offlineQueue: queue,
      routePlanId,
      streamService: stream.service,
    });
    assert.equal(finish.kind, 'queued');

    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    const persisted = restarted.listPending()[0];
    assert.equal(persisted?.kind, 'driver_event');
    if (persisted?.kind !== 'driver_event') throw new Error('Expected persisted completion');
    assert.deepEqual({
      appVersion: persisted.event.appVersion,
      assignmentGeneration: persisted.event.assignmentGeneration,
      driverContractVersion: persisted.event.driverContractVersion,
      expectedRouteVersionId: persisted.event.expectedRouteVersionId,
      versionCode: persisted.event.versionCode,
    }, contract);

    let replayed = false;
    const recovery = await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: contract.assignmentGeneration,
        clientEventId: persisted.event.clientEventId,
        errorCode: null,
        expectedRouteVersionId: contract.expectedRouteVersionId,
        routePlanId,
        routeStatus: 'COMPLETED',
        status: 'APPLIED',
      }) },
      driverEventService: { recordDriverEvent: async () => { replayed = true; throw new Error('must not replay'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue: restarted,
    });
    assert.equal(replayed, false);
    assert.deepEqual(recovery.completionAcknowledgedRoutePlanIds, [routePlanId]);
  });

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
    assert.deepEqual(stream.stoppedTasks, ['clever-routes-continuous-location']);
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

  it('hands durable SERVER_ACK to the clear-heartbeat outbox before GPS cleanup', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const driverEvents = createMockDriverEventService();
    const order: string[] = [];
    const stream = createMockStreamService();
    stream.service.stopLocationUpdates = async () => { order.push('gps-stop'); };

    const result = await finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active',
      },
      driverEventService: driverEvents,
      offlineQueue: queue,
      onServerAcknowledged: async (entry) => {
        assert.deepEqual(queue.listPendingCompletionClearEntries(), [entry]);
        order.push('heartbeat-handoff');
        throw new Error('transport rejected after durable handoff');
      },
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'recorded');
    assert.deepEqual(order, ['heartbeat-handoff', 'gps-stop']);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), ['route-1']);
  });

  it('does not let hung ACK-clear persistence permanently block online GPS cleanup', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const stream = createMockStreamService();
    const expirations: (() => void)[] = [];
    const finish = finishDeliveryAfterActive({
      deliveryStart: {
        flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active',
      },
      driverEventService: createMockDriverEventService(),
      offlineQueue: queue,
      onServerAcknowledged: () => new Promise(() => undefined),
      onServerAcknowledgedCancelTimeout: () => undefined,
      onServerAcknowledgedScheduleTimeout: (expire) => { expirations.push(expire); return expire; },
      onServerAcknowledgedTimeoutMs: 10,
      routePlanId: 'route-1',
      streamService: stream.service,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expirations.shift()?.();
    assert.equal((await finish).kind, 'recorded');
    assert.deepEqual(stream.stoppedTasks, ['clever-routes-continuous-location']);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), ['route-1']);
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

  it('preserves terminal stop evidence and proof when route release returns terminal 409', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'stop-delivered-before-release',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-20T03:04:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
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
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      },
      now: new Date('2026-07-20T03:05:00.000Z'),
      offlineQueue: queue,
      routeEnd: 'released',
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.requiresRouteLookup, undefined);
    assert.equal(result.requiresRouteReconciliation, true);
    assert.equal(queue.listPending().length, 3);
    assert.equal(queue.listPending().every((item) => (
      item.reconciliation?.reason === 'route_not_in_progress'
    )), true);
  });

  it('queues route completion when live event recording fails and keeps the queued completion evidence', async () => {
    const memoryQueue = createInMemoryOfflineSubmissionQueue();
    let releasePersistence: () => void = () => undefined;
    let persistenceStarted = false;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const queue = {
      ...memoryQueue,
      whenPersisted: async () => {
        persistenceStarted = true;
        await persistenceGate;
      },
    };
    const stream = createMockStreamService();
    let routeSessionDeactivated = false;

    let finishResolved = false;
    const resultPromise = finishDeliveryAfterActive({
      deactivateActiveRouteSession: async () => {
        routeSessionDeactivated = true;
        return true;
      },
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
    }).then((result) => {
      finishResolved = true;
      return result;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(persistenceStarted, true);
    assert.equal(routeSessionDeactivated, false);
    assert.equal(finishResolved, false);
    releasePersistence();
    const result = await resultPromise;

    assert.equal(routeSessionDeactivated, true);
    assert.equal(result.kind, 'queued');
    assert.equal(result.flowState, 'delivery_finished');
    assert.deepEqual(stream.stoppedTasks, []);
    assert.equal(result.kind === 'queued' ? result.monitoringMode : null, 'reduced');
    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, 'driver_event');
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'ROUTE_COMPLETED');
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.routePlanId : null, 'route-1');
  });

  it('removes the prepared route end when the active session changed', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const stream = createMockStreamService();
    const driverEvents = createMockDriverEventService();

    const result = await finishDeliveryAfterActive({
      deactivateActiveRouteSession: async () => false,
      deliveryStart: {
        flowState: 'delivery_active',
        kind: 'delivery_active',
        locationPermission: 'foreground',
        message: 'active',
      },
      driverEventService: driverEvents,
      now: new Date('2026-05-12T08:35:00.000Z'),
      offlineQueue: queue,
      routePlanId: 'route-1',
      streamService: stream.service,
    });

    assert.equal(result.kind, 'blocked');
    assert.equal(result.kind === 'blocked' ? result.reason : null, 'active_session_changed');
    assert.equal(queue.listPending().length, 0);
    assert.deepEqual(stream.stoppedTasks, []);
    assert.deepEqual(driverEvents.recordedEvents, []);
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

  it('preserves queued proof after route completion is recorded', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
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
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'proof-media:route-1:stop-1:stop-1.jpg',
    ]);
  });
});
