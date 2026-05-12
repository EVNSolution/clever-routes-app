import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDriverEventService } from './driverEvents';
import { recordStopProofEventAfterDeliveryStart } from './stopProofEvents';

const activeDelivery = {
  flowState: 'delivery_active',
  kind: 'delivery_active',
  locationPermission: 'foreground',
  message: 'active',
} as const;

describe('stop proof event flow', () => {
  it('does not record stop proof before delivery_active', async () => {
    const driverEventService = createMockDriverEventService();

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: { flowState: 'route_ready', kind: 'permission_denied', reason: 'foreground_location_denied', message: 'denied' },
      driverEventService,
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Left with concierge',
        routePlanId: 'route-1',
      },
    });

    assert.deepEqual(result, {
      kind: 'blocked',
      message: 'Stop proof events are recorded only after delivery_active.',
      reason: 'delivery_not_active',
    });
    assert.equal(driverEventService.recordedEvents.length, 0);
  });

  it('records STOP_DELIVERED with proof note metadata after delivery_active', async () => {
    const driverEventService = createMockDriverEventService();

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService,
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Left with concierge',
        occurredAt: new Date('2026-05-12T07:10:00.000Z'),
        photoUris: ['file:///proof/stop-1.jpg'],
        routePlanId: 'route-1',
      },
    });

    assert.equal(result.kind, 'recorded');
    assert.deepEqual(driverEventService.recordedEvents[0], {
      clientEventId: driverEventService.recordedEvents[0]?.clientEventId,
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T07:10:00.000Z'),
      payload: {
        proof: {
          media: [{ kind: 'photo', uri: 'file:///proof/stop-1.jpg' }],
          note: 'Left with concierge',
          source: 'driver-app-mvp',
          type: 'DELIVERED_NOTE',
        },
      },
      routePlanId: 'route-1',
    });
  });

  it('records STOP_FAILED with failure reason metadata after delivery_active', async () => {
    const driverEventService = createMockDriverEventService();

    await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService,
      input: {
        action: 'failed',
        deliveryStopId: 'stop-2',
        note: 'No answer at buzzer',
        reason: 'CUSTOMER_UNAVAILABLE',
        routePlanId: 'route-1',
      },
    });

    assert.equal(driverEventService.recordedEvents[0]?.eventType, 'STOP_FAILED');
    assert.deepEqual(driverEventService.recordedEvents[0]?.payload, {
      proof: {
        note: 'No answer at buzzer',
        reason: 'CUSTOMER_UNAVAILABLE',
        source: 'driver-app-mvp',
        type: 'FAILED_REASON',
      },
    });
  });
});
