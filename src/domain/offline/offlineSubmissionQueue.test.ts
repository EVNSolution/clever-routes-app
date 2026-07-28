import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import { createProofMediaRejectedError } from '../proof/proofMediaUpload';
import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY,
  createRouteOrderedDriverEventService,
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  getOfflineSubmissionQueueSummary,
  getPendingRouteEnd,
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

  it('reports the newest queued terminal route transition', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-completed',
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-07-21T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'route-released',
      eventType: 'ROUTE_PAUSED',
      occurredAt: new Date('2026-07-21T09:01:00.000Z'),
      routePlanId: 'route-1',
    });

    assert.equal(getPendingRouteEnd(queue, 'route-1'), 'released');
    assert.equal(getPendingRouteEnd(queue, 'route-2'), null);
  });

  it('queues later workflow events behind earlier pending route events', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'arrived',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_ARRIVED',
      occurredAt: new Date('2026-07-21T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    const live = createMockDriverEventService();
    const ordered = createRouteOrderedDriverEventService({
      driverEventService: live,
      queue,
      routePlanId: 'route-1',
    });

    await assert.rejects(ordered.recordDriverEvent({
      clientEventId: 'delivered',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-21T09:01:00.000Z'),
      routePlanId: 'route-1',
    }), /Earlier route updates are waiting to sync/u);
    assert.equal(live.recordedEvents.length, 0);

    queue.enqueueDriverEvent({
      clientEventId: 'delivered',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-21T09:01:00.000Z'),
      routePlanId: 'route-1',
    });
    await retryOfflineSubmissions({
      driverEventService: live,
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('unexpected proof upload'); },
      },
      queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(live.recordedEvents.map((event) => event.eventType), [
      'STOP_ARRIVED',
      'STOP_DELIVERED',
    ]);
  });

  it('allows the durable copy of the same workflow event to reach the live service', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const event = {
      clientEventId: 'route-completed',
      eventType: 'ROUTE_COMPLETED' as const,
      occurredAt: new Date('2026-07-21T09:01:00.000Z'),
      routePlanId: 'route-1',
    };
    queue.enqueueDriverEvent(event);
    const live = createMockDriverEventService();
    const ordered = createRouteOrderedDriverEventService({
      driverEventService: live,
      queue,
      routePlanId: 'route-1',
    });

    await ordered.recordDriverEvent(event);

    assert.deepEqual(live.recordedEvents, [event]);
  });

  it('does not delay location updates behind workflow submissions', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'arrived',
      eventType: 'STOP_ARRIVED',
      occurredAt: new Date('2026-07-21T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    const live = createMockDriverEventService();
    const ordered = createRouteOrderedDriverEventService({
      driverEventService: live,
      queue,
      routePlanId: 'route-1',
    });

    await ordered.recordDriverEvent({
      clientEventId: 'location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-21T09:01:00.000Z'),
      routePlanId: 'route-1',
    });

    assert.deepEqual(live.recordedEvents.map((event) => event.eventType), ['LOCATION_UPDATED']);
  });

  it('persists a failed location batch with one queue mutation', () => {
    let changeCount = 0;
    const queue = createInMemoryOfflineSubmissionQueue({
      onChange: () => { changeCount += 1; },
    });

    queue.enqueueDriverEvents([
      {
        clientEventId: 'location-1',
        eventType: 'LOCATION_UPDATED',
        occurredAt: new Date('2026-07-16T09:00:00.000Z'),
        routePlanId: 'route-1',
      },
      {
        clientEventId: 'location-2',
        eventType: 'LOCATION_UPDATED',
        occurredAt: new Date('2026-07-16T09:00:30.000Z'),
        routePlanId: 'route-1',
      },
    ]);

    assert.equal(changeCount, 1);
    assert.equal(queue.listPending().length, 2);
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

  it('marks offline retry failures as requiring route lookup when live retry returns unauthorized', async () => {
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
          throw createDriverApiHttpError({ endpoint: 'Proof media upload', status: 401 });
        },
      },
      queue,
    });

    assert.deepEqual(result, {
      discarded: 0,
      failed: 1,
      requiresRouteLookup: true,
      retried: 1,
      succeeded: 0,
    });
    assert.equal(queue.listPending()[0]?.attempts, 1);
    assert.equal(queue.listPending()[0]?.lastError, 'Proof media upload failed with HTTP 401');
  });

  it('quarantines terminal stop evidence and proof after a route-not-in-progress retry', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({
      now: () => new Date('2026-07-23T10:00:00.000Z'),
    });
    queue.enqueueDriverEvent({
      clientEventId: 'location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-23T09:59:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'delivered',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-23T09:59:30.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'proof.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof.jpg',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'other-route',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-23T09:59:00.000Z'),
      routePlanId: 'route-2',
    });
    let attempts = 0;

    const first = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async () => {
          attempts += 1;
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      },
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('must not upload after terminal recovery'); },
      },
      now: () => new Date('2026-07-23T10:00:00.000Z'),
      queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(first, {
      blocked: 2,
      discarded: 1,
      failed: 0,
      reconciliationRoutePlanIds: ['route-1'],
      retried: 1,
      succeeded: 0,
    });
    assert.equal(attempts, 1);
    assert.deepEqual(getOfflineSubmissionQueueSummary(queue), {
      blockedCount: 2,
      reconciliationRoutePlanIds: ['route-1'],
      retryableCount: 1,
      totalCount: 3,
    });
    const blocked = queue.listPending().filter((item) => item.reconciliation !== undefined);
    assert.deepEqual(blocked.map((item) => ({
      attempts: item.attempts,
      queueItemId: item.queueItemId,
      reconciliation: item.reconciliation,
    })), [
      {
        attempts: 0,
        queueItemId: 'driver-event:delivered',
        reconciliation: {
          blockedAt: '2026-07-23T10:00:00.000Z',
          reason: 'route_not_in_progress',
        },
      },
      {
        attempts: 0,
        queueItemId: 'proof-media:route-1:stop-1:proof.jpg',
        reconciliation: {
          blockedAt: '2026-07-23T10:00:00.000Z',
          reason: 'route_not_in_progress',
        },
      },
    ]);

    const second = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async () => { throw new Error('blocked evidence must not retry'); },
      },
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('blocked proof must not retry'); },
      },
      queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(second, { discarded: 0, failed: 0, retried: 0, succeeded: 0 });
    assert.equal(queue.listPending().filter((item) => item.reconciliation !== undefined).length, 2);
  });

  it('persists reconciliation state without aging out blocked evidence', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({
      now: () => new Date('2026-07-23T10:00:00.000Z'),
      storage,
    });
    queue.enqueueDriverEvent({
      clientEventId: 'failed',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_FAILED',
      occurredAt: new Date('2026-07-20T10:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.blockRouteSubmissionsForReconciliation('route-1');
    await queue.whenPersisted();

    const restored = await createPersistentOfflineSubmissionQueue({
      now: () => new Date('2026-08-23T10:00:00.000Z'),
      storage,
    });
    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      now: () => new Date('2026-08-23T10:00:00.000Z'),
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('unexpected upload'); },
      },
      queue: restored,
    });

    assert.deepEqual(result, { discarded: 0, failed: 0, retried: 0, succeeded: 0 });
    assert.equal(restored.listPending()[0]?.reconciliation?.reason, 'route_not_in_progress');
  });

  it('clears only acknowledged reconciliation records and keeps retryable submissions', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    queue.enqueueDriverEvent({
      clientEventId: 'blocked-delivery',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-20T10:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'retryable-location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-20T10:01:00.000Z'),
      routePlanId: 'route-2',
    });
    queue.blockRouteSubmissionsForReconciliation('route-1');

    assert.equal(queue.discardReconciliationRecords(), 1);
    await queue.whenPersisted();

    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:retryable-location',
    ]);

    const restored = await createPersistentOfflineSubmissionQueue({ storage });
    assert.deepEqual(restored.listPending().map((item) => item.queueItemId), [
      'driver-event:retryable-location',
    ]);
    assert.deepEqual(getOfflineSubmissionQueueSummary(restored), {
      blockedCount: 0,
      reconciliationRoutePlanIds: [],
      retryableCount: 1,
      totalCount: 1,
    });
  });

  it('discards scanner-rejected queued proof media instead of retrying it', async () => {
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
          throw createProofMediaRejectedError();
        },
      },
      queue,
    });

    assert.deepEqual(result, {
      discarded: 1,
      failed: 0,
      retried: 1,
      succeeded: 0,
    });
    assert.equal(queue.listPending().length, 0);
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

    assert.equal(storage.values.has(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY), false);
    assert.deepEqual(storage.removedKeys, [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]);
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

    assert.equal(values.has(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY), false);
  });

  it('surfaces a durable write failure and recovers on the next snapshot', async () => {
    const storage = createMemoryStorage();
    const baseSetItem = storage.setItem;
    let shouldFail = true;
    storage.setItem = async (key, value) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('storage full');
      }
      await baseSetItem(key, value);
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage });

    queue.enqueueDriverEvent({
      clientEventId: 'first',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    await assert.rejects(queue.whenPersisted(), /storage full/u);

    queue.enqueueDriverEvent({
      clientEventId: 'second',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T09:01:00.000Z'),
      routePlanId: 'route-1',
    });
    await queue.whenPersisted();

    const stored = JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { queueItemId: string }[];
    };
    assert.deepEqual(stored.items.map((item) => item.queueItemId), [
      'driver-event:first',
      'driver-event:second',
    ]);
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

  it('discards transient route submissions but preserves terminal stop evidence and proof', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-1-event',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'route-1-terminal-stop',
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
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
      routePlanId: 'route-2',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'unscoped-event',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-05-12T11:00:00.000Z'),
    });

    assert.equal(queue.discardRouteSubmissions('route-1'), 1);
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:route-1-terminal-stop',
      'proof-media:route-1:stop-1:stop-1.jpg',
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
    assert.equal(storage.values.has(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY), false);
    assert.deepEqual(storage.removedKeys, [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]);
  });

  it('trims oversized durable state by removing the oldest location before terminal evidence', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: JSON.stringify({
        items: [
          {
            attempts: 0,
            enqueuedAt: '2026-07-16T09:00:00.000Z',
            event: {
              clientEventId: 'terminal-stop',
              eventType: 'STOP_DELIVERED',
              occurredAt: '2026-07-16T09:00:00.000Z',
              routePlanId: 'route-1',
            },
            kind: 'driver_event',
            queueItemId: 'driver-event:terminal-stop',
          },
          {
            attempts: 0,
            enqueuedAt: '2026-07-16T09:01:00.000Z',
            event: {
              clientEventId: 'old-location',
              eventType: 'LOCATION_UPDATED',
              occurredAt: '2026-07-16T09:01:00.000Z',
              routePlanId: 'route-1',
            },
            kind: 'driver_event',
            queueItemId: 'driver-event:old-location',
          },
          {
            attempts: 0,
            enqueuedAt: '2026-07-16T09:02:00.000Z',
            event: {
              clientEventId: 'new-location',
              eventType: 'LOCATION_UPDATED',
              occurredAt: '2026-07-16T09:02:00.000Z',
              routePlanId: 'route-1',
            },
            kind: 'driver_event',
            queueItemId: 'driver-event:new-location',
          },
        ],
        version: 1,
      }),
    });

    const queue = await createPersistentOfflineSubmissionQueue({
      maxItems: 2,
      now: () => new Date('2026-07-16T10:00:00.000Z'),
      storage,
    });
    await queue.whenPersisted();

    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:terminal-stop',
      'driver-event:new-location',
    ]);
    const stored = JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { queueItemId: string }[];
    };
    assert.deepEqual(stored.items.map((item) => item.queueItemId), [
      'driver-event:terminal-stop',
      'driver-event:new-location',
    ]);
  });

  it('retries only the authenticated route without consuming attempts for another route', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-a',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T09:00:00.000Z'),
      routePlanId: 'route-a',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'route-b',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T09:00:00.000Z'),
      routePlanId: 'route-b',
    });
    const recorded: string[] = [];

    const result = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async (event) => {
          recorded.push(event.clientEventId);
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('unexpected proof upload'); },
      },
      queue,
      routePlanId: 'route-a',
    });

    assert.deepEqual(result, { discarded: 0, failed: 0, retried: 1, succeeded: 1 });
    assert.deepEqual(recorded, ['route-a']);
    assert.deepEqual(queue.listPending().map((item) => ({
      attempts: item.attempts,
      queueItemId: item.queueItemId,
    })), [{ attempts: 0, queueItemId: 'driver-event:route-b' }]);
  });

  it('applies route cleanup after a queued completion is recorded', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-completed',
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-07-16T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'stale-location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T08:59:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'proof.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof.jpg',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('should stay queued until a later retry'); },
      },
      queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(result, { discarded: 1, failed: 0, retried: 1, succeeded: 1 });
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'proof-media:route-1:stop-1:proof.jpg',
    ]);
  });
});
