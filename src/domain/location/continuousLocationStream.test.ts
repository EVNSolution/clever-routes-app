import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import {
  clearAndStopContinuousLocationSession,
  recordContinuousLocationUpdateBatch,
  requestContinuousLocationBackgroundPermission,
  startContinuousLocationUpdatesAfterDeliveryStart,
  startContinuousLocationUpdatesBeforeDeliveryStart,
  stopContinuousLocationUpdates,
  type ContinuousLocationStreamService,
  sendStoredContinuousLocations,
} from './continuousLocationStream';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

const activeDelivery = {
  flowState: 'delivery_active',
  kind: 'delivery_active',
  locationPermission: 'foreground',
  message: 'active',
} as const;

function createMockStreamService(input?: {
  availability?: boolean;
  backgroundPermission?: 'denied' | 'granted';
  backgroundPermissionError?: boolean;
  alreadyStarted?: boolean;
}): ContinuousLocationStreamService & { started: unknown[]; stopped: string[] } {
  const started: unknown[] = [];
  const stopped: string[] = [];
  return {
    started,
    stopped,
    getBackgroundAvailability: async () => input?.availability ?? true,
    getBackgroundPermission: async () => input?.backgroundPermission ?? 'granted',
    requestBackgroundPermission: async () => {
      if (input?.backgroundPermissionError === true) {
        throw new Error('permission activity unavailable');
      }
      return input?.backgroundPermission ?? 'granted';
    },
    hasStartedLocationUpdates: async () => input?.alreadyStarted ?? false,
    startLocationUpdates: async (options) => {
      started.push(options);
    },
    stopLocationUpdates: async (taskName) => {
      stopped.push(taskName);
    },
  };
}

describe('continuous location streaming', () => {
  it('acquires background permission before route state is persisted and contains native request failures', async () => {
    const denied = await requestContinuousLocationBackgroundPermission({
      streamService: createMockStreamService({ backgroundPermission: 'denied' }),
    });
    const failed = await requestContinuousLocationBackgroundPermission({
      streamService: createMockStreamService({ backgroundPermissionError: true }),
    });

    assert.equal(denied.kind, 'blocked');
    assert.equal(failed.kind, 'blocked');
    if (denied.kind === 'blocked') {
      assert.equal(denied.reason, 'background_permission_denied');
    }
    if (failed.kind === 'blocked') {
      assert.equal(failed.reason, 'background_permission_denied');
    }
  });

  it('does not start continuous updates before delivery_active', async () => {
    const streamService = createMockStreamService();

    const result = await startContinuousLocationUpdatesAfterDeliveryStart({
      deliveryStart: { flowState: 'route_ready', kind: 'permission_denied', reason: 'foreground_location_denied', message: 'denied' },
      routePlanId: 'route-1',
      streamService,
    });

    assert.deepEqual(result, {
      kind: 'blocked',
      message: 'Continuous location updates start only after delivery_active.',
      reason: 'delivery_not_active',
    });
    assert.equal(streamService.started.length, 0);
  });

  it('blocks continuous updates when background location is unavailable', async () => {
    const streamService = createMockStreamService({ availability: false });

    const result = await startContinuousLocationUpdatesAfterDeliveryStart({
      deliveryStart: activeDelivery,
      routePlanId: 'route-1',
      streamService,
    });

    assert.equal(result.kind, 'blocked');
    assert.equal(result.reason, 'background_unavailable');
    assert.equal(streamService.started.length, 0);
  });

  it('blocks continuous updates when previously requested background permission is denied', async () => {
    const streamService = createMockStreamService({ backgroundPermission: 'denied' });

    const result = await startContinuousLocationUpdatesAfterDeliveryStart({
      deliveryStart: activeDelivery,
      routePlanId: 'route-1',
      streamService,
    });

    assert.equal(result.kind, 'blocked');
    assert.equal(result.reason, 'background_permission_denied');
    assert.equal(streamService.started.length, 0);
  });

  it('starts the same background location task before Start when the background permission is already granted', async () => {
    const streamService = createMockStreamService();

    const result = await startContinuousLocationUpdatesBeforeDeliveryStart({
      notification: { body: 'Location is shared with the office before the route starts.', title: 'Tuesday AM Route' },
      routePlanId: 'route-1',
      streamService,
    });

    assert.deepEqual(result, {
      alreadyStarted: false,
      kind: 'streaming',
      message: 'Continuous location updates are active.',
      routePlanId: 'route-1',
      taskName: 'clever-routes-continuous-location',
    });
    assert.equal(streamService.started.length, 1);

    const denied = createMockStreamService({ backgroundPermission: 'denied' });
    const blocked = await startContinuousLocationUpdatesBeforeDeliveryStart({ routePlanId: 'route-1', streamService: denied });
    assert.equal(blocked.kind, 'blocked');
    assert.equal(blocked.kind === 'blocked' ? blocked.reason : null, 'background_permission_denied');
    assert.equal(denied.started.length, 0);
  });

  it('starts a named background location task after delivery_active', async () => {
    const streamService = createMockStreamService();

    const result = await startContinuousLocationUpdatesAfterDeliveryStart({
      deliveryStart: activeDelivery,
      notification: {
        body: 'Items: 2x Tomato box',
        title: 'Next stop 1  ETA 7:08 AM',
      },
      routePlanId: 'route-1',
      streamService,
    });

    assert.deepEqual(result, {
      alreadyStarted: false,
      kind: 'streaming',
      message: 'Continuous location updates are active.',
      routePlanId: 'route-1',
      taskName: 'clever-routes-continuous-location',
    });
    assert.deepEqual(streamService.started, [{
      notification: {
        body: 'Items: 2x Tomato box',
        title: 'Next stop 1  ETA 7:08 AM',
      },
      routePlanId: 'route-1',
      taskName: 'clever-routes-continuous-location',
    }]);
  });

  it('records each continuous location batch item as LOCATION_UPDATED', async () => {
    const driverEventService = createMockDriverEventService();

    const result = await recordContinuousLocationUpdateBatch({
      driverEventService,
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
        { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
      ],
      routePlanId: 'route-1',
    });

    assert.deepEqual(result, { kind: 'recorded', recordedCount: 2 });
    assert.deepEqual(driverEventService.recordedEvents.map((event) => ({
      eventType: event.eventType,
      latitude: event.latitude,
      longitude: event.longitude,
      occurredAt: event.occurredAt,
      routePlanId: event.routePlanId,
    })), [
      {
        eventType: 'LOCATION_UPDATED',
        latitude: 43.6532,
        longitude: -79.3832,
        occurredAt: new Date('2026-05-12T08:45:00.000Z'),
        routePlanId: 'route-1',
      },
      {
        eventType: 'LOCATION_UPDATED',
        latitude: 43.654,
        longitude: -79.384,
        occurredAt: new Date('2026-05-12T08:46:00.000Z'),
        routePlanId: 'route-1',
      },
    ]);
  });

  it('queues failed continuous LOCATION_UPDATED batch items for retry', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const originalDateNow = Date.now;
    Date.now = () => new Date('2026-05-12T08:45:30.000Z').getTime();

    try {
      const result = await recordContinuousLocationUpdateBatch({
        driverEventService: {
          recordDriverEvent: async () => {
            throw new Error('network offline');
          },
        },
        locations: [
          { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
          { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
        ],
        offlineQueue: queue,
        routePlanId: 'route-1',
      });

      assert.deepEqual(result, { kind: 'recorded', queuedCount: 2, recordedCount: 0 });
      const pending = queue.listPending();
      assert.equal(pending.length, 2);
      assert.deepEqual(pending.map((item) => item.queueItemId), [
        'driver-event:continuous-location-2026-05-12T08:45:00.000Z-0',
        'driver-event:continuous-location-2026-05-12T08:46:00.000Z-1',
      ]);
      assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'LOCATION_UPDATED');
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('stores the rest of a batch at once after the first request that fails, instead of waiting on more requests', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    let calls = 0;

    const result = await recordContinuousLocationUpdateBatch({
      driverEventService: {
        recordDriverEvent: async () => {
          calls += 1;
          throw new Error('network offline');
        },
      },
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
        { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
        { latitude: 43.655, longitude: -79.385, occurredAt: new Date('2026-05-12T08:47:00.000Z') },
      ],
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(calls, 1);
    assert.deepEqual(result, { kind: 'recorded', queuedCount: 3, recordedCount: 0 });
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:continuous-location-2026-05-12T08:45:00.000Z-0',
      'driver-event:continuous-location-2026-05-12T08:46:00.000Z-1',
      'driver-event:continuous-location-2026-05-12T08:47:00.000Z-2',
    ]);
  });

  it('keeps sending the next points live after a rejection that only concerns one point', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    let calls = 0;

    const result = await recordContinuousLocationUpdateBatch({
      driverEventService: {
        recordDriverEvent: async (event) => {
          calls += 1;
          if (calls === 1) {
            throw createDriverApiHttpError({ endpoint: 'Driver event record', status: 400 });
          }
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
        { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
        { latitude: 43.655, longitude: -79.385, occurredAt: new Date('2026-05-12T08:47:00.000Z') },
      ],
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(calls, 3);
    assert.deepEqual(result, { kind: 'recorded', queuedCount: 1, recordedCount: 2 });
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:continuous-location-2026-05-12T08:45:00.000Z-0',
    ]);
  });

  it('treats a server error, a rate limit and a timeout status as a reason to stop waiting on live requests', async () => {
    for (const status of [408, 429, 500, 503]) {
      const queue = createInMemoryOfflineSubmissionQueue();
      let calls = 0;

      const result = await recordContinuousLocationUpdateBatch({
        driverEventService: {
          recordDriverEvent: async () => {
            calls += 1;
            throw createDriverApiHttpError({ endpoint: 'Driver event record', status });
          },
        },
        locations: [
          { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
          { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
        ],
        offlineQueue: queue,
        routePlanId: 'route-1',
      });

      assert.equal(calls, 1, `HTTP ${status}`);
      assert.deepEqual(result, { kind: 'recorded', queuedCount: 2, recordedCount: 0 }, `HTTP ${status}`);
    }
  });

  it('bounds a live request and stores the batch when the request does not answer in time', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const signals: AbortSignal[] = [];
    let calls = 0;

    const result = await recordContinuousLocationUpdateBatch({
      driverEventService: {
        recordDriverEvent: (_event, options) => {
          calls += 1;
          if (options?.signal !== undefined) signals.push(options.signal);
          return new Promise(() => undefined);
        },
      },
      liveRequestTimeoutMs: 5,
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
        { latitude: 43.654, longitude: -79.384, occurredAt: new Date('2026-05-12T08:46:00.000Z') },
      ],
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(calls, 1);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.aborted, true);
    assert.deepEqual(result, { kind: 'recorded', queuedCount: 2, recordedCount: 0 });
    assert.equal(queue.listPending().length, 2);
  });

  it('rethrows the failure when there is no offline queue to hold the points', async () => {
    await assert.rejects(recordContinuousLocationUpdateBatch({
      driverEventService: {
        recordDriverEvent: async () => {
          throw new Error('network offline');
        },
      },
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
      ],
      routePlanId: 'route-1',
    }), /network offline/u);
  });

  it('does not queue locations after the server says the route is not in progress', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await recordContinuousLocationUpdateBatch({
      driverEventService: {
        recordDriverEvent: async () => {
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      },
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-05-12T08:45:00.000Z') },
      ],
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(result, { kind: 'route_not_in_progress', recordedCount: 0 });
    assert.deepEqual(queue.listPending(), []);
  });

  describe('sending stored GPS points when the connection is back', () => {
    const stored = (queue: ReturnType<typeof createInMemoryOfflineSubmissionQueue>, id: string, minute: number, routePlanId = 'route-1', eventType: 'LOCATION_UPDATED' | 'ROUTE_STARTED' = 'LOCATION_UPDATED') => {
      queue.enqueueDriverEvent({
        clientEventId: id,
        eventType,
        latitude: 43.65,
        longitude: -79.38,
        occurredAt: new Date(Date.UTC(2026, 9, 10, 9, minute)),
        routePlanId,
      });
    };

    it('sends the stored GPS points of the route oldest first, up to the limit, and acknowledges them', async () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      stored(queue, 'gps-1', 1);
      stored(queue, 'other-route', 2, 'route-2');
      stored(queue, 'gps-2', 3);
      stored(queue, 'note', 4, 'route-1', 'ROUTE_STARTED');
      stored(queue, 'gps-3', 5);
      const driverEventService = createMockDriverEventService();

      const result = await sendStoredContinuousLocations({
        driverEventService, maxItems: 2, offlineQueue: queue, routePlanId: 'route-1',
      });

      assert.deepEqual(result, { sentCount: 2 });
      assert.deepEqual(driverEventService.recordedEvents.map((event) => event.clientEventId), ['gps-1', 'gps-2']);
      assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
        'driver-event:other-route', 'driver-event:note', 'driver-event:gps-3',
      ]);
    });

    it('stops at the first failure and leaves that point stored', async () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      for (const [index, id] of ['gps-1', 'gps-2', 'gps-3'].entries()) stored(queue, id, index + 1);
      const sent: string[] = [];

      const result = await sendStoredContinuousLocations({
        driverEventService: {
          recordDriverEvent: async (event) => {
            sent.push(event.clientEventId);
            if (event.clientEventId === 'gps-2') throw new Error('network request failed');
            return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
          },
        },
        offlineQueue: queue,
        routePlanId: 'route-1',
      });

      assert.deepEqual(result, { sentCount: 1 });
      assert.deepEqual(sent, ['gps-1', 'gps-2']);
      assert.deepEqual(queue.listPending().map((item) => item.queueItemId), ['driver-event:gps-2', 'driver-event:gps-3']);
      assert.equal(queue.listPending()[0]?.attempts, 0);
    });

    it('stops quietly when the server says the route is not in progress and leaves reconciliation to the retry', async () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      stored(queue, 'gps-1', 1);
      stored(queue, 'gps-2', 2);

      const result = await sendStoredContinuousLocations({
        driverEventService: {
          recordDriverEvent: async () => {
            throw createDriverApiHttpError({ code: 'ROUTE_NOT_IN_PROGRESS', endpoint: 'Driver event record', status: 409 });
          },
        },
        offlineQueue: queue,
        routePlanId: 'route-1',
      });

      assert.deepEqual(result, { sentCount: 0 });
      assert.equal(queue.listPending().length, 2);
      assert.equal(queue.listPending().every((item) => item.attempts === 0 && item.reconciliation === undefined), true);
    });

    it('stops when its time budget is used up', async () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      for (const [index, id] of ['gps-1', 'gps-2', 'gps-3', 'gps-4'].entries()) stored(queue, id, index + 1);
      let clock = 0;
      const driverEventService = createMockDriverEventService();
      const record = driverEventService.recordDriverEvent;
      driverEventService.recordDriverEvent = async (event, options) => {
        clock += 60;
        return record(event, options);
      };

      const result = await sendStoredContinuousLocations({
        driverEventService, now: () => clock, offlineQueue: queue, routePlanId: 'route-1', timeBudgetMs: 100,
      });

      assert.deepEqual(result, { sentCount: 2 });
      assert.equal(queue.listPending().length, 2);
    });

    it('stops when the session ends and when a request does not answer in time', async () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      for (const [index, id] of ['gps-1', 'gps-2', 'gps-3'].entries()) stored(queue, id, index + 1);
      let current = true;
      const driverEventService = createMockDriverEventService();
      const record = driverEventService.recordDriverEvent;
      driverEventService.recordDriverEvent = async (event, options) => {
        current = false;
        return record(event, options);
      };
      const ended = await sendStoredContinuousLocations({
        driverEventService, isSessionCurrent: async () => current, offlineQueue: queue, routePlanId: 'route-1',
      });
      assert.deepEqual(ended, { sentCount: 1 });

      let calls = 0;
      const slow = await sendStoredContinuousLocations({
        driverEventService: { recordDriverEvent: () => { calls += 1; return new Promise(() => undefined); } },
        liveRequestTimeoutMs: 5,
        offlineQueue: queue,
        routePlanId: 'route-1',
      });
      assert.deepEqual(slow, { sentCount: 0 });
      assert.equal(calls, 1);
      assert.equal(queue.listPending().length, 2);
    });
  });

  it('stops the named continuous location task', async () => {
    const streamService = createMockStreamService();

    const result = await stopContinuousLocationUpdates({ streamService });

    assert.deepEqual(result, { kind: 'stopped', taskName: 'clever-routes-continuous-location' });
    assert.deepEqual(streamService.stopped, ['clever-routes-continuous-location']);
  });

  it('clears the active route marker before stopping native tracking', async () => {
    const calls: string[] = [];
    const streamService = createMockStreamService();
    streamService.stopLocationUpdates = async (taskName) => {
      calls.push(`stop:${taskName}`);
    };

    const result = await clearAndStopContinuousLocationSession({
      activeRouteSessionStore: {
        clearActiveRouteSession: async () => {
          calls.push('clear-active-route');
          return true;
        },
      },
      streamService,
    });

    assert.deepEqual(result, { kind: 'stopped', taskName: 'clever-routes-continuous-location' });
    assert.deepEqual(calls, [
      'clear-active-route',
      'stop:clever-routes-continuous-location',
    ]);
  });

  it('does not stop a newer active route when stale cleanup targets another route', async () => {
    const streamService = createMockStreamService();

    const result = await clearAndStopContinuousLocationSession({
      activeRouteSessionStore: {
        clearActiveRouteSession: async () => false,
      },
      routePlanId: 'stale-route',
      streamService,
    });

    assert.deepEqual(result, {
      kind: 'unchanged',
      taskName: 'clever-routes-continuous-location',
    });
    assert.deepEqual(streamService.stopped, []);
  });

  it('does not stop a new same-assignment session when stale cleanup loses its instance lease', async () => {
    const streamService = createMockStreamService();
    let currentSessionInstanceId = 'session-a-started-at';
    let nativeStopCalls = 0;
    let releaseClear!: () => void;
    let signalClearStarted!: () => void;
    const clearPaused = new Promise<void>((resolve) => { releaseClear = resolve; });
    const clearStarted = new Promise<void>((resolve) => { signalClearStarted = resolve; });
    streamService.stopLocationUpdatesIfCurrent = async (_taskName, isCurrent) => {
      if (!(await isCurrent())) return false;
      nativeStopCalls += 1;
      return true;
    };
    const cleanup = clearAndStopContinuousLocationSession({
      activeRouteSessionStore: {
        clearActiveRouteSession: async (_routePlanId, sessionInstanceId, assignmentGeneration) => {
          assert.equal(sessionInstanceId, 'session-a-started-at');
          assert.equal(assignmentGeneration, '11');
          signalClearStarted();
          await clearPaused;
          return true;
        },
      },
      assignmentGeneration: '11',
      isSessionLeaseCurrent: () => currentSessionInstanceId === 'session-a-started-at',
      routePlanId: 'shared-route',
      sessionInstanceId: 'session-a-started-at',
      streamService,
    });

    await clearStarted;
    currentSessionInstanceId = 'session-b-started-at';
    releaseClear();
    assert.deepEqual(await cleanup, {
      kind: 'unchanged', taskName: 'clever-routes-continuous-location',
    });
    assert.equal(nativeStopCalls, 0);
  });
});
