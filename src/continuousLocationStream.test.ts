import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDriverEventService } from './driverEvents';
import {
  recordContinuousLocationUpdateBatch,
  startContinuousLocationUpdatesAfterDeliveryStart,
  stopContinuousLocationUpdates,
  type ContinuousLocationStreamService,
} from './continuousLocationStream';

const activeDelivery = {
  flowState: 'delivery_active',
  kind: 'delivery_active',
  locationPermission: 'foreground',
  message: 'active',
} as const;

function createMockStreamService(input?: {
  availability?: boolean;
  backgroundPermission?: 'denied' | 'granted';
  alreadyStarted?: boolean;
}): ContinuousLocationStreamService & { started: unknown[]; stopped: string[] } {
  const started: unknown[] = [];
  const stopped: string[] = [];
  return {
    started,
    stopped,
    getBackgroundAvailability: async () => input?.availability ?? true,
    requestBackgroundPermission: async () => input?.backgroundPermission ?? 'granted',
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

  it('blocks continuous updates when background permission is denied', async () => {
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
    assert.deepEqual(streamService.started, [{ routePlanId: 'route-1', taskName: 'clever-driver-continuous-location' }]);
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

  it('stops the named continuous location task', async () => {
    const streamService = createMockStreamService();

    const result = await stopContinuousLocationUpdates({ streamService });

    assert.deepEqual(result, { kind: 'stopped', taskName: 'clever-driver-continuous-location' });
    assert.deepEqual(streamService.stopped, ['clever-driver-continuous-location']);
  });
});
