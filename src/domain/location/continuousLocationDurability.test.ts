import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';

import { createMockDriverEventService } from '../events/driverEvents';
import { createInMemoryOfflineSubmissionQueue, createPersistentOfflineSubmissionQueue, recoverPendingRouteEndReceipt, retryOfflineSubmissions } from '../offline/offlineSubmissionQueue';
import { recordContinuousLocationUpdateBatch } from './continuousLocationStream';
import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createDriverAccessTokenStore } from '../driver/driverAccessTokenStore';
import { createMockDriverAuthService } from '../driverAuth/driverAuth';
import { createMockRouteAccessService, sampleInvitedRouteAccess } from '../routeAccess/routeAccess';
import { processContinuousLocationTaskBatch } from './continuousLocationTask';
import { createOfflineRetryScheduler } from '../offline/offlineRetryScheduler';

const observedAt = new Date('2026-09-30T10:00:00Z');
const now = () => new Date('2026-09-30T10:05:00Z');
const locations = [0, 1].map((index) => ({
  accuracyMeters: 8, latitude: 43 + index / 100, longitude: -79,
  occurredAt: new Date(observedAt.getTime() + index * 10_000),
}));
const hashObservationIdentity = async (identity: string) => createHash('sha256').update(identity).digest('hex');
const proofMediaUploadService = { uploadProofMedia: async () => { throw new Error('Unexpected proof upload'); } };

it('persists the whole observation batch before the first HTTP attempt and recovers its suffix on restart', async () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => { stored.set(key, value); },
    removeItem: async (key: string) => { stored.delete(key); },
  };
  const queue = await createPersistentOfflineSubmissionQueue({ now, storage });
  let sends = 0;
  await recordContinuousLocationUpdateBatch({
    driverEventService: {
      recordDriverEvent: async (event) => {
        sends += 1;
        const snapshot = JSON.parse([...stored.values()][0]!);
        assert.equal(snapshot.items.length, 2, 'entire batch must already be durable');
        if (sends === 2) throw new Error('network offline');
        return { status: 'recorded', eventId: event.clientEventId, duplicate: false };
      },
    },
    hashObservationIdentity, locations, now, offlineQueue: queue, routePlanId: 'route-1',
  });
  const restored = await createPersistentOfflineSubmissionQueue({ now, storage });
  assert.equal(restored.listPending().length, 1);
  const retained = restored.listPending()[0]!;
  assert.equal(retained.kind === 'driver_event' && retained.event.occurredAt.toISOString(), locations[1]!.occurredAt.toISOString());
  assert.equal(retained.kind === 'driver_event' && retained.event.accuracyMeters, 8);
});

it('does not transmit when encrypted observation persistence fails', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  let sends = 0;
  await assert.rejects(recordContinuousLocationUpdateBatch({
    driverEventService: { recordDriverEvent: async () => { sends += 1; throw new Error('unexpected transport'); } },
    hashObservationIdentity, locations, now,
    offlineQueue: { ...queue, whenPersisted: async () => { throw new Error('disk unavailable'); } },
    routePlanId: 'route-1',
  }), /disk unavailable/u);
  assert.equal(sends, 0);
});

it('reuses observation identity across native rebatching and separates routes and same-time coordinates', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  const capture = (batch: typeof locations, routePlanId = 'route-1') => recordContinuousLocationUpdateBatch({
    driverEventService: { recordDriverEvent: async () => { throw new Error('offline'); } },
    hashObservationIdentity, locations: batch, nativeBatchDeliveredAt: new Date(now().getTime() + batch.length * 1000), now, offlineQueue: queue, routePlanId,
  });
  await capture(locations);
  await capture([locations[1]!]);
  assert.equal(queue.listPending().length, 2, 'same native observation in a different batch must deduplicate');
  await capture([{ ...locations[1]!, latitude: 45 }]);
  await capture([locations[1]!], 'route-2');
  assert.equal(queue.listPending().length, 4);
});

it('does not overtake a failed GPS head and applies persisted backoff without discarding after five attempts', async () => {
  let time = now().getTime();
  const clock = () => new Date(time);
  const queue = createInMemoryOfflineSubmissionQueue({ now: clock });
  const head = queue.enqueueDriverEvent({ clientEventId: 'head', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  queue.enqueueDriverEvent({ clientEventId: 'tail', eventType: 'LOCATION_UPDATED', occurredAt: locations[1]!.occurredAt, routePlanId: 'route-1' });
  const sent: string[] = [];
  const drain = () => retryOfflineSubmissions({
    driverEventService: { recordDriverEvent: async (event) => { sent.push(event.clientEventId); throw new Error('offline'); } },
    now: clock, proofMediaUploadService, queue,
  });
  await drain();
  assert.deepEqual(sent, ['head']);
  await drain();
  assert.deepEqual(sent, ['head'], 'backoff must also cover a new background callback');
  for (let attempt = 0; attempt < 5; attempt += 1) { time += 61_000; await drain(); }
  assert.equal(head.state, 'PENDING');
  assert.equal(head.attempts, 6);
  assert.equal(queue.listPending().length, 2);
});

it('caps a drain and makes foreground/background retry mutually exclusive while allowing capture', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  for (let index = 0; index < 60; index += 1) queue.enqueueDriverEvent({
    clientEventId: `sample-${index}`, eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1',
  });
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = createMockDriverEventService();
  const running = retryOfflineSubmissions({ driverEventService: {
    recordDriverEvent: async (event) => { started(); await gate; return service.recordDriverEvent(event); },
  }, now, proofMediaUploadService, queue });
  await start;
  const competing = await retryOfflineSubmissions({ driverEventService: service, now, proofMediaUploadService, queue });
  queue.enqueueDriverEvent({ clientEventId: 'new-capture', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  release();
  const result = await running;
  assert.equal(competing.deferred, true);
  assert.equal(result.succeeded, 50);
  assert.equal(queue.listPending().length, 11);
});

it('keeps route completion behind the GPS suffix left by a bounded drain', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  for (let index = 0; index < 60; index += 1) queue.enqueueDriverEvent({
    clientEventId: `before-end-${index}`, eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1',
  });
  queue.enqueueDriverEvent({ clientEventId: 'end', eventType: 'ROUTE_COMPLETED', occurredAt: now(), routePlanId: 'route-1' });
  const service = createMockDriverEventService();
  await retryOfflineSubmissions({ driverEventService: service, now, proofMediaUploadService, queue });
  assert.equal(service.recordedEvents.length, 50);
  assert.equal(queue.listPending().length, 11, 'unacknowledged GPS and completion must remain durable');
  await retryOfflineSubmissions({ driverEventService: service, now, proofMediaUploadService, queue });
  assert.equal(service.recordedEvents.length, 61);
  assert.equal(service.recordedEvents.at(-1)?.eventType, 'ROUTE_COMPLETED');
  assert.equal(queue.listPending().length, 0);
});

it('drains successful recovery chunks without exponential failure backoff', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  for (let index = 0; index < 110; index += 1) queue.enqueueDriverEvent({
    clientEventId: `scheduler-${index}`, eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1',
  });
  const service = createMockDriverEventService();
  const scheduled: { delay: number; run: () => void }[] = [];
  const scheduler = createOfflineRetryScheduler({
    cancel: () => undefined, hasPendingSubmissions: () => queue.listPending().length > 0,
    isForeground: () => true, isOnline: () => true, random: () => 0.5,
    retry: async () => {
      const result = await retryOfflineSubmissions({ driverEventService: service, now, proofMediaUploadService, queue });
      return result.failed === 0 && result.deferred !== true;
    },
    schedule: (run, delay) => { scheduled.push({ delay, run }); return run; },
  });
  scheduler.start();
  for (let chunk = 0; chunk < 3; chunk += 1) {
    assert.equal(scheduled[chunk]?.delay, 1000, 'successful capped drains must not increase the failure delay');
    scheduled[chunk]!.run();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(service.recordedEvents.length, 110);
  assert.equal(queue.listPending().length, 0);
  scheduler.stop();
});

for (const status of ['APPLIED', 'UNKNOWN'] as const) it(`checks completion receipts while GPS is pending (${status})`, async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  queue.enqueueDriverEvent({ clientEventId: 'receipt-gps', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  const end = queue.enqueueDriverEvent({ clientEventId: 'receipt-end', eventType: 'ROUTE_COMPLETED', occurredAt: now(), routePlanId: 'route-1' });
  let lookups = 0;
  const posted: string[] = [];
  await retryOfflineSubmissions({
    driverEventReceiptService: { lookupReceipt: async () => {
      lookups += 1;
      return { assignmentGeneration: null, expectedRouteVersionId: null, clientEventId: 'receipt-end',
        errorCode: null, routePlanId: 'route-1', routeStatus: status === 'APPLIED' ? 'COMPLETED' : 'IN_PROGRESS', status };
    } },
    driverEventService: { recordDriverEvent: async (event) => { posted.push(event.clientEventId); throw new Error('GPS transport unavailable'); } },
    now, proofMediaUploadService, queue,
  });
  assert.equal(lookups, 1);
  assert.deepEqual(posted, ['receipt-gps'], 'receipt checks must never post completion ahead of pending GPS');
  assert.equal(end.state, status === 'APPLIED' ? 'ACKNOWLEDGED' : 'PENDING');
});

it('does not exhaust the route-end retry budget on receipt outages while GPS is waiting', async () => {
  let time = now().getTime();
  const clock = () => new Date(time);
  const queue = createInMemoryOfflineSubmissionQueue({ now: clock });
  const gps = queue.enqueueDriverEvent({ clientEventId: 'offline-gps', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  const end = queue.enqueueDriverEvent({ clientEventId: 'offline-end', eventType: 'ROUTE_COMPLETED', occurredAt: now(), routePlanId: 'route-1' });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => { throw new Error('Receipt offline'); } },
      driverEventService: { recordDriverEvent: async () => { throw new Error('GPS offline'); } },
      now: clock, proofMediaUploadService, queue,
    });
    time += 61_000;
  }
  assert.equal(gps.attempts, 6);
  assert.equal(end.state, 'PENDING');
  assert.equal(end.attempts, 0, 'no route-end POST was attempted');
});

it('keeps the end POST retry budget during repeated restart-recovery receipt timeouts', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  queue.enqueueDriverEvent({ clientEventId: 'restart-gps', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  const end = queue.enqueueDriverEvent({ clientEventId: 'restart-end', eventType: 'ROUTE_COMPLETED', occurredAt: now(), routePlanId: 'route-1' });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal(await recoverPendingRouteEndReceipt({
      attemptTimeoutMs: 1, driverEventReceiptService: { lookupReceipt: () => new Promise(() => undefined) },
      queue, routePlanId: 'route-1',
    }), 'pending');
  }
  assert.equal(end.state, 'PENDING');
  assert.equal(end.attempts, 0);
});

it('captures GPS durably before a hung route start and recovers the ordered start after repeated outages', async () => {
  const values = new Map<string, string>();
  const store = createDriverAccessTokenStore({ now, storage: {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  } });
  await store.saveAuthenticatedDriver({ phoneE164: '+14165550123', accountAccess: {
    accessToken: 'account', refreshToken: 'refresh', expiresAt: '2026-10-01T12:00:00Z',
    refreshTokenExpiresAt: '2026-10-31T12:00:00Z', tokenType: 'Bearer', ttlSeconds: 900, use: 'driver_account',
  } });
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({ routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId, startedAt: observedAt.toISOString(), navigationStepIndex: 0 });
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  await processContinuousLocationTaskBatch({
    createDriverEventService: () => ({ recordDriverEvent: async () => {
      assert.deepEqual(queue.listPending().map((item) => item.kind === 'driver_event' && item.event.eventType), ['ROUTE_STARTED', 'LOCATION_UPDATED', 'LOCATION_UPDATED']);
      throw new Error('offline');
    } }),
    driverAccessTokenStore: store, driverAuthService: createMockDriverAuthService(),
    hashObservationIdentity, locations, offlineQueue: queue, routeAccessService: createMockRouteAccessService(),
  });
  const start = queue.listPending()[0]!;
  for (let attempt = 0; attempt < 6; attempt += 1) queue.recordRetryFailure(start.queueItemId, 'network offline');
  const live = createMockDriverEventService();
  await retryOfflineSubmissions({ driverEventService: live, now: () => new Date(now().getTime() + 61_000), proofMediaUploadService, queue });
  assert.deepEqual(live.recordedEvents.map((event) => event.eventType), ['ROUTE_STARTED', 'LOCATION_UPDATED', 'LOCATION_UPDATED']);
});

it('times out an abort-ignoring GPS request, retains its suffix, and ignores the late ACK', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const result = await recordContinuousLocationUpdateBatch({
    attemptTimeoutMs: 5, hashObservationIdentity, locations, now, offlineQueue: queue, routePlanId: 'route-1',
    driverEventService: { recordDriverEvent: (event, options) => new Promise((resolve) => {
      signal = options?.signal;
      release = () => resolve({ status: 'recorded', duplicate: false, eventId: event.clientEventId });
    }) },
  });
  assert.equal(result.kind === 'recorded' && result.queuedCount, 2);
  assert.equal(signal?.aborted, true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.listPending().length, 2);
  assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
});

it('stops on authentication failure, isolates reassigned GPS, and records explicit expiry', async () => {
  let time = now().getTime();
  const clock = () => new Date(time);
  const snapshots: unknown[][] = [];
  const queue = createInMemoryOfflineSubmissionQueue({ now: clock, onChange: (items) => snapshots.push(items.map((item) => ({ ...item }))) });
  const head = queue.enqueueDriverEvent({ clientEventId: 'auth-head', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1', payload: { locationContext: { assignmentGeneration: '1' } } });
  const tail = queue.enqueueDriverEvent({ clientEventId: 'auth-tail', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1', payload: { locationContext: { assignmentGeneration: '1' } } });
  let sends = 0;
  await retryOfflineSubmissions({ driverEventService: { recordDriverEvent: async () => { sends += 1; throw createDriverApiHttpError({ endpoint: 'event', status: 401 }); } }, now: clock, proofMediaUploadService, queue });
  assert.equal(sends, 1);
  assert.equal(queue.listPending().length, 2);
  time += 61_000;
  const live = createMockDriverEventService();
  const reconciled = await retryOfflineSubmissions({ driverEventService: live, locationAssignmentGeneration: '2', now: clock, proofMediaUploadService, queue });
  assert.equal(reconciled.discarded, 2);
  assert.equal(live.recordedEvents.length, 0);
  assert.equal(head.journal.at(-1)?.code, 'LOCATION_ASSIGNMENT_CHANGED');
  assert.equal(tail.state, 'DISCARDED');
  const expired = queue.enqueueDriverEvent({ clientEventId: 'expired', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  time += 73 * 60 * 60 * 1000;
  await retryOfflineSubmissions({ driverEventService: live, now: clock, proofMediaUploadService, queue });
  assert.equal(expired.journal.at(-1)?.code, 'LOCATION_RETENTION_EXPIRED');
  assert.ok(snapshots.length > 0);
});

it('preserves future observation time and low accuracy, rejects invalid coordinates, and retains provenance', async () => {
  const queue = createInMemoryOfflineSubmissionQueue({ now });
  const future = new Date('2026-10-01T10:00:00Z');
  const result = await recordContinuousLocationUpdateBatch({
    driverEventService: { recordDriverEvent: async () => { throw new Error('offline'); } },
    hashObservationIdentity, now, offlineQueue: queue, routePlanId: 'route-1', provenance: { platform: 'android', appVersion: '1.3.3', versionCode: 39 },
    locations: [{ ...locations[0]!, occurredAt: future, accuracyMeters: 300, metadata: { mocked: true, speedMetersPerSecond: 2 } }, { ...locations[1]!, latitude: NaN }],
  });
  assert.equal(result.kind === 'recorded' && result.droppedCount, 1);
  const item = queue.listPending()[0]!;
  assert.equal(item.kind, 'driver_event');
  if (item.kind !== 'driver_event') return;
  assert.equal(item.event.occurredAt.toISOString(), future.toISOString());
  assert.equal(item.event.accuracyMeters, 300);
  assert.deepEqual(item.event.payload?.locationEvidence, { mocked: true, speedMetersPerSecond: 2, platform: 'android' });
  assert.equal(item.event.appVersion, '1.3.3');
  assert.equal(item.event.clientEventId.length, 87);
});

it('bounds online GPS tombstones while preserving pending capacity and stable discard codes', () => {
  let snapshot: unknown[] = [];
  const queue = createInMemoryOfflineSubmissionQueue({ now, maxItems: 2, onChange: (items) => { snapshot = items; } });
  for (let index = 0; index < 250; index += 1) {
    const item = queue.enqueueDriverEvent({ clientEventId: `acked-${index}`, eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
    queue.acknowledge(item.queueItemId);
  }
  assert.equal(snapshot.length, 200);
  const first = queue.enqueueDriverEvent({ clientEventId: 'capacity-first', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  for (let index = 0; index < 2; index += 1) queue.enqueueDriverEvent({ clientEventId: `pending-${index}`, eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  assert.equal(first.state, 'DISCARDED');
  assert.equal(first.journal.at(-1)?.code, 'QUEUE_CAPACITY_LOCATION');
  assert.equal(queue.listPending().length, 2);
});

it('overflows the shared production capacity around eleven hours before the 72-hour age limit', () => {
  let time = observedAt.getTime();
  const clock = () => new Date(time);
  const queue = createInMemoryOfflineSubmissionQueue({ now: clock });
  queue.enqueueDriverEvent({ clientEventId: 'reserved-start', eventType: 'ROUTE_STARTED', occurredAt: observedAt, routePlanId: 'route-1' });
  queue.enqueueProofMediaUpload({ deliveryStopId: 'stop-1', fileName: 'proof.jpg', routePlanId: 'route-1', source: 'camera', uri: 'file:///synthetic-proof.jpg' });
  const first = queue.enqueueDriverEvent({ clientEventId: 'capacity-0', eventType: 'LOCATION_UPDATED', occurredAt: observedAt, routePlanId: 'route-1' });
  time += 3998 * 10_000;
  queue.enqueueDriverEvents(Array.from({ length: 3998 }, (_, index) => ({
    clientEventId: `capacity-${index + 1}`, eventType: 'LOCATION_UPDATED' as const,
    occurredAt: new Date(observedAt.getTime() + (index + 1) * 10_000), routePlanId: 'route-1',
  })));
  assert.equal(queue.listPending().length, 4000);
  assert.equal(queue.listPending().filter((item) => item.kind === 'driver_event' && item.event.eventType === 'LOCATION_UPDATED').length, 3998);
  assert.ok((time - observedAt.getTime()) / 3600000 < 11.11);
  assert.ok(time - observedAt.getTime() < 72 * 3600000);
  assert.equal(first.state, 'DISCARDED');
  assert.equal(first.journal.at(-1)?.code, 'QUEUE_CAPACITY_LOCATION');
  assert.equal(queue.listPending().some((item) => item.queueItemId === 'driver-event:reserved-start'), true);
  assert.equal(queue.listPending().some((item) => item.kind === 'proof_media'), true);
});
