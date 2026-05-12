import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDriverEventService } from './driverEvents';
import { createInMemoryOfflineSubmissionQueue, retryOfflineSubmissions } from './offlineSubmissionQueue';

describe('offline submission queue', () => {
  it('enqueues driver events and proof media uploads with stable item ids', () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    const driverEventItem = queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      payload: { proof: { note: 'offline' } },
      routePlanId: 'route-1',
    });
    const proofMediaItem = queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });

    assert.equal(driverEventItem.queueItemId, 'driver-event:event-1');
    assert.equal(proofMediaItem.queueItemId, 'proof-media:route-1:stop-1:stop-1.jpg');
    assert.equal(queue.listPending().length, 2);
  });

  it('keeps one pending item per idempotency key', () => {
    const queue = createInMemoryOfflineSubmissionQueue();

    queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });
    queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:01:00.000Z'),
    });

    assert.equal(queue.listPending().length, 1);
    assert.equal(queue.listPending()[0]?.attempts, 0);
  });

  it('retries queued submissions and removes successful items', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => ({
          contentType: 'image/jpeg',
          kind: 'photo',
          mediaId: 'media-1',
          source: 'camera',
          storageKey: 'proof/media-1.jpg',
          uploadedAt: '2026-05-12T11:01:00.000Z',
        }),
      },
      queue,
    });

    assert.deepEqual(result, {
      failed: 0,
      retried: 2,
      succeeded: 2,
    });
    assert.equal(queue.listPending().length, 0);
  });

  it('retains failed retry items with attempt count and last error', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => {
          throw new Error('still offline');
        },
      },
      queue,
    });

    assert.deepEqual(result, {
      failed: 1,
      retried: 1,
      succeeded: 0,
    });
    assert.equal(queue.listPending()[0]?.attempts, 1);
    assert.equal(queue.listPending()[0]?.lastError, 'still offline');
  });

  it('discards queued submissions by item id', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });

    assert.equal(queue.discard(item.queueItemId), true);
    assert.equal(queue.listPending().length, 0);
  });
});
