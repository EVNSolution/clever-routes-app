import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createMockDriverEventService } from '../events/driverEvents';
import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  createRouteOrderedDriverEventService,
  retryOfflineSubmissions,
  type OfflineSubmissionQueueStorage,
} from '../offline/offlineSubmissionQueue';
import { recordStopProofEventAfterDeliveryStart } from './stopProofEvents';

const activeDelivery = {
  flowState: 'delivery_active',
  kind: 'delivery_active',
  locationPermission: 'foreground',
  message: 'active',
} as const;

function createMemoryStorage(): OfflineSubmissionQueueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    removeItem: async (key) => { values.delete(key); },
    setItem: async (key, value) => { values.set(key, value); },
    values,
  };
}

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
          source: 'clever-routes-app',
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
        source: 'clever-routes-app',
        type: 'FAILED_REASON',
      },
    });
  });

  it('records an administrator assignment error when a pickup stop is skipped', async () => {
    const driverEventService = createMockDriverEventService();

    await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService,
      input: {
        action: 'failed',
        deliveryStopId: 'stop-pickup',
        note: 'Pickup order was incorrectly included in the delivery route.',
        reason: 'ADMIN_ROUTE_ASSIGNMENT_ERROR',
        routePlanId: 'route-1',
      },
    });

    assert.equal(driverEventService.recordedEvents[0]?.eventType, 'STOP_FAILED');
    assert.deepEqual(driverEventService.recordedEvents[0]?.payload, {
      proof: {
        note: 'Pickup order was incorrectly included in the delivery route.',
        reason: 'ADMIN_ROUTE_ASSIGNMENT_ERROR',
        source: 'clever-routes-app',
        type: 'FAILED_REASON',
      },
    });
  });

  it('records uploaded media and signature proof references after delivery_active', async () => {
    const driverEventService = createMockDriverEventService();

    await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService,
      input: {
        action: 'delivered',
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
        source: 'clever-routes-app',
        type: 'DELIVERED_NOTE',
      },
    });
  });

  it('queues stop proof driver event when the live event submission fails', async () => {
    const memoryQueue = createInMemoryOfflineSubmissionQueue();
    const orderedEventContract = {
      appVersion: '1.2.3',
      assignmentGeneration: '14',
      driverContractVersion: 2 as const,
      expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
      versionCode: 21,
    };
    let releasePersistence: () => void = () => undefined;
    let persistenceStarted = false;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const queue = {
      ...memoryQueue,
      whenPersisted: async () => {
        persistenceStarted = true;
        await persistenceGate;
      },
    };

    let proofResolved = false;
    const resultPromise = recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        prepareDriverEvent: (event) => ({ ...event, ...orderedEventContract }),
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
    }).then((result) => {
      proofResolved = true;
      return result;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(persistenceStarted, true);
    assert.equal(proofResolved, false);
    releasePersistence();
    const result = await resultPromise;

    assert.equal(result.kind, 'queued');
    assert.equal(result.reason, 'record_failed');
    assert.equal(queue.listPending().length, 1);
    assert.equal(queue.listPending()[0]?.kind, 'driver_event');
    const pending = queue.listPending()[0];
    assert.deepEqual(pending?.kind === 'driver_event' ? {
      appVersion: pending.event.appVersion,
      assignmentGeneration: pending.event.assignmentGeneration,
      driverContractVersion: pending.event.driverContractVersion,
      eventType: pending.event.eventType,
      expectedRouteVersionId: pending.event.expectedRouteVersionId,
      versionCode: pending.event.versionCode,
    } : null, {
      ...orderedEventContract,
      eventType: 'STOP_DELIVERED',
    });
  });

  it('durably persists STOP_DELIVERED before waiting for the live request', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    let releaseLiveRequest: (value: { duplicate: false; eventId: string; status: 'recorded' }) => void = () => undefined;
    const liveRequest = new Promise<{ duplicate: false; eventId: string; status: 'recorded' }>((resolve) => {
      releaseLiveRequest = resolve;
    });
    let submittedClientEventId: string | null = null;

    const liveDriverEventService = {
      prepareDriverEvent: (event: Parameters<NonNullable<ReturnType<typeof createRouteOrderedDriverEventService>['prepareDriverEvent']>>[0]) => ({
        ...event,
        appVersion: '1.3.0',
        assignmentGeneration: '14',
        driverContractVersion: 2 as const,
        expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
        versionCode: 36,
      }),
      recordDriverEvent: async (event: Parameters<ReturnType<typeof createRouteOrderedDriverEventService>['recordDriverEvent']>[0]) => {
        submittedClientEventId = event.clientEventId;
        return liveRequest;
      },
    };
    const resultPromise = recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: createRouteOrderedDriverEventService({
        driverEventService: liveDriverEventService,
        queue,
        routePlanId: 'route-1',
      }),
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Persist before sending',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const persisted = await createPersistentOfflineSubmissionQueue({ storage });
    const pending = persisted.listPending()[0];
    assert.equal(pending?.kind, 'driver_event');
    assert.equal(pending?.kind === 'driver_event' ? pending.event.eventType : null, 'STOP_DELIVERED');
    assert.equal(pending?.kind === 'driver_event' ? pending.event.clientEventId : null, submittedClientEventId);

    releaseLiveRequest({ duplicate: false, eventId: submittedClientEventId!, status: 'recorded' });
    assert.equal((await resultPromise).kind, 'recorded');
    assert.equal((await createPersistentOfflineSubmissionQueue({ storage })).listPending().length, 0);
  });

  it('restarts with the same durable client event id after interruption before a live response', async () => {
    const storage = createMemoryStorage();
    const firstQueue = await createPersistentOfflineSubmissionQueue({ storage });
    void recordStopProofEventAfterDeliveryStart({
      attemptTimeoutMs: 15_000,
      cancelAttemptTimeout: () => undefined,
      deliveryStart: activeDelivery,
      driverEventService: {
        prepareDriverEvent: (event) => ({
          ...event,
          appVersion: '1.3.0',
          assignmentGeneration: '14',
          driverContractVersion: 2,
          expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
          versionCode: 36,
        }),
        recordDriverEvent: async () => new Promise(() => undefined),
      },
      input: {
        action: 'failed',
        deliveryStopId: 'stop-2',
        note: 'Customer unavailable',
        reason: 'CUSTOMER_UNAVAILABLE',
        routePlanId: 'route-1',
      },
      offlineQueue: firstQueue,
      scheduleAttemptTimeout: () => 'interrupted-process-timer',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const beforeRestart = firstQueue.listPending()[0];
    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    const afterRestart = restarted.listPending()[0];

    assert.equal(beforeRestart?.kind, 'driver_event');
    assert.equal(afterRestart?.kind, 'driver_event');
    assert.equal(
      afterRestart?.kind === 'driver_event' ? afterRestart.event.clientEventId : null,
      beforeRestart?.kind === 'driver_event' ? beforeRestart.event.clientEventId : null,
    );
    assert.equal(afterRestart?.kind === 'driver_event' ? afterRestart.event.eventType : null, 'STOP_FAILED');

    let replayedClientEventId: string | null = null;
    const retry = await retryOfflineSubmissions({
      driverEventService: {
        recordDriverEvent: async (event) => {
          replayedClientEventId = event.clientEventId;
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      orderedEventAccessIdentity: {
        assignmentGeneration: '14',
        driverContractVersion: 2,
        expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
        routePlanId: 'route-1',
      },
      proofMediaUploadService: {
        uploadProofMedia: async () => { throw new Error('unexpected proof retry'); },
      },
      queue: restarted,
      routePlanId: 'route-1',
    });

    assert.equal(replayedClientEventId, beforeRestart?.kind === 'driver_event'
      ? beforeRestart.event.clientEventId
      : null);
    assert.equal(retry.succeeded, 1);
    assert.equal(restarted.listPending().length, 0);
  });

  it('does not send live when the initial durable write fails', async () => {
    let liveCalls = 0;
    const queue = await createPersistentOfflineSubmissionQueue({
      storage: {
        getItem: async () => null,
        removeItem: async () => undefined,
        setItem: async () => { throw new Error('storage full'); },
      },
    });

    await assert.rejects(recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        recordDriverEvent: async () => {
          liveCalls += 1;
          return { duplicate: false, eventId: 'must-not-send', status: 'recorded' };
        },
      },
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'No unsafe live send',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    }), /storage full/u);

    assert.equal(liveCalls, 0);
    assert.equal(queue.storageState(), 'STORAGE_DEGRADED');
  });

  it('keeps the pre-send pending record recoverable when ACK persistence fails', async () => {
    const values = new Map<string, string>();
    let writes = 0;
    const storage: OfflineSubmissionQueueStorage = {
      getItem: async (key) => values.get(key) ?? null,
      removeItem: async (key) => { values.delete(key); },
      setItem: async (key, value) => {
        writes += 1;
        if (writes === 2) throw new Error('ack storage failed');
        values.set(key, value);
      },
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    let submittedClientEventId: string | null = null;

    await assert.rejects(recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        recordDriverEvent: async (event) => {
          submittedClientEventId = event.clientEventId;
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      },
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Server accepted, ACK write failed',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    }), /ack storage failed/u);

    assert.equal(queue.storageState(), 'STORAGE_DEGRADED');
    const durableBeforeAck = JSON.parse(values.get(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY)!) as {
      items: { event: { clientEventId: string }; state: string }[];
    };
    assert.equal(durableBeforeAck.items[0]?.event.clientEventId, submittedClientEventId);
    assert.equal(durableBeforeAck.items[0]?.state, 'PENDING');
    const restarted = await createPersistentOfflineSubmissionQueue({
      storage: {
        ...storage,
        setItem: async (key, value) => { values.set(key, value); },
      },
    });
    const restartedItem = restarted.listPending()[0];
    assert.equal(
      restartedItem?.kind === 'driver_event'
        ? restartedItem.event.clientEventId
        : null,
      submittedClientEventId,
    );
  });

  it('returns a durable queued result on live timeout and ignores a late success', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    let expireAttempt: () => void = () => undefined;
    const liveSignals: AbortSignal[] = [];
    let releaseLateSuccess: (value: { duplicate: false; eventId: string; status: 'recorded' }) => void = () => undefined;
    const lateSuccess = new Promise<{ duplicate: false; eventId: string; status: 'recorded' }>((resolve) => {
      releaseLateSuccess = resolve;
    });
    const rawService = {
      prepareDriverEvent: (event: Parameters<NonNullable<ReturnType<typeof createRouteOrderedDriverEventService>['prepareDriverEvent']>>[0]) => ({
        ...event,
        appVersion: '1.3.0',
        assignmentGeneration: '14',
        driverContractVersion: 2 as const,
        expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
        versionCode: 36,
      }),
      recordDriverEvent: async (
        _event: Parameters<ReturnType<typeof createRouteOrderedDriverEventService>['recordDriverEvent']>[0],
        options?: { signal?: AbortSignal },
      ) => {
        if (options?.signal !== undefined) liveSignals.push(options.signal);
        return lateSuccess;
      },
    };

    const resultPromise = recordStopProofEventAfterDeliveryStart({
      attemptTimeoutMs: 15_000,
      cancelAttemptTimeout: () => undefined,
      deliveryStart: activeDelivery,
      driverEventService: createRouteOrderedDriverEventService({
        driverEventService: rawService,
        queue,
        routePlanId: 'route-1',
      }),
      input: {
        action: 'delivered',
        deliveryStopId: 'stop-1',
        note: 'Timeout remains recoverable',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
      scheduleAttemptTimeout: (expire, timeoutMs) => {
        assert.equal(timeoutMs, 15_000);
        expireAttempt = expire;
        return 'timer-1';
      },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const pendingBeforeTimeout = queue.listPending()[0];
    assert.equal(pendingBeforeTimeout?.kind, 'driver_event');
    expireAttempt();
    const result = await resultPromise;

    assert.equal(result.kind, 'queued');
    assert.equal(liveSignals[0]?.aborted, true);
    assert.equal(queue.listPending()[0]?.queueItemId, pendingBeforeTimeout?.queueItemId);

    releaseLateSuccess({
      duplicate: false,
      eventId: pendingBeforeTimeout?.kind === 'driver_event' ? pendingBeforeTimeout.event.clientEventId : 'missing',
      status: 'recorded',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending()[0]?.queueItemId, pendingBeforeTimeout?.queueItemId);
  });

  it('queues a prepared STOP_FAILED event with the live ordered identity', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    const orderedEventContract = {
      appVersion: '1.2.3',
      assignmentGeneration: '14',
      driverContractVersion: 2 as const,
      expectedRouteVersionId: '44444444-4444-4444-8444-444444444444',
      versionCode: 21,
    };

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        prepareDriverEvent: (event) => ({ ...event, ...orderedEventContract }),
        recordDriverEvent: async () => { throw new Error('network offline'); },
      },
      input: {
        action: 'failed',
        deliveryStopId: 'stop-2',
        note: 'Customer unavailable',
        reason: 'CUSTOMER_UNAVAILABLE',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    });

    assert.equal(result.kind, 'queued');
    const pending = queue.listPending()[0];
    assert.deepEqual(pending?.kind === 'driver_event' ? {
      appVersion: pending.event.appVersion,
      assignmentGeneration: pending.event.assignmentGeneration,
      driverContractVersion: pending.event.driverContractVersion,
      eventType: pending.event.eventType,
      expectedRouteVersionId: pending.event.expectedRouteVersionId,
      versionCode: pending.event.versionCode,
    } : null, {
      ...orderedEventContract,
      eventType: 'STOP_FAILED',
    });
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

  it('blocks terminal stop proof for reconciliation when the server route is no longer in progress', async () => {
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'location-before-terminal',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-05-12T11:04:00.000Z'),
      routePlanId: 'route-1',
    });

    const result = await recordStopProofEventAfterDeliveryStart({
      deliveryStart: activeDelivery,
      driverEventService: {
        recordDriverEvent: async () => {
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      },
      input: {
        action: 'failed',
        deliveryStopId: 'stop-1',
        note: 'Customer unavailable',
        routePlanId: 'route-1',
      },
      offlineQueue: queue,
    });

    assert.equal(result.kind, 'queued');
    assert.equal(result.requiresRouteLookup, undefined);
    assert.equal(result.requiresRouteReconciliation, true);
    assert.match(result.message, /ended or released/iu);
    assert.deepEqual(queue.listPending().map((item) => ({
      kind: item.kind,
      reconciliation: item.reconciliation,
    })), [{
      kind: 'driver_event',
      reconciliation: {
        blockedAt: queue.listPending()[0]?.reconciliation?.blockedAt,
        reason: 'route_not_in_progress',
      },
    }]);
  });
});
