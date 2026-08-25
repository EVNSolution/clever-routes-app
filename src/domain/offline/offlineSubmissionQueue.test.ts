import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createDriverEventsApiClient, createMockDriverEventService } from '../events/driverEvents';
import {
  createMockProofMediaUploadService,
  createProofMediaRejectedError,
  createProofMediaUploadApiClient,
} from '../proof/proofMediaUpload';
import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY,
  createRouteOrderedDriverEventService,
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  getOfflineSubmissionQueueSummary,
  getPendingRouteEnd,
  recoverPendingRouteEndReceipt,
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
      deliveryStopId: 'stop-1',
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

  it('atomically upgrades an existing ordered event with full v2 lineage before replay', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const base = {
      clientEventId: 'completion-existing', eventType: 'ROUTE_COMPLETED' as const,
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'route-1',
    };
    queue.enqueueDriverEvent(base);
    await queue.whenPersisted();
    queue.enqueueDriverEvent({
      ...base, appVersion: '2.8.0', assignmentGeneration: '11', driverContractVersion: 2,
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', versionCode: 20800,
    });
    await queue.whenPersisted();

    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    const item = restarted.listPending()[0];
    assert.equal(item?.kind, 'driver_event');
    if (item?.kind !== 'driver_event') throw new Error('Expected driver event');
    assert.deepEqual({
      appVersion: item.event.appVersion,
      assignmentGeneration: item.event.assignmentGeneration,
      driverContractVersion: item.event.driverContractVersion,
      expectedRouteVersionId: item.event.expectedRouteVersionId,
      versionCode: item.event.versionCode,
    }, {
      appVersion: '2.8.0', assignmentGeneration: '11', driverContractVersion: 2,
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', versionCode: 20800,
    });
  });

  it('does not hydrate lineage across a same-id event identity collision', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const original = queue.enqueueDriverEvent({
      clientEventId: 'legacy-collision', deliveryStopId: 'stop-old', eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-22T19:40:00.000Z'), payload: { proof: { note: 'old' } },
      routePlanId: 'route-old',
    });
    queue.enqueueDriverEvent({
      appVersion: '1.2.0', assignmentGeneration: '12', clientEventId: 'legacy-collision',
      driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '33333333-3333-4333-8333-333333333333',
      occurredAt: new Date('2026-08-22T19:43:10.000Z'), payload: { source: 'new' },
      routePlanId: 'route-new', versionCode: 18,
    });
    await queue.whenPersisted();

    const [retained] = (await createPersistentOfflineSubmissionQueue({ storage })).listPending();
    assert.equal(retained?.state, 'QUARANTINED');
    assert.equal(retained?.reconciliation?.reason, 'event_identity_conflict');
    assert.equal(retained?.kind, 'driver_event');
    if (retained?.kind !== 'driver_event') throw new Error('Expected driver event');
    assert.deepEqual(retained.event, original.event);
    assert.equal(retained.event.appVersion, undefined);
    assert.equal(retained.event.assignmentGeneration, undefined);
    assert.equal(retained.event.routePlanId, 'route-old');
    assert.equal(retained.event.eventType, 'STOP_DELIVERED');
  });

  it('keeps complete ordered evidence immutable and quarantines a same-id reassignment', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const original = queue.enqueueDriverEvent({
      appVersion: '1.1.6', assignmentGeneration: '11', clientEventId: 'same-id-reassigned',
      driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'route-1', versionCode: 17,
    });
    queue.enqueueDriverEvent({
      appVersion: '1.2.0', assignmentGeneration: '12', clientEventId: 'same-id-reassigned',
      driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '33333333-3333-4333-8333-333333333333',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'route-1', versionCode: 18,
    });

    const [retained] = queue.listPending();
    assert.equal(retained?.state, 'QUARANTINED');
    assert.equal(retained?.reconciliation?.reason, 'assignment_changed');
    assert.equal(retained?.kind, 'driver_event');
    if (retained?.kind !== 'driver_event') throw new Error('Expected driver event');
    assert.deepEqual(retained.event, original.event);
    assert.equal(retained.event.assignmentGeneration, '11');
    assert.equal(retained.event.versionCode, 17);
  });

  for (const collision of [
    {
      label: 'event type',
      mutate: (event: Parameters<ReturnType<typeof createInMemoryOfflineSubmissionQueue>['enqueueDriverEvent']>[0]) => ({
        ...event, eventType: 'ROUTE_COMPLETED' as const,
      }),
    },
    {
      label: 'delivery stop',
      mutate: (event: Parameters<ReturnType<typeof createInMemoryOfflineSubmissionQueue>['enqueueDriverEvent']>[0]) => ({
        ...event, deliveryStopId: 'stop-2',
      }),
    },
    {
      label: 'occurred time',
      mutate: (event: Parameters<ReturnType<typeof createInMemoryOfflineSubmissionQueue>['enqueueDriverEvent']>[0]) => ({
        ...event, occurredAt: new Date('2026-08-22T19:41:00.000Z'),
      }),
    },
    {
      label: 'payload',
      mutate: (event: Parameters<ReturnType<typeof createInMemoryOfflineSubmissionQueue>['enqueueDriverEvent']>[0]) => ({
        ...event, payload: { proof: { note: 'changed' } },
      }),
    },
  ]) {
    it(`quarantines a same-lineage same-id ${collision.label} collision`, async () => {
      const storage = createMemoryStorage();
      const queue = await createPersistentOfflineSubmissionQueue({ storage });
      const originalEvent = {
        appVersion: '1.2.0', assignmentGeneration: '11', clientEventId: `same-lineage-${collision.label}`,
        deliveryStopId: 'stop-1', driverContractVersion: 2 as const, eventType: 'STOP_DELIVERED' as const,
        expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
        occurredAt: new Date('2026-08-22T19:40:00.000Z'), payload: { proof: { note: 'original' } },
        routePlanId: 'route-1', versionCode: 18,
      };
      const original = queue.enqueueDriverEvent(originalEvent);
      queue.enqueueDriverEvent(collision.mutate(originalEvent));
      await queue.whenPersisted();

      const [retained] = (await createPersistentOfflineSubmissionQueue({ storage })).listPending();
      assert.equal(retained?.state, 'QUARANTINED');
      assert.equal(retained?.reconciliation?.reason, 'event_identity_conflict');
      assert.equal(retained?.kind, 'driver_event');
      if (retained?.kind !== 'driver_event') throw new Error('Expected driver event');
      assert.deepEqual(retained.event, original.event);
    });
  }

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
      deliveryStopId: 'stop-1',
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
      serverConfirmedStopIds: ['stop-1'],
      succeeded: 2,
    });
    assert.equal(queue.listPending().length, 0);
  });

  it('times out a hung ordered head, journals a stable code, and ignores late success without reordering', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    for (const [clientEventId, deliveryStopId] of [['south-head', 'south-1'], ['south-next', 'south-2']] as const) {
      queue.enqueueDriverEvent({
        clientEventId, deliveryStopId, eventType: 'STOP_DELIVERED',
        occurredAt: new Date('2026-08-22T12:00:00.000Z'), routePlanId: 'route-south',
      });
    }
    const expirations: (() => void)[] = [];
    let resolveHung!: () => void;
    const firstPass = retryOfflineSubmissions({
      attemptTimeoutMs: 100,
      cancelAttemptTimeout: () => undefined,
      driverEventService: { recordDriverEvent: () => new Promise((resolve) => { resolveHung = () => resolve({ duplicate: false, eventId: 'late', status: 'recorded' }); }) },
      proofMediaUploadService: createMockProofMediaUploadService(),
      queue,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
    });
    expirations.shift()?.();
    const timedOut = await firstPass;
    assert.equal(timedOut.failed, 1);
    assert.equal(timedOut.retried, 1);
    assert.equal(queue.listPending()[0]?.firstErrorCode, 'OPERATION_TIMEOUT');
    assert.equal(queue.listPending()[0]?.journal.at(-1)?.code, 'OPERATION_TIMEOUT');
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:south-head', 'driver-event:south-next',
    ]);

    resolveHung();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending().length, 2);

    const replayOrder: string[] = [];
    const recovered = await retryOfflineSubmissions({
      driverEventService: { recordDriverEvent: async (event) => {
        replayOrder.push(event.clientEventId);
        return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
      } },
      proofMediaUploadService: createMockProofMediaUploadService(),
      queue,
    });
    assert.equal(recovered.succeeded, 2);
    assert.deepEqual(replayOrder, ['south-head', 'south-next']);
    assert.equal(queue.listPending().length, 0);
  });

  it('times out hung proof upload without false ACK and ignores a late media result', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'oshawa-1', fileName: 'proof.jpg', routePlanId: 'route-oshawa',
      source: 'camera', uri: 'file:///proof.jpg',
    });
    const expirations: (() => void)[] = [];
    let resolveHung!: () => void;
    const retry = retryOfflineSubmissions({
      attemptTimeoutMs: 100,
      cancelAttemptTimeout: () => undefined,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: (request) => new Promise((resolve) => { resolveHung = () => resolve({
        contentType: 'image/jpeg', kind: 'photo', mediaId: 'late', source: request.source,
        storageKey: 'late/proof.jpg', uploadedAt: '2026-08-22T12:00:00.000Z',
      }); }) },
      queue,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
    });
    expirations.shift()?.();
    assert.equal((await retry).failed, 1);
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
    resolveHung();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending().length, 1);
  });

  it('handles an abort-ignoring late proof rejection without an unhandled rejection or state mutation', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'late-reject-stop', fileName: 'proof.jpg', routePlanId: 'late-reject-route',
      source: 'camera', uri: 'file:///proof.jpg',
    });
    const expirations: (() => void)[] = [];
    const unhandled: unknown[] = [];
    let rejectLate!: (error: Error) => void;
    let attemptSignal: AbortSignal | undefined;
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const retry = retryOfflineSubmissions({
        attemptTimeoutMs: 100,
        cancelAttemptTimeout: () => undefined,
        driverEventService: createMockDriverEventService(),
        proofMediaUploadService: {
          uploadProofMedia: (_request, options) => {
            attemptSignal = options?.signal;
            return new Promise((_resolve, reject) => { rejectLate = reject; });
          },
        },
        queue,
        scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
      });
      expirations.shift()?.();

      assert.equal((await retry).failed, 1);
      assert.equal(attemptSignal?.aborted, true);
      const stateAfterTimeout = JSON.stringify(queue.listPending());
      rejectLate(new Error('late transport rejection'));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(unhandled, []);
      assert.equal(JSON.stringify(queue.listPending()), stateAfterTimeout);
      assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('propagates the queue deadline through the live proof client and aborts its XHR', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'xhr-stop', fileName: 'proof.jpg', routePlanId: 'xhr-route',
      source: 'camera', uri: 'file:///proof.jpg',
    });
    const expirations: (() => void)[] = [];
    const headers: Record<string, string> = {};
    let abortCount = 0;
    class HungXMLHttpRequest {
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      responseText = '';
      status = 0;
      timeout = 0;
      abort() { abortCount += 1; this.onabort?.(); }
      open() {}
      send() {}
      setRequestHeader(name: string, value: string) { headers[name] = value; }
    }
    const retry = retryOfflineSubmissions({
      attemptTimeoutMs: 100,
      cancelAttemptTimeout: () => undefined,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: createProofMediaUploadApiClient({
        accessToken: 'driver-token', baseUrl: 'https://delivery.example.com',
        xmlHttpRequestFactory: () => new HungXMLHttpRequest() as unknown as XMLHttpRequest,
      }),
      queue,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
    });
    expirations.shift()?.();

    assert.equal((await retry).failed, 1);
    assert.equal(abortCount, 1);
    assert.match(headers['Idempotency-Key'] ?? '', /^proof-media-v1:[0-9a-f]{32}$/u);
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
  });

  it('keeps proof upload-in-progress retryable without treating HTTP 409 as a route end', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'in-progress-stop', fileName: 'proof.jpg', routePlanId: 'in-progress-route',
      source: 'camera', uri: 'file:///proof.jpg',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => {
          throw createDriverApiHttpError({
            code: 'PROOF_MEDIA_UPLOAD_IN_PROGRESS', endpoint: 'Proof media upload', status: 409,
          });
        },
      },
      queue,
    });

    const pending = queue.listPending()[0];
    assert.equal(result.failed, 1);
    assert.equal(result.blocked, undefined);
    assert.equal(result.reconciliationRoutePlanIds, undefined);
    assert.equal(pending?.state, 'PENDING');
    assert.equal(pending?.firstErrorCode, 'PROOF_MEDIA_UPLOAD_IN_PROGRESS');
    assert.equal(pending?.lastErrorCode, 'PROOF_MEDIA_UPLOAD_IN_PROGRESS');
    assert.deepEqual(getOfflineSubmissionQueueSummary(queue), {
      blockedCount: 0, reconciliationRoutePlanIds: [], retryableCount: 1, totalCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(pending), /ROUTE_NOT_IN_PROGRESS/u);
  });

  it('quarantines a proof idempotency conflict immediately with truthful blocked sync evidence', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'conflict-stop', fileName: 'proof.jpg', routePlanId: 'conflict-route',
      source: 'camera', uri: 'file:///proof.jpg',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => {
          throw createDriverApiHttpError({
            code: 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT', endpoint: 'Proof media upload', status: 409,
          });
        },
      },
      queue,
    });
    await queue.whenPersisted();

    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    const blocked = restarted.listPending()[0];
    assert.equal(result.failed, 0);
    assert.equal(result.blocked, 1);
    assert.equal(result.reconciliationRoutePlanIds, undefined);
    assert.equal(blocked?.state, 'QUARANTINED');
    assert.equal(blocked?.firstErrorCode, 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT');
    assert.equal(blocked?.lastErrorCode, 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT');
    assert.equal(blocked?.reconciliation?.reason, 'proof_idempotency_conflict');
    assert.deepEqual(getOfflineSubmissionQueueSummary(restarted), {
      blockedCount: 1,
      reconciliationRoutePlanIds: ['conflict-route'],
      retryableCount: 0,
      totalCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(blocked), /ROUTE_NOT_IN_PROGRESS/u);
  });

  it('retries a timeout with one idempotent server proof when transport ignores abort and settles late', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'oshawa-idempotent', fileName: 'proof.jpg', routePlanId: 'route-oshawa',
      source: 'camera', uri: 'file:///proof.jpg',
    });
    const expirations: (() => void)[] = [];
    const serverReservations = new Map<string, Promise<{
      contentType: string; kind: 'photo'; mediaId: string; source: 'camera'; storageKey: string; uploadedAt: string;
    }>>();
    let completeUpload!: () => void;
    let serverObjectCount = 0;
    let uploadCalls = 0;
    let firstSignal: AbortSignal | undefined;
    const uploadProofMedia = (_request: unknown, options?: { idempotencyKey?: string; signal?: AbortSignal }) => {
      uploadCalls += 1;
      firstSignal ??= options?.signal;
      const key = options?.idempotencyKey ?? '';
      const existing = serverReservations.get(key);
      if (existing !== undefined) return existing;
      const reserved = new Promise<{
        contentType: string; kind: 'photo'; mediaId: string; source: 'camera'; storageKey: string; uploadedAt: string;
      }>((resolve) => {
        completeUpload = () => {
          serverObjectCount += 1;
          resolve({
            contentType: 'image/jpeg', kind: 'photo', mediaId: 'one-server-reference', source: 'camera',
            storageKey: 'one/server/object.jpg', uploadedAt: '2026-08-22T12:00:00.000Z',
          });
        };
      });
      serverReservations.set(key, reserved);
      return reserved;
    };
    const firstRetry = retryOfflineSubmissions({
      attemptTimeoutMs: 100,
      cancelAttemptTimeout: () => undefined,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia },
      queue,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
    });
    expirations.shift()?.();

    assert.equal((await firstRetry).failed, 1);
    assert.equal(firstSignal?.aborted, true);
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');

    const immediateRetry = retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia },
      queue,
    });
    completeUpload();

    assert.equal((await immediateRetry).succeeded, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(uploadCalls, 2);
    assert.equal(serverReservations.size, 1);
    assert.equal(serverObjectCount, 1);
    assert.equal(queue.listPending().length, 0);
  });

  it('retains a bounded first-error record while updating the last retry error', async () => {
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
    assert.equal(queue.listPending()[0]?.firstErrorCode, 'NETWORK_UNAVAILABLE');
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'NETWORK_UNAVAILABLE');

    queue.recordRetryFailure(queue.listPending()[0]!.queueItemId, `later failure ${'x'.repeat(600)}`);
    assert.equal(queue.listPending()[0]?.attempts, 2);
    assert.equal(queue.listPending()[0]?.firstErrorCode, 'NETWORK_UNAVAILABLE');
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'RETRY_FAILED');
    assert.doesNotMatch(JSON.stringify(queue.listPending()[0]), /later failure|x{20}/u);
  });

  it('seals ordered evidence and removes location samples when the account changes', () => {
    const queue = createInMemoryOfflineSubmissionQueue({
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    });
    queue.enqueueDriverEvent({
      clientEventId: 'route-started',
      eventType: 'ROUTE_STARTED',
      occurredAt: new Date('2026-08-24T09:59:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-08-24T09:59:30.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'stop-1.jpg',
      routePlanId: 'route-1',
      source: 'camera',
      uri: 'file:///proof/stop-1.jpg',
    });

    assert.deepEqual(queue.sealForAccountChange(), {
      discardedLocations: 1,
      sealed: 2,
    });
    assert.equal(queue.listPending().length, 2);
    assert.equal(queue.listPending().every((item) => item.reconciliation?.reason === 'account_signed_out'), true);
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
      routeLookupReason: 'driver_access_expired',
      succeeded: 0,
    });
    assert.equal(queue.listPending()[0]?.attempts, 1);
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'AUTH_EXPIRED');
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
    assert.equal(queue.discardReconciliationRecords(), 0);
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

  it('hydrates queued pickup completion events from durable storage', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: JSON.stringify({
        items: [
          {
            attempts: 0,
            enqueuedAt: '2026-05-12T11:00:00.000Z',
            event: {
              clientEventId: 'pickup-completed-1',
              eventType: 'PICKUP_COMPLETED',
              occurredAt: '2026-05-12T11:01:00.000Z',
              routePlanId: 'route-1',
            },
            kind: 'driver_event',
            queueItemId: 'driver-event:pickup-completed-1',
          },
        ],
        version: 1,
      }),
    });

    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const pending = queue.listPending();

    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.kind === 'driver_event' ? pending[0].event.eventType : null, 'PICKUP_COMPLETED');
  });

  it('requests route lookup after a queued pickup completion sync succeeds', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'pickup-completed-1',
      eventType: 'PICKUP_COMPLETED',
      occurredAt: new Date('2026-05-12T11:01:00.000Z'),
      routePlanId: 'route-1',
    });

    const result = await retryOfflineSubmissions({
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('unexpected proof upload'); },
      },
      queue,
      routePlanId: 'route-1',
    });

    assert.deepEqual(result, {
      discarded: 0,
      failed: 0,
      requiresRouteLookup: true,
      retried: 1,
      routeLookupReason: 'pickup_eta_snapshot_synced',
      succeeded: 1,
    });
    assert.equal(queue.listPending().length, 0);
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

    const stored = JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { journal: { kind: string }[]; state: string }[];
    };
    assert.equal(stored.items[0]?.state, 'DISCARDED');
    assert.equal(stored.items[0]?.journal.at(-1)?.kind, 'DISCARD');
    assert.deepEqual(storage.removedKeys, []);
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
      items: { attempts: number; kind: string; lastErrorCode?: string; queueItemId: string; state: string }[];
    };
    assert.deepEqual(stored.items.map((item) => ({
      attempts: item.attempts,
      kind: item.kind,
      lastErrorCode: item.lastErrorCode,
      queueItemId: item.queueItemId,
      state: item.state,
    })), [
      {
        attempts: 0,
        kind: 'driver_event',
        lastErrorCode: undefined,
        queueItemId: 'driver-event:event-1',
        state: 'ACKNOWLEDGED',
      },
      {
        attempts: 1,
        kind: 'proof_media',
        lastErrorCode: 'NETWORK_UNAVAILABLE',
        queueItemId: 'proof-media:route-1:stop-1:stop-1.jpg',
        state: 'PENDING',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(stored), /still offline/u);
  });

  it('fails closed on malformed durable rows without deleting corrupt evidence', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: '{"version":1,"items":[{"kind":"driver_event"}]}',
    });

    await assert.rejects(createPersistentOfflineSubmissionQueue({ storage }), /STORAGE_DEGRADED/u);
    assert.deepEqual(storage.removedKeys, []);
    assert.match(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '', /driver_event/u);
  });

  it('serializes durable writes so older persistence cannot overwrite newer queue state', async () => {
    const values = new Map<string, string>();
    let releaseFirstWrite: (() => void) | null = null;
    let writeCount = 0;
    const storage: OfflineSubmissionQueueStorage = {
      getItem: async (key) => values.get(key) ?? null,
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

    const stored = JSON.parse(values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { state: string }[];
    };
    assert.equal(stored.items[0]?.state, 'DISCARDED');
  });

  it('enters a read-only storage-degraded gate until the latest snapshot is recovered', async () => {
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
    assert.equal(queue.storageState(), 'STORAGE_DEGRADED');

    assert.throws(() => queue.enqueueDriverEvent({
      clientEventId: 'second',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T09:01:00.000Z'),
      routePlanId: 'route-1',
    }), /STORAGE_DEGRADED/u);
    assert.equal(await queue.recoverStorage(), true);
    assert.equal(queue.storageState(), 'READY');
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

  it('does not leave storage-degraded until the written snapshot passes a public reread', async () => {
    let persisted: string | null = null;
    let returnCorruptReread = false;
    const storage: OfflineSubmissionQueueStorage = {
      getItem: async () => returnCorruptReread ? '{"invalid":true}' : persisted,
      removeItem: async () => undefined,
      setItem: async (_key, value) => { persisted = value; },
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    returnCorruptReread = true;
    queue.enqueueDriverEvent({
      clientEventId: 'verify-reread',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T12:00:00.000Z'),
      routePlanId: 'route-1',
    });

    await assert.rejects(queue.whenPersisted(), /persistence verification failed/u);
    assert.equal(queue.storageState(), 'STORAGE_DEGRADED');
    assert.equal(await queue.recoverStorage(), false);
    assert.equal(queue.storageState(), 'STORAGE_DEGRADED');

    returnCorruptReread = false;
    assert.equal(await queue.recoverStorage(), true);
    assert.equal(queue.storageState(), 'READY');
    assert.match(persisted ?? '', /verify-reread/u);
  });

  it('fails closed without deleting an invalid persisted root envelope', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]: JSON.stringify({ items: 'invalid', version: 2 }),
    });

    await assert.rejects(
      createPersistentOfflineSubmissionQueue({ storage }),
      /STORAGE_DEGRADED/u,
    );
    assert.deepEqual(storage.removedKeys, []);
    assert.match(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '', /invalid/u);
  });

  it('quarantines expired ordered evidence before retrying fresh work', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({
      initialItems: [
        {
          accountOwnerHash: 'test-account-owner',
          attempts: 0,
          enqueuedAt: '2026-05-09T10:59:59.999Z',
          event: {
            clientEventId: 'old-event',
            eventType: 'STOP_DELIVERED',
            occurredAt: new Date('2026-05-09T10:59:59.999Z'),
            routePlanId: 'route-1',
          },
          journal: [{ at: '2026-05-09T10:59:59.999Z', code: 'ENQUEUED', kind: 'ENQUEUED' }],
          kind: 'driver_event',
          queueSequence: 1,
          queueItemId: 'driver-event:old-event',
          state: 'PENDING',
        },
        {
          accountOwnerHash: 'test-account-owner',
          attempts: 0,
          enqueuedAt: '2026-05-12T10:00:00.000Z',
          event: {
            clientEventId: 'fresh-event',
            eventType: 'STOP_DELIVERED',
            occurredAt: new Date('2026-05-12T10:00:00.000Z'),
            routePlanId: 'route-1',
          },
          journal: [{ at: '2026-05-12T10:00:00.000Z', code: 'ENQUEUED', kind: 'ENQUEUED' }],
          kind: 'driver_event',
          queueSequence: 2,
          queueItemId: 'driver-event:fresh-event',
          state: 'PENDING',
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
      blocked: 1,
      discarded: 0,
      failed: 0,
      retried: 1,
      succeeded: 0,
    });
    assert.deepEqual(recordedEventIds, []);
    assert.equal(queue.listPending().length, 2);
    assert.equal(queue.listPending()[0]?.reconciliation?.reason, 'retry_policy_exceeded');
    assert.equal(OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY.maxAgeMs, 72 * 60 * 60 * 1000);
  });

  it('quarantines sensitive evidence after the maximum retained retry attempts', async () => {
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
      blocked: 1,
      discarded: 0,
      failed: 0,
      retried: 1,
      succeeded: 0,
    });
    assert.equal(queue.listPending()[0]?.reconciliation?.reason, 'retry_policy_exceeded');
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

  it('supports explicit operator purge and persists it', async () => {
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
    const stored = JSON.parse(storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { state: string }[];
    };
    assert.deepEqual(stored.items.map((item) => item.state), ['DISCARDED', 'DISCARDED']);
    assert.deepEqual(storage.removedKeys, []);
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
      'driver-event:old-location',
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

    assert.deepEqual(result, {
      completionAcknowledgedRoutePlanIds: ['route-1'],
      discarded: 1,
      failed: 0,
      retried: 1,
      succeeded: 1,
    });
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'proof-media:route-1:stop-1:proof.jpg',
    ]);
  });

  it('keeps a quarantined ordered head as the route HOL blocker across restart until reconciliation ACK', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    queue.enqueueDriverEvent({
      clientEventId: 'ordered-head',
      eventType: 'STOP_ARRIVED',
      occurredAt: new Date('2026-08-24T10:00:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.enqueueDriverEvent({
      clientEventId: 'ordered-later',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T10:01:00.000Z'),
      routePlanId: 'route-1',
    });
    queue.quarantine('driver-event:ordered-head', 'route_not_in_progress');
    await queue.whenPersisted();

    const restored = await createPersistentOfflineSubmissionQueue({ storage });
    const recorded: string[] = [];
    const blocked = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async (event) => {
          recorded.push(event.clientEventId);
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected upload'); } },
      queue: restored,
      routePlanId: 'route-1',
    });
    assert.deepEqual(blocked, { discarded: 0, failed: 0, retried: 0, succeeded: 0 });
    assert.deepEqual(recorded.slice(), []);

    assert.equal(restored.discardReconciliationRecords(), 1);
    const reconciled = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async (event) => {
          recorded.push(event.clientEventId);
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected upload'); } },
      queue: restored,
      routePlanId: 'route-1',
    });
    assert.deepEqual(reconciled, { discarded: 0, failed: 0, retried: 1, succeeded: 1 });
    assert.deepEqual(recorded, ['ordered-later']);
  });

  it('persists a monotonic queue sequence and never derives replay order from ids or timestamps', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const first = queue.enqueueDriverEvent({
      clientEventId: 'z-last-lexically',
      eventType: 'STOP_ARRIVED',
      occurredAt: new Date('2026-08-24T12:00:00.000Z'),
      routePlanId: 'route-1',
    });
    const second = queue.enqueueDriverEvent({
      clientEventId: 'a-first-lexically',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    assert.equal(second.queueSequence, first.queueSequence + 1);
    await queue.whenPersisted();

    const restored = await createPersistentOfflineSubmissionQueue({ storage });
    assert.deepEqual(restored.listPending().map((item) => item.queueItemId), [
      'driver-event:z-last-lexically',
      'driver-event:a-first-lexically',
    ]);
    const third = restored.enqueueDriverEvent({
      clientEventId: 'middle-after-restart',
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-08-23T09:00:00.000Z'),
      routePlanId: 'route-1',
    });
    assert.equal(third.queueSequence, second.queueSequence + 1);
  });

  it('isolates evidence mutations and replay by account owner hash', async () => {
    const ownerA = 'aa'.repeat(32);
    const ownerB = 'bb'.repeat(32);
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: null, storage });
    queue.bindAccountOwnerHash(ownerA);
    queue.enqueueDriverEvent({
      clientEventId: 'same-client-id',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T10:00:00.000Z'),
      routePlanId: 'route-a',
    });
    queue.sealForAccountChange();

    queue.bindAccountOwnerHash(ownerB);
    assert.deepEqual(queue.listPending(), []);
    queue.enqueueDriverEvent({
      clientEventId: 'same-client-id',
      eventType: 'STOP_FAILED',
      occurredAt: new Date('2026-08-24T11:00:00.000Z'),
      routePlanId: 'route-b',
    });
    assert.equal(queue.clear(), 1);
    assert.deepEqual(queue.listPending(), []);

    queue.bindAccountOwnerHash(ownerA);
    assert.deepEqual(queue.listPending().map((item) => ({
      owner: item.accountOwnerHash,
      routePlanId: item.kind === 'driver_event' ? item.event.routePlanId : null,
      state: item.state,
    })), [{ owner: ownerA, routePlanId: 'route-a', state: 'QUARANTINED' }]);
  });

  it('retains ACK and bounded stable-code attempt history without raw errors', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const item = queue.enqueueDriverEvent({
      clientEventId: 'journal-event',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T10:00:00.000Z'),
      routePlanId: 'route-1',
    });
    for (let attempt = 0; attempt < 70; attempt += 1) {
      queue.recordRetryFailure(item.queueItemId, `network secret recipient ${attempt}`);
    }
    queue.acknowledge(item.queueItemId);
    await queue.whenPersisted();

    const raw = storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '';
    const stored = JSON.parse(raw) as { items: { journal: unknown[]; lastErrorCode?: string; state: string }[] };
    assert.equal(stored.items[0]?.state, 'ACKNOWLEDGED');
    assert.equal(stored.items[0]?.lastErrorCode, 'NETWORK_UNAVAILABLE');
    assert.equal(stored.items[0]?.journal.length, 64);
    assert.doesNotMatch(raw, /secret recipient/u);
  });

  it('handles only the active account evidence after the server accepts account deletion', async () => {
    const ownerA = '12'.repeat(32);
    const ownerB = '34'.repeat(32);
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: null, storage });
    queue.bindAccountOwnerHash(ownerA);
    const acknowledged = queue.enqueueDriverEvent({
      clientEventId: 'owner-a-ack',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-24T10:00:00.000Z'),
      routePlanId: 'route-a',
    });
    queue.acknowledge(acknowledged.queueItemId);
    queue.bindAccountOwnerHash(ownerB);
    queue.enqueueDriverEvent({
      clientEventId: 'owner-b-pending',
      eventType: 'STOP_FAILED',
      occurredAt: new Date('2026-08-24T11:00:00.000Z'),
      routePlanId: 'route-b',
    });

    queue.bindAccountOwnerHash(ownerA);
    assert.equal(queue.completeAccountDeletionAfterServerAudit(), 1);
    await queue.whenPersisted();
    queue.bindAccountOwnerHash(ownerB);
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), ['driver-event:owner-b-pending']);
    const raw = storage.values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '';
    assert.match(raw, /ACCOUNT_DELETION_SERVER_AUDITED/u);
  });

  it('recovers Kitchener completion after restart from the account-token APPLIED receipt without replay', async () => {
    const storage = createMemoryStorage();
    const first = await createPersistentOfflineSubmissionQueue({ storage });
    first.enqueueDriverEvent({
      appVersion: '1.2.0',
      assignmentGeneration: '7',
      clientEventId: '01K37KITCHENERCOMPLETE',
      deliveryStopId: null,
      driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'),
      routePlanId: '11111111-1111-4111-8111-111111111111',
      versionCode: 120,
    });
    await first.whenPersisted();

    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    let replayed = 0;
    const result = await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: '7',
        clientEventId: '01K37KITCHENERCOMPLETE',
        errorCode: null,
        expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
        routePlanId: '11111111-1111-4111-8111-111111111111',
        routeStatus: 'COMPLETED',
        status: 'APPLIED',
      }) },
      driverEventService: { recordDriverEvent: async () => { replayed += 1; throw new Error('must not replay'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue: restarted,
    });

    assert.equal(replayed, 0);
    assert.deepEqual(result.completionAcknowledgedRoutePlanIds, ['11111111-1111-4111-8111-111111111111']);
    assert.deepEqual(restarted.listPending(), []);
  });

  it('preserves completion recovery telemetry across restart and acknowledgement within five minutes', async () => {
    const storage = createMemoryStorage();
    let currentTime = new Date('2026-08-22T19:42:10.000Z');
    const first = await createPersistentOfflineSubmissionQueue({
      now: () => currentTime,
      storage,
    });
    const completion = first.enqueueDriverEvent({
      appVersion: '1.2.0',
      assignmentGeneration: '11',
      clientEventId: 'kitchener-completion-telemetry',
      driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: currentTime,
      routePlanId: 'route-kitchener',
      versionCode: 18,
    });
    await first.whenPersisted();

    const restartedPending = await createPersistentOfflineSubmissionQueue({
      now: () => currentTime,
      storage,
    });
    assert.deepEqual(restartedPending.getRouteCompletionTelemetry('route-kitchener'), {
      finishPending: true,
      lastAcknowledgedAt: null,
      locallyFinished: true,
    });

    currentTime = new Date('2026-08-22T19:46:59.000Z');
    assert.equal(restartedPending.acknowledge(completion.queueItemId), true);
    await restartedPending.whenPersisted();
    const restartedAcknowledged = await createPersistentOfflineSubmissionQueue({
      now: () => currentTime,
      storage,
    });
    const telemetry = restartedAcknowledged.getRouteCompletionTelemetry('route-kitchener');
    assert.deepEqual(telemetry, {
      finishPending: false,
      lastAcknowledgedAt: '2026-08-22T19:46:59.000Z',
      locallyFinished: true,
    });
    assert.ok(Date.parse(telemetry.lastAcknowledgedAt!) - Date.parse(completion.enqueuedAt) <= 5 * 60 * 1000);
  });

  it('persists the account-scoped ACK-clear heartbeat outbox until delivery is recorded', async () => {
    const storage = createMemoryStorage();
    const ownerA = 'a'.repeat(64);
    const ownerB = 'b'.repeat(64);
    const routePlanId = 'route-kitchener';
    const first = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: ownerA, storage });
    const completion = first.enqueueDriverEvent({
      assignmentGeneration: '11', clientEventId: 'completion-clear-outbox', driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId,
    });
    first.acknowledge(completion.queueItemId);
    await first.whenPersisted();

    const restarted = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: ownerA, storage });
    assert.deepEqual(restarted.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
    assert.deepEqual(restarted.listPendingCompletionClearEntries(), [{
      accountOwnerHash: ownerA, assignmentGeneration: '11',
      completionClientEventId: 'completion-clear-outbox', driverContractVersion: 2, routePlanId,
    }]);
    restarted.bindAccountOwnerHash(ownerB);
    assert.deepEqual(restarted.listPendingCompletionClearRoutePlanIds(), []);
    restarted.bindAccountOwnerHash(ownerA);
    const outboxEntry = restarted.listPendingCompletionClearEntries()[0]!;
    assert.equal(restarted.markCompletionClearHeartbeatDelivered(outboxEntry), true);
    await restarted.whenPersisted();

    const delivered = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: ownerA, storage });
    assert.deepEqual(delivered.listPendingCompletionClearRoutePlanIds(), []);
    assert.equal(delivered.markCompletionClearHeartbeatDelivered(outboxEntry), false);
  });

  it('closes only the exact account, assignment, and completion identity on a reused route id', () => {
    const owner = 'a'.repeat(64);
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    for (const [assignmentGeneration, clientEventId] of [['11', 'completion-gen-11'], ['12', 'completion-gen-12']]) {
      const item = queue.enqueueDriverEvent({
        assignmentGeneration, clientEventId, driverContractVersion: 2,
        eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId: 'reused-route',
      });
      queue.acknowledge(item.queueItemId);
    }
    const [generation11, generation12] = queue.listPendingCompletionClearEntries();
    assert.equal(queue.markCompletionClearHeartbeatDelivered(generation11!), true);
    assert.deepEqual(queue.listPendingCompletionClearEntries(), [generation12]);
    assert.equal(queue.reopenCompletionClearHeartbeat(generation11!), true);
    assert.deepEqual(queue.listPendingCompletionClearEntries(), [generation11, generation12]);
  });

  it('retains an unsent acknowledged completion beyond 30 days and starts retention at delivery', async () => {
    const storage = createMemoryStorage();
    let currentTime = new Date('2026-06-01T00:00:00.000Z');
    const first = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage });
    const completion = first.enqueueDriverEvent({
      assignmentGeneration: '11', clientEventId: 'long-lived-clear-outbox', driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED', occurredAt: currentTime, routePlanId: 'route-retained',
    });
    first.acknowledge(completion.queueItemId);
    await first.whenPersisted();

    currentTime = new Date('2026-07-05T00:00:00.000Z');
    const unsentRestart = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage });
    const [outboxEntry] = unsentRestart.listPendingCompletionClearEntries();
    assert.equal(outboxEntry?.completionClientEventId, 'long-lived-clear-outbox');
    assert.equal(unsentRestart.markCompletionClearHeartbeatDelivered(outboxEntry!), true);
    await unsentRestart.whenPersisted();

    currentTime = new Date('2026-08-03T23:59:59.000Z');
    const beforeDeliveredRetention = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage });
    assert.equal(beforeDeliveredRetention.getRouteCompletionTelemetry('route-retained').locallyFinished, true);
    currentTime = new Date('2026-08-05T00:00:01.000Z');
    const afterDeliveredRetention = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage });
    assert.equal(afterDeliveredRetention.getRouteCompletionTelemetry('route-retained').locallyFinished, false);
  });

  it('does not report a completion clear without durable completion evidence', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'route-released-only',
      eventType: 'ROUTE_PAUSED',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'),
      routePlanId: 'route-kitchener',
    });

    assert.deepEqual(queue.getRouteCompletionTelemetry('route-kitchener'), {
      finishPending: false,
      lastAcknowledgedAt: null,
      locallyFinished: false,
    });
    assert.deepEqual(queue.getRouteCompletionTelemetry('route-without-session'), {
      finishPending: false,
      lastAcknowledgedAt: null,
      locallyFinished: false,
    });
  });

  it('does not project an operator reconciliation clear as a server acknowledgement', () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'completion-reconciliation-clear',
      eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'),
      routePlanId: 'route-kitchener',
    });
    queue.blockRouteSubmissionsForReconciliation('route-kitchener');
    assert.equal(queue.discardReconciliationRecords(), 1);

    assert.deepEqual(queue.getRouteCompletionTelemetry('route-kitchener'), {
      finishPending: true,
      lastAcknowledgedAt: null,
      locallyFinished: true,
    });
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), []);
  });

  it('isolates same-route completion acknowledgement telemetry by account owner', () => {
    const ownerA = 'a'.repeat(64);
    const ownerB = 'b'.repeat(64);
    const queue = createInMemoryOfflineSubmissionQueue({
      accountOwnerHash: ownerA,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });
    const ownerACompletion = queue.enqueueDriverEvent({
      clientEventId: 'owner-a-completion', eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'shared-route-id',
    });
    queue.acknowledge(ownerACompletion.queueItemId);
    queue.bindAccountOwnerHash(ownerB);
    queue.enqueueDriverEvent({
      clientEventId: 'owner-b-completion', eventType: 'ROUTE_COMPLETED',
      occurredAt: new Date('2026-08-22T19:43:10.000Z'), routePlanId: 'shared-route-id',
    });

    assert.deepEqual(queue.getRouteCompletionTelemetry('shared-route-id'), {
      finishPending: true, lastAcknowledgedAt: null, locallyFinished: true,
    });
    queue.bindAccountOwnerHash(ownerA);
    assert.equal(queue.getRouteCompletionTelemetry('shared-route-id').finishPending, false);
    assert.equal(queue.getRouteCompletionTelemetry('shared-route-id').lastAcknowledgedAt, '2026-08-25T00:00:00.000Z');
  });

  it('recovers an APPLIED completion receipt before assigned-route restoration is available', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    queue.enqueueDriverEvent({
      appVersion: '1.1.6',
      assignmentGeneration: '11',
      clientEventId: 'kitchener-complete-before-route-load',
      driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'),
      routePlanId: 'route-kitchener',
      versionCode: 116,
    });
    await queue.whenPersisted();

    const result = await recoverPendingRouteEndReceipt({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: '11',
        clientEventId: 'kitchener-complete-before-route-load',
        errorCode: null,
        expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
        routePlanId: 'route-kitchener',
        routeStatus: 'COMPLETED',
        status: 'APPLIED',
      }) },
      queue,
      routePlanId: 'route-kitchener',
    });
    await queue.whenPersisted();

    assert.equal(result, 'acknowledged');
    assert.equal(getPendingRouteEnd(queue, 'route-kitchener'), null);
    assert.equal((await createPersistentOfflineSubmissionQueue({ storage })).listPending().length, 0);
  });

  it('keeps completion pending and handles a late receipt rejection after timeout', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const routePlanId = 'route-late-receipt-reject';
    queue.enqueueDriverEvent({
      appVersion: '1.1.6', assignmentGeneration: '11', clientEventId: 'late-receipt-reject',
      driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId, versionCode: 116,
    });
    const expirations: (() => void)[] = [];
    let rejectLate!: (error: Error) => void;
    const recovery = recoverPendingRouteEndReceipt({
      attemptTimeoutMs: 100,
      cancelAttemptTimeout: () => undefined,
      driverEventReceiptService: {
        lookupReceipt: () => new Promise((_resolve, reject) => { rejectLate = reject; }),
      },
      queue,
      routePlanId,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
    });
    expirations.shift()?.();

    assert.equal(await recovery, 'pending');
    assert.equal(queue.listPending()[0]?.firstErrorCode, 'OPERATION_TIMEOUT');
    assert.equal(queue.listPending()[0]?.journal.at(-1)?.code, 'OPERATION_TIMEOUT');
    rejectLate(new Error('late private transport failure'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending().length, 1);
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
    assert.doesNotMatch(JSON.stringify(queue.listPending()[0]?.journal), /private transport/u);
  });

  it('replays completion only for UNKNOWN plus IN_PROGRESS and quarantines a terminal South route', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const event = queue.enqueueDriverEvent({
      assignmentGeneration: '7', clientEventId: 'south-complete', driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED', expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T20:00:00.000Z'), routePlanId: 'south-route',
    }).event;
    let routeStatus = 'IN_PROGRESS';
    let replayed = 0;
    const retry = () => retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: '7', clientEventId: event.clientEventId, errorCode: null,
        expectedRouteVersionId: event.expectedRouteVersionId ?? null, routePlanId: 'south-route',
        routeStatus, status: 'UNKNOWN',
      }) },
      driverEventService: { recordDriverEvent: async () => { replayed += 1; throw new Error('network offline'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue,
    });
    await retry();
    assert.equal(replayed, 1);
    routeStatus = 'COMPLETED';
    const reconciled = await retry();
    assert.deepEqual(reconciled.reconciliationRoutePlanIds, ['south-route']);
    assert.equal(queue.listPending()[0]?.state, 'QUARANTINED');
  });

  it('quarantines a persisted UNKNOWN completion instead of using reassigned route access', async () => {
    const storage = createMemoryStorage();
    const first = await createPersistentOfflineSubmissionQueue({ storage });
    first.enqueueDriverEvent({
      appVersion: '1.1.6', assignmentGeneration: '11', clientEventId: 'persisted-generation-11',
      driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId: 'reassigned-route', versionCode: 17,
    });
    await first.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    let networkCalls = 0;
    const result = await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => {
        networkCalls += 1;
        return {
          assignmentGeneration: '11', clientEventId: 'persisted-generation-11', errorCode: null,
          expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', routePlanId: 'reassigned-route',
          routeStatus: 'IN_PROGRESS', status: 'UNKNOWN',
        };
      } },
      driverEventService: createDriverEventsApiClient({
        accessToken: 'generation-12-route-token', baseUrl: 'https://delivery.example.com',
        orderedEventContract: {
          appVersion: '1.2.0', assignmentGeneration: '12', driverContractVersion: 2,
          expectedRouteVersionId: '33333333-3333-4333-8333-333333333333', versionCode: 18,
        },
        fetchImpl: async () => {
          networkCalls += 1;
          return { json: async () => ({ data: { duplicate: false, eventId: 'persisted-generation-11' }, error: null }), ok: true, status: 202 };
        },
      }),
      orderedEventAccessIdentity: {
        assignmentGeneration: '12', driverContractVersion: 2,
        expectedRouteVersionId: '33333333-3333-4333-8333-333333333333', routePlanId: 'reassigned-route',
      },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue: restarted,
    });

    assert.equal(networkCalls, 0);
    assert.equal(result.succeeded, 0);
    assert.equal(result.blocked, 1);
    assert.equal(result.reconciliationRoutePlanIds, undefined);
    assert.equal(restarted.listPending()[0]?.state, 'QUARANTINED');
    assert.equal(restarted.listPending()[0]?.reconciliation?.reason, 'assignment_changed');
  });

  it('aborts an account-A ordinary retry without mutating its queue after account-B login', async () => {
    const ownerA = 'a'.repeat(64);
    const ownerB = 'b'.repeat(64);
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: ownerA });
    queue.enqueueDriverEvent({
      clientEventId: 'account-a-stop', eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-08-22T19:40:00.000Z'), routePlanId: 'shared-route',
    });
    const lifecycle = new AbortController();
    let accountEpoch = 1;
    let transportSignal: AbortSignal | undefined;
    let resolveLate!: () => void;
    const retry = retryOfflineSubmissions({
      driverEventService: { recordDriverEvent: (_event, options) => {
        transportSignal = options?.signal;
        return new Promise((resolve) => {
          resolveLate = () => resolve({ duplicate: false, eventId: 'late-account-a', status: 'recorded' });
        });
      } },
      isCurrent: () => accountEpoch === 1 && queue.getAccountOwnerHash() === ownerA,
      lifecycleSignal: lifecycle.signal,
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue,
    });
    await new Promise((resolve) => setImmediate(resolve));
    queue.bindAccountOwnerHash(ownerB);
    accountEpoch = 2;
    lifecycle.abort();
    assert.equal(transportSignal?.aborted, true);
    assert.equal((await retry).succeeded, 0);
    resolveLate();
    await new Promise((resolve) => setImmediate(resolve));
    queue.bindAccountOwnerHash(ownerA);
    const [accountAItem] = queue.listPending();
    assert.equal(accountAItem?.state, 'PENDING');
    assert.equal(accountAItem?.attempts, 0);
  });

  it('aborts an account-A receipt retry without acknowledging or reconciling after account-B login', async () => {
    const ownerA = 'a'.repeat(64);
    const ownerB = 'b'.repeat(64);
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: ownerA });
    queue.enqueueDriverEvent({
      assignmentGeneration: '11', clientEventId: 'account-a-completion', driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED', expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:00.000Z'), routePlanId: 'shared-route',
    });
    const lifecycle = new AbortController();
    let accountEpoch = 1;
    let receiptSignal: AbortSignal | undefined;
    let resolveLate!: () => void;
    const recovery = recoverPendingRouteEndReceipt({
      driverEventReceiptService: { lookupReceipt: (_request, options) => {
        receiptSignal = options?.signal;
        return new Promise((resolve) => {
          resolveLate = () => resolve({
            assignmentGeneration: '11', clientEventId: 'account-a-completion', errorCode: null,
            expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', routePlanId: 'shared-route',
            routeStatus: 'COMPLETED', status: 'APPLIED',
          });
        });
      } },
      isCurrent: () => accountEpoch === 1 && queue.getAccountOwnerHash() === ownerA,
      lifecycleSignal: lifecycle.signal,
      queue,
      routePlanId: 'shared-route',
    });
    await new Promise((resolve) => setImmediate(resolve));
    queue.bindAccountOwnerHash(ownerB);
    accountEpoch = 2;
    lifecycle.abort();
    await assert.rejects(recovery, /OPERATION_ABORTED/u);
    assert.equal(receiptSignal?.aborted, true);
    resolveLate();
    await new Promise((resolve) => setImmediate(resolve));
    queue.bindAccountOwnerHash(ownerA);
    assert.equal(queue.listPending()[0]?.state, 'PENDING');
    assert.deepEqual(queue.listPendingCompletionClearEntries(), []);
  });

  it('recovers a queued route release receipt and clears reduced monitoring state without replay', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      assignmentGeneration: '8', clientEventId: 'release-lost-response', driverContractVersion: 2,
      eventType: 'ROUTE_PAUSED', expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T20:10:00.000Z'), routePlanId: 'south-route',
    });
    let replayed = false;
    const result = await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: '8', clientEventId: 'release-lost-response', errorCode: null,
        expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', routePlanId: 'south-route',
        routeStatus: 'READY', status: 'APPLIED',
      }) },
      driverEventService: { recordDriverEvent: async () => { replayed = true; throw new Error('must not replay'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue,
    });
    assert.equal(replayed, false);
    assert.deepEqual(result.completionAcknowledgedRoutePlanIds, ['south-route']);
    assert.deepEqual(queue.listPending(), []);
  });
});
