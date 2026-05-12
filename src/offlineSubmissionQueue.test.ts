import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockDriverEventService } from './driverEvents';
import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY,
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  retryOfflineSubmissions,
  type OfflineSubmissionQueueStorage,
} from './offlineSubmissionQueue';

function createMemoryStorage(initial?: Record<string, string>): OfflineSubmissionQueueStorage & {
  removedKeys: string[];
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial ?? {}));
  const removedKeys: string[] = [];
  return {
    removedKeys,
    values,
    getItem: async (key) => values.get(key) ?? null,
    removeItem: async (key) => {
      removedKeys.push(key);
      values.delete(key);
    },
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

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
      discarded: 0,
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
      discarded: 0,
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

  it('hydrates pending queue items from durable storage', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: JSON.stringify({
        items: [
          {
            attempts: 1,
            enqueuedAt: '2026-05-12T11:00:00.000Z',
            event: {
              clientEventId: 'event-1',
              eventType: 'STOP_DELIVERED',
              occurredAt: '2026-05-12T11:01:00.000Z',
              routePlanId: 'route-1',
            },
            kind: 'driver_event',
            lastError: 'offline',
            queueItemId: 'driver-event:event-1',
          },
        ],
        version: 1,
      }),
    });

    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const pending = queue.listPending();

    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind, 'driver_event');
    assert.equal(pending[0]?.attempts, 1);
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.occurredAt instanceof Date : false, true);
  });

  it('persists enqueue and discard mutations to durable storage', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });

    const item = queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });
    await queue.whenPersisted();

    assert.match(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '', /proof-media:route-1:stop-1:stop-1.jpg/u);

    queue.discard(item.queueItemId);
    await queue.whenPersisted();

    assert.deepEqual(JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}'), {
      items: [],
      version: 1,
    });
  });

  it('persists retry success removal and retry failure attempts', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
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
        uploadProofMedia: async () => {
          throw new Error('still offline');
        },
      },
      queue,
    });
    await queue.whenPersisted();

    assert.deepEqual(result, { discarded: 0, failed: 1, retried: 2, succeeded: 1 });
    const stored = JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { attempts: number; kind: string; lastError?: string; queueItemId: string }[];
    };
    assert.deepEqual(stored.items.map((item) => ({
      attempts: item.attempts,
      kind: item.kind,
      lastError: item.lastError,
      queueItemId: item.queueItemId,
    })), [
      {
        attempts: 1,
        kind: 'proof_media',
        lastError: 'still offline',
        queueItemId: 'proof-media:route-1:stop-1:stop-1.jpg',
      },
    ]);
  });

  it('recovers from malformed durable storage without reusing corrupt payloads', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: '{"version":1,"items":[{"kind":"driver_event"}]}',
    });

    const queue = await createPersistentOfflineSubmissionQueue({ storage });

    assert.deepEqual(queue.listPending(), []);
    assert.deepEqual(storage.removedKeys, [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]);
  });

  it('serializes durable writes so older persistence cannot overwrite newer queue state', async () => {
    const values = new Map<string, string>();
    let releaseFirstWrite: (() => void) | null = null;
    let writeCount = 0;
    const storage: OfflineSubmissionQueueStorage = {
      getItem: async () => null,
      removeItem: async (key) => {
        values.delete(key);
      },
      setItem: async (key, value) => {
        writeCount += 1;
        if (writeCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
          });
        }
        values.set(key, value);
      },
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage });

    const item = queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });
    queue.discard(item.queueItemId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const release = releaseFirstWrite as (() => void) | null;
    if (release === null) {
      assert.fail('first durable write did not start');
    }
    release();
    await queue.whenPersisted();

    assert.deepEqual(JSON.parse(values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}'), {
      items: [],
      version: 1,
    });
  });

  it('discards expired queued submissions before retrying live services', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({
      initialItems: [
        {
          attempts: 0,
          enqueuedAt: '2026-05-09T10:59:59.999Z',
          event: {
            clientEventId: 'old-event',
            eventType: 'STOP_DELIVERED',
            occurredAt: new Date('2026-05-09T10:59:59.999Z'),
            routePlanId: 'route-1',
          },
          kind: 'driver_event',
          queueItemId: 'driver-event:old-event',
        },
        {
          attempts: 0,
          enqueuedAt: '2026-05-12T10:00:00.000Z',
          event: {
            clientEventId: 'fresh-event',
            eventType: 'STOP_DELIVERED',
            occurredAt: new Date('2026-05-12T10:00:00.000Z'),
            routePlanId: 'route-1',
          },
          kind: 'driver_event',
          queueItemId: 'driver-event:fresh-event',
        },
      ],
    });
    const recordedEventIds: string[] = [];

    const result = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async (event) => {
          recordedEventIds.push(event.clientEventId);
          return {
            duplicate: false,
            eventId: event.clientEventId,
            status: 'recorded',
          };
        },
      },
      now: () => new Date('2026-05-12T11:00:00.000Z'),
      proofMediaUploadService: {
        uploadProofMedia: async () => {
          throw new Error('unexpected proof upload');
        },
      },
      queue,
    });

    assert.deepEqual(result, {
      discarded: 1,
      failed: 0,
      retried: 2,
      succeeded: 1,
    });
    assert.deepEqual(recordedEventIds, ['fresh-event']);
    assert.deepEqual(queue.listPending(), []);
    assert.equal(OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY.maxAgeMs, 72 * 60 * 60 * 1000);
  });

  it('discards queued submissions after the maximum retained retry attempts', async () => {
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
      retryPolicy: {
        maxAgeMs: OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY.maxAgeMs,
        maxAttempts: 1,
      },
    });

    assert.deepEqual(result, {
      discarded: 1,
      failed: 0,
      retried: 1,
      succeeded: 0,
    });
    assert.deepEqual(queue.listPending(), []);
  });

  it('discards route-scoped queued submissions when a route is completed', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-1-event',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'route-2-event',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      routePlanId: 'route-2',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'unscoped-event',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });

    assert.equal(queue.discardRouteSubmissions('route-1'), 2);
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:route-2-event',
      'driver-event:unscoped-event',
    ]);
  });

  it('clears every queued submission on driver sign-out or session reset and persists it', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    queue.enqueueDriverEvent({
      clientEventId: 'event-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });

    assert.equal(queue.clear(), 2);
    await queue.whenPersisted();

    assert.deepEqual(queue.listPending(), []);
    assert.deepEqual(JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}'), {
      items: [],
      version: 1,
    });
  });
});
