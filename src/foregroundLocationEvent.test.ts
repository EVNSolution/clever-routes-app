import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDriverEventService } from './driverEvents';
import {
  recordForegroundLocationUpdateAfterDeliveryStart,
  type ForegroundLocationSnapshotService,
} from './foregroundLocationEvent';
import { createInMemoryOfflineSubmissionQueue } from './offlineSubmissionQueue';

function createLocationService(): ForegroundLocationSnapshotService & { requests: number } {
  return {
    requests: 0,
    getCurrentForegroundLocation: async function getCurrentForegroundLocation() {
      this.requests += 1;
      return {
        latitude: 43.6487,
        longitude: -79.3817,
        recordedAt: new Date('2026-05-12T07:05:00.000Z'),
      };
    },
  };
}

describe('foreground location update event flow', () => {
  it('does not read location or record an event before delivery_active', async () => {
    const driverEventService = createMockDriverEventService();
    const locationService = createLocationService();

    const result = await recordForegroundLocationUpdateAfterDeliveryStart({
      deliveryStart: { flowState: 'route_ready', kind: 'permission_denied', reason: 'foreground_location_denied', message: 'denied' },
      driverEventService,
      locationService,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'blocked');
    assert.equal(locationService.requests, 0);
    assert.equal(driverEventService.recordedEvents.length, 0);
  });

  it('records a LOCATION_UPDATED event with foreground coordinates after delivery_active', async () => {
    const driverEventService = createMockDriverEventService();
    const locationService = createLocationService();

    const result = await recordForegroundLocationUpdateAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService,
      locationService,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'recorded');
    assert.equal(locationService.requests, 1);
    assert.equal(driverEventService.recordedEvents.length, 1);
    assert.deepEqual(driverEventService.recordedEvents[0], {
      clientEventId: driverEventService.recordedEvents[0]?.clientEventId,
      eventType: 'LOCATION_UPDATED',
      latitude: 43.6487,
      longitude: -79.3817,
      occurredAt: new Date('2026-05-12T07:05:00.000Z'),
      routePlanId: 'route-1',
    });
  });

  it('queues foreground LOCATION_UPDATED when event submission fails', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const locationService = createLocationService();

    const result = await recordForegroundLocationUpdateAfterDeliveryStart({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: {
        recordDriverEvent: async () => {
          throw new Error('network offline');
        },
      },
      locationService,
      offlineQueue: queue,
      routePlanId: 'route-1',
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.reason, 'record_failed');
    assert.equal(locationService.requests, 1);
    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'LOCATION_UPDATED');
  });
});
