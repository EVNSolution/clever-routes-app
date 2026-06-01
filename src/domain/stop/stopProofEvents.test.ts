import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
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

  it('records uploaded media, signature, and barcode proof references after delivery_active', async () => {
    const driverEventService = createMockDriverEventService();

    await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService,
      input: {
        action: 'delivered',
        barcodes: [
          {
            barcodeId: 'barcode-1',
            capturedAt: '2026-05-12T10:10:00.000Z',
            data: 'ORDER-1001',
            kind: 'barcode',
            source: 'native-scanner',
            symbology: 'code128',
          },
        ],
        deliveryStopId: 'stop-1',
        media: [
          {
            contentType: 'image/jpeg',
            kind: 'photo',
            mediaId: 'media-1',
            sha256: 'sha256-fixture',
            sizeBytes: 12345,
            source: 'camera',
            storageKey: 'driver-proof/media-1.jpg',
            uploadedAt: '2026-05-12T10:00:00.000Z',
          },
        ],
        note: 'Signed and photo uploaded',
        routePlanId: 'route-1',
        signatures: [
          {
            kind: 'signature',
            pointCount: 3,
            signatureId: 'signature-1',
            signerName: 'Recipient One',
            source: 'native-drawing',
            strokeCount: 2,
          },
        ],
      },
    });

    assert.deepEqual(driverEventService.recordedEvents[0]?.payload, {
      proof: {
        barcodes: [
          {
            barcodeId: 'barcode-1',
            capturedAt: '2026-05-12T10:10:00.000Z',
            data: 'ORDER-1001',
            kind: 'barcode',
            source: 'native-scanner',
            symbology: 'code128',
          },
        ],
        media: [
          {
            contentType: 'image/jpeg',
            kind: 'photo',
            mediaId: 'media-1',
            sha256: 'sha256-fixture',
            sizeBytes: 12345,
            source: 'camera',
            storageKey: 'driver-proof/media-1.jpg',
            uploadedAt: '2026-05-12T10:00:00.000Z',
          },
        ],
        note: 'Signed and photo uploaded',
        signatures: [
          {
            kind: 'signature',
            pointCount: 3,
            signatureId: 'signature-1',
            signerName: 'Recipient One',
            source: 'native-drawing',
            strokeCount: 2,
          },
        ],
        source: 'driver-app-mvp',
        type: 'DELIVERED_NOTE',
      },
    });
  });

  it('queues stop proof driver event when the live event submission fails', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        recordDriverEvent: async () => {
          throw new Error('network offline');
        },
      },
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Queue until online',
        occurredAt: new Date('2026-05-12T11:05:00.000Z'),
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.reason, 'record_failed');
    assert.equal(queue.listPending().length, 1);
    assert.equal(queue.listPending()[0]?.kind, 'driver_event');
  });

  it('marks queued stop proof events as requiring route lookup when live event returns unauthorized', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        recordDriverEvent: async () => {
          throw createDriverApiHttpError({ endpoint: 'Driver event record', status: 401 });
        },
      },
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Queue until re-authenticated',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.requiresRouteLookup, true);
    assert.match(result.message, /Driver session expired/iu);
    assert.match(result.message, /HTTP 401/iu);
  });
});
