import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import {
  clearAndStopContinuousLocationSession,
  recordContinuousLocationUpdateBatch,
  requestContinuousLocationBackgroundPermission,
  startContinuousLocationUpdatesAfterDeliveryStart,
  stopContinuousLocationUpdates,
  type ContinuousLocationStreamService,
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
      taskName: 'clever-driver-continuous-location',
    });
    assert.deepEqual(streamService.started, [{
      notification: {
        body: 'Items: 2x Tomato box',
        title: 'Next stop 1  ETA 7:08 AM',
      },
      routePlanId: 'route-1',
      taskName: 'clever-driver-continuous-location',
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

  it('stops the named continuous location task', async () => {
    const streamService = createMockStreamService();

    const result = await stopContinuousLocationUpdates({ streamService });

    assert.deepEqual(result, { kind: 'stopped', taskName: 'clever-driver-continuous-location' });
    assert.deepEqual(streamService.stopped, ['clever-driver-continuous-location']);
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

    assert.deepEqual(result, { kind: 'stopped', taskName: 'clever-driver-continuous-location' });
    assert.deepEqual(calls, [
      'clear-active-route',
      'stop:clever-driver-continuous-location',
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
      taskName: 'clever-driver-continuous-location',
    });
    assert.deepEqual(streamService.stopped, []);
  });
});
