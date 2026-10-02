import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DriverApiHttpError } from '../api/deliveryServer/driverApiError';
import type {
  DriverDiagnosticContext,
  DriverDiagnosticEnvelope,
  DriverDiagnosticQuarantineEntry,
  DriverDiagnosticSnapshot,
} from '../domain/diagnostics/driverDiagnosticContract';
import {
  emitDriverDiagnosticObservation,
  installDriverDiagnosticObserver,
  observeDriverDiagnosticOperation,
  type DriverDiagnosticObservationInput,
} from '../domain/diagnostics/driverDiagnosticObservation';
import {
  createDriverDiagnosticOutbox,
  type DiagnosticStorage,
} from '../domain/diagnostics/driverDiagnosticOutbox';
import { createDriverDiagnosticRecorder } from '../domain/diagnostics/driverDiagnosticRecorder';
import { createDriverDiagnosticTransport } from '../domain/diagnostics/driverDiagnosticTransport';
import { createContractMockDiagnosticReceiver } from './driverDiagnosticReceiverFixture';
import { createDriverDiagnosticProjection } from './driverDiagnosticProjection';

const context: DriverDiagnosticContext = {
  appVersion: '1.3.3',
  deviceInstanceHash: 'a'.repeat(64),
  os: 'ANDROID',
  osVersion: '16',
  routePlanId: 'f206b513-28ce-4521-82b4-6260d427ffcf',
  sessionGeneration: '42',
  versionCode: 39,
};

const ids = {
  appliedEvent: 'location-updated-applied',
  failedEvent: 'location-updated-failed',
  queueEvent: 'location-updated-queued',
  request: '90000000-0000-4000-8000-000000000001',
} as const;

function uuid(sequence: number, prefix = '2') {
  return `${prefix}0000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function createMemoryStorage(initial: unknown[] = []): DiagnosticStorage & {
  quarantined: DriverDiagnosticQuarantineEntry[];
  records: unknown[];
} {
  const records = [...initial];
  const quarantined: DriverDiagnosticQuarantineEntry[] = [];
  return {
    quarantined,
    records,
    append: async (_owner, additions) => { records.push(...additions); },
    quarantine: async (_owner, entries) => {
      const quarantinedIds = new Set(entries.map(({ record }) => record.diagnosticId));
      const retained = records.filter((candidate) => {
        const diagnosticId = (candidate as { diagnosticId?: string }).diagnosticId;
        return diagnosticId === undefined || !quarantinedIds.has(diagnosticId);
      });
      records.splice(0, records.length, ...retained);
      quarantined.push(...entries);
    },
    read: async () => [...records],
    remove: async (_owner, diagnosticIds) => {
      const accepted = new Set(diagnosticIds);
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const candidate = records[index] as { diagnosticId?: string };
        if (candidate.diagnosticId !== undefined && accepted.has(candidate.diagnosticId)) records.splice(index, 1);
      }
    },
  };
}

function snapshotAt(observedAt: string): DriverDiagnosticSnapshot {
  return {
    businessQueue: {
      nextRetryAt: null,
      observedAt,
      oldestAgeMs: null,
      oldestQueuedAt: null,
      queueDepth: 0,
      retryCount: 0,
    },
    lastGpsCallbackAt: observedAt,
    lastGpsCollectedAt: observedAt,
    lastGpsPersistedAt: observedAt,
    lastGpsSendAcknowledgedAt: observedAt,
    lastGpsSendAttemptAt: observedAt,
    lifecycle: 'FOREGROUND',
    locationPermission: 'GRANTED_FOREGROUND',
    locationService: 'ENABLED',
    locationTask: 'STARTED',
    locationTaskExpected: true,
    network: 'ONLINE',
    snapshotObservedAt: observedAt,
    stateObservedAt: {
      lifecycle: observedAt,
      locationPermission: observedAt,
      locationService: observedAt,
      locationTask: observedAt,
      network: observedAt,
    },
  };
}

function createAcceptanceHarness(
  startAt = '2026-10-01T14:05:00.000Z',
  options?: {
    collectionWarmupMs?: number;
    initializeLocationState?: boolean;
    storage?: ReturnType<typeof createMemoryStorage>;
  },
) {
  let nowMs = Date.parse(startAt);
  let recordSequence = 0;
  let batchSequence = 0;
  let scheduleSequence = 0;
  let registerCalls = 0;
  const diagnosticTokens: string[] = [];
  const scheduled = new Map<number, () => void>();
  const watchdogs = new Map<number, () => void>();
  const storage = options?.storage ?? createMemoryStorage();
  const now = () => new Date(nowMs);
  const receiver = createContractMockDiagnosticReceiver({
    ...(options?.collectionWarmupMs === undefined ? {} : { collectionWarmupMs: options.collectionWarmupMs }),
    now,
  });
  const projection = createDriverDiagnosticProjection(now);
  const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now, storage });
  const transport = createDriverDiagnosticTransport({
    batchIdFactory: () => uuid(++batchSequence, '3'),
    cancel: (handle) => { scheduled.delete(handle as number); },
    credentialStore: {
      get: async () => ({ expiresAt: new Date(nowMs + 12 * 60 * 60_000).toISOString(), token: 'cached-diagnostic-token' }),
      remove: async () => undefined,
      set: async () => undefined,
    },
    deviceInstanceHash: context.deviceInstanceHash,
    minimumAttemptIntervalMs: 0,
    now,
    outbox,
    register: async () => {
      registerCalls += 1;
      throw new Error('ordinary authentication refresh is unavailable');
    },
    schedule: (run) => {
      scheduleSequence += 1;
      scheduled.set(scheduleSequence, run);
      return scheduleSequence;
    },
    send: async ({ credentialToken, envelope }) => {
      diagnosticTokens.push(credentialToken);
      return receiver.receive(envelope);
    },
  });
  const recorder = createDriverDiagnosticRecorder({
    bootId: uuid(1, '1'),
    context,
    idFactory: () => uuid(++recordSequence),
    now,
    outbox,
    snapshot: projection.snapshot,
    transport,
  });

  installDriverDiagnosticObserver((observation) => {
    projection.observe(observation);
    if (observation.kind === 'STATE') {
      recorder.emitStateChange({ blockers: projection.snapshot().blockers });
      return;
    }
    if (observation.phase === 'FAILED' || observation.phase === 'WATCHDOG_TIMEOUT') {
      recorder.emitError({
        blockers: projection.snapshot().blockers ?? [],
        identifiers: {
          ...(observation.clientEventId === undefined ? {} : { clientEventId: observation.clientEventId }),
          ...(observation.requestId === undefined ? {} : { requestId: observation.requestId }),
        },
      });
    }
  }, {
    clearTimeout: (handle) => { watchdogs.delete(handle as number); },
    now,
    setTimeout: (run) => {
      scheduleSequence += 1;
      watchdogs.set(scheduleSequence, run);
      return scheduleSequence;
    },
  });

  if (options?.initializeLocationState !== false) {
    emitDriverDiagnosticObservation({
      kind: 'STATE',
      patch: {
        lifecycle: 'FOREGROUND',
        locationPermission: 'GRANTED_FOREGROUND',
        locationService: 'ENABLED',
        locationTask: 'STARTED',
        locationTaskExpected: true,
        network: 'ONLINE',
      },
    });
  }

  return {
    advance: (milliseconds: number) => { nowMs += milliseconds; },
    diagnosticTokens,
    fireWatchdogs: () => {
      const pending = [...watchdogs.values()];
      watchdogs.clear();
      pending.forEach((run) => { run(); });
    },
    getRegisterCalls: () => registerCalls,
    outbox,
    projection,
    receiver,
    recorder,
    storage,
  };
}

afterEach(() => {
  installDriverDiagnosticObserver(null);
});

describe('contract mock server acceptance for driver diagnostics', () => {
  it('keeps a cold active session with no GPS evidence unknown during warmup', async () => {
    const harness = createAcceptanceHarness('2026-10-01T14:05:00.000Z', {
      collectionWarmupMs: 60_000,
      initializeLocationState: false,
    });
    harness.projection.setLocationExpected(true);
    harness.recorder.emitHeartbeat();

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  });

  it('classifies no GPS as stopped after a supported expectation remains through warmup', async () => {
    const harness = createAcceptanceHarness('2026-10-01T14:05:00.000Z', {
      collectionWarmupMs: 60_000,
      initializeLocationState: false,
    });
    harness.projection.setLocationExpected(true);
    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();

    harness.advance(60_001);
    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();
    assert.deepEqual(harness.receiver.classify(), {
      since: '2026-10-01T14:05:00.000Z',
      status: 'GPS_COLLECTION_STOPPED',
    });
  });

  it('classifies stopped GPS collection while fresh heartbeats continue', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:00:00.000Z',
      collectedAt: '2026-10-01T14:00:00.000Z',
      kind: 'STATE',
    });

    harness.recorder.emitHeartbeat();
    assert.equal(await harness.recorder.flush(), true);

    assert.equal(harness.receiver.getLastContactAt(), '2026-10-01T14:05:00.000Z');
    assert.equal(harness.receiver.classify().status, 'GPS_COLLECTION_STOPPED');
  });

  it('does not let a fresh foreground collection mask a stale continuous callback', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:00:00.000Z',
      collectedAt: '2026-10-01T14:05:00.000Z',
      kind: 'STATE',
    });

    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'GPS_COLLECTION_STOPPED');
  });

  it('keeps future GPS timestamps beyond clock skew tolerance unknown', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:20:00.000Z',
      collectedAt: '2026-10-01T14:20:00.000Z',
      kind: 'STATE',
    });

    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'UNKNOWN_STALE_EVIDENCE');
  });

  it('starts a new GPS warmup when route identity changes', async () => {
    const harness = createAcceptanceHarness('2026-10-01T14:05:00.000Z', {
      collectionWarmupMs: 60_000,
      initializeLocationState: false,
    });
    harness.projection.setLocationExpected(true);
    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();
    const previousEnvelope = harness.receiver.getLatestEnvelope();
    assert.notEqual(previousEnvelope, null);

    harness.advance(60_001);
    await harness.receiver.receive({
      ...previousEnvelope!,
      liveContext: {
        ...context,
        routePlanId: 'f206b513-28ce-4521-82b4-6260d427ff00',
      },
      liveSnapshot: harness.projection.snapshot(),
      sentAt: '2026-10-01T14:06:00.001Z',
    });

    assert.deepEqual(harness.receiver.classify(), {
      since: '2026-10-01T14:06:00.001Z',
      status: 'UNKNOWN_INSUFFICIENT_EVIDENCE',
    });
  });

  it('reports fresh GPS collection when business storage remains hung', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:05:00.000Z',
      collectedAt: '2026-10-01T14:05:00.000Z',
      kind: 'STATE',
    });
    let businessSettled = false;
    void observeDriverDiagnosticOperation({ operation: 'STORAGE_WRITE' }, () => new Promise<void>(() => undefined))
      .finally(() => { businessSettled = true; });
    await Promise.resolve();
    harness.fireWatchdogs();

    assert.equal(await harness.recorder.flush(), true);
    assert.equal(businessSettled, false);
    assert.equal(harness.receiver.classify().status, 'GPS_POST_COLLECTION_BLOCKED');
  });

  it('classifies stale collection as stopped even when a current storage blocker exists', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      blocker: {
        reasonCode: 'STORAGE_WRITE_FAILED',
        stage: 'STORAGE',
      },
      callbackAt: '2026-10-01T14:00:00.000Z',
      collectedAt: '2026-10-01T14:00:00.000Z',
      kind: 'STATE',
    });

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'GPS_COLLECTION_STOPPED');
  });

  it('keeps fresh GPS collection unknown without fresh queue and send acknowledgement evidence', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:05:00.000Z',
      collectedAt: '2026-10-01T14:05:00.000Z',
      kind: 'STATE',
    });

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  });

  it('classifies a fresh location callback pipeline timeout after collection, not as collection stopped', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      callbackAt: '2026-10-01T14:05:00.000Z',
      collectedAt: '2026-10-01T14:05:00.000Z',
      kind: 'STATE',
      blocker: {
        reasonCode: 'LOCATION_PIPELINE_TIMEOUT',
        stage: 'PROCESSING',
      },
    });

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'GPS_POST_COLLECTION_BLOCKED');
  });

  it('classifies diagnostic storage failure as degraded evidence instead of GPS storage failure', async () => {
    const harness = createAcceptanceHarness();
    emitDriverDiagnosticObservation({
      collectedAt: '2026-10-01T14:05:00.000Z',
      kind: 'STATE',
      blocker: {
        reasonCode: 'DIAGNOSTIC_STORAGE_FAILED',
        stage: 'STORAGE',
      },
    });

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'DIAGNOSTIC_EVIDENCE_DEGRADED');
  });

  it('uses cached diagnostic credentials while ordinary 401 refresh remains hung', async () => {
    const harness = createAcceptanceHarness();
    await assert.rejects(observeDriverDiagnosticOperation({
      operation: 'EVENT_SEND',
      requestId: ids.request,
    }, async () => {
      throw new DriverApiHttpError({ endpoint: 'Driver event record', status: 401 });
    }));
    void observeDriverDiagnosticOperation({ operation: 'AUTH_REFRESH' }, () => new Promise<void>(() => undefined));
    await Promise.resolve();
    harness.fireWatchdogs();

    assert.equal(await harness.recorder.flush(), true);
    assert.deepEqual(harness.diagnosticTokens, ['cached-diagnostic-token']);
    assert.equal(harness.getRegisterCalls(), 0);
    assert.equal(harness.receiver.classify().status, 'AUTH_OR_ROUTE_BLOCKED');
  });

  it('atomically quarantines a permanent rejection from a mixed response without blocking transport', async () => {
    const storage = createMemoryStorage();
    const atomicQuarantine = storage.quarantine;
    let quarantineStarted = false;
    let releaseQuarantine!: () => void;
    const quarantineGate = new Promise<void>((resolve) => { releaseQuarantine = resolve; });
    storage.quarantine = async (owner, entries) => {
      quarantineStarted = true;
      await quarantineGate;
      await atomicQuarantine(owner, entries);
    };
    const harness = createAcceptanceHarness('2026-10-01T14:05:00.000Z', { storage });
    harness.recorder.emitStateChange();
    const sentRecords = harness.outbox.listPending();
    assert.ok(sentRecords.length >= 2);
    const rejectedId = sentRecords[0]!.diagnosticId;
    harness.receiver.rejectDiagnostic(rejectedId, 'INVALID_RECORD');

    assert.equal(await harness.recorder.flush(), true);
    assert.deepEqual(harness.outbox.listPending(), []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(quarantineStarted, true);
    assert.deepEqual(storage.quarantined, []);
    assert.equal(storage.records.some((candidate) => (
      (candidate as { diagnosticId?: string }).diagnosticId === rejectedId
    )), true);

    releaseQuarantine();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual((storage.quarantined as DriverDiagnosticQuarantineEntry[]).map(({ code, record }) => ({
      code,
      diagnosticId: record.diagnosticId,
    })), [{ code: 'INVALID_RECORD', diagnosticId: rejectedId }]);
    assert.deepEqual(storage.records, []);

    const restarted = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    await restarted.hydrate();
    assert.deepEqual(restarted.listPending(), []);
  });

  it('classifies an authoritative failed server attempt as received but not applied', async () => {
    const harness = createAcceptanceHarness();
    harness.receiver.recordAttempt({ clientEventId: ids.failedEvent, status: 'FAILED' });
    await assert.rejects(observeDriverDiagnosticOperation({
      clientEventId: ids.failedEvent,
      operation: 'EVENT_SEND',
      requestId: ids.request,
    }, async () => {
      throw new DriverApiHttpError({ endpoint: 'Driver event record', status: 500 });
    }));

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'SERVER_RECEIVED_NOT_APPLIED');
  });

  it('classifies an authoritative applied attempt separately from a lost client response', async () => {
    const harness = createAcceptanceHarness();
    harness.receiver.recordAttempt({ clientEventId: ids.appliedEvent, status: 'APPLIED' });
    await assert.rejects(observeDriverDiagnosticOperation({
      clientEventId: ids.appliedEvent,
      operation: 'EVENT_SEND',
      requestId: ids.request,
    }, async () => {
      throw new Error('Network request timed out');
    }));

    await harness.recorder.flush();
    assert.equal(harness.receiver.classify().status, 'SERVER_APPLIED_CLIENT_ACK_UNKNOWN');
  });

  it('classifies a server-clock contact gap as signal absent with unknown cause', async () => {
    const harness = createAcceptanceHarness();
    harness.recorder.emitHeartbeat();
    await harness.recorder.flush();

    harness.advance(2 * 60_000 + 1);
    assert.deepEqual(harness.receiver.classify(), {
      since: '2026-10-01T14:05:00.000Z',
      status: 'SIGNAL_ABSENT_UNKNOWN',
    });
  });

  it('does not let replayed healthy history establish current health', async () => {
    let nowMs = Date.parse('2026-10-01T14:05:00.000Z');
    const now = () => new Date(nowMs);
    const oldAt = '2026-10-01T13:00:00.000Z';
    const storage = createMemoryStorage();
    const firstOutbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now, storage });
    firstOutbox.record({
      bootId: uuid(1, '1'), context, diagnosticId: uuid(1), kind: 'HEARTBEAT',
      observedAt: oldAt, sequence: 1, snapshot: snapshotAt(oldAt),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const restartedOutbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now, storage });
    await restartedOutbox.hydrate();
    const receiver = createContractMockDiagnosticReceiver({ now });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => uuid(1, '3'),
      credentialStore: {
        get: async () => ({ expiresAt: '2026-10-02T00:00:00.000Z', token: 'cached-diagnostic-token' }),
        remove: async () => undefined,
        set: async () => undefined,
      },
      deviceInstanceHash: context.deviceInstanceHash,
      minimumAttemptIntervalMs: 0,
      now,
      outbox: restartedOutbox,
      register: async () => { throw new Error('unused'); },
      send: async ({ envelope }) => receiver.receive(envelope),
    });

    nowMs = Date.parse('2026-10-01T14:06:00.000Z');
    await transport.flush(() => ({ bootId: uuid(2, '1'), context, snapshot: snapshotAt(oldAt) }));
    assert.equal(receiver.classify().status, 'UNKNOWN_STALE_EVIDENCE');
  });

  it('correlates queue age and retry schedule with the failed request identifiers', async () => {
    const harness = createAcceptanceHarness();
    harness.projection.setQueue({
      nextRetryAt: null,
      oldestQueuedAt: '2026-10-01T14:04:00.000Z',
      queueDepth: 1,
      retryCount: 2,
    });
    harness.projection.setNextRetryAt('2026-10-01T14:06:00.000Z');
    await assert.rejects(observeDriverDiagnosticOperation({
      clientEventId: ids.queueEvent,
      operation: 'EVENT_SEND',
      requestId: ids.request,
    }, async () => {
      throw new Error('Network request timed out');
    }));

    await harness.recorder.flush();
    const snapshot = harness.receiver.getLatestEnvelope()?.liveSnapshot;
    assert.deepEqual(snapshot?.businessQueue, {
      nextRetryAt: '2026-10-01T14:06:00.000Z',
      observedAt: '2026-10-01T14:05:00.000Z',
      oldestAgeMs: 60_000,
      oldestQueuedAt: '2026-10-01T14:04:00.000Z',
      queueDepth: 1,
      retryCount: 2,
    });
    assert.deepEqual(snapshot?.blockers?.[0], {
      clientEventId: ids.queueEvent,
      lastObservedAt: '2026-10-01T14:05:00.000Z',
      reason: 'HTTP_TIMEOUT',
      requestId: ids.request,
      since: '2026-10-01T14:05:00.000Z',
      stage: 'TRANSPORT',
    });
  });

  it('removes secrets customer data and coordinates before contract transmission', async () => {
    const harness = createAcceptanceHarness();
    const poisonedState = {
      kind: 'STATE',
      latitude: 43.6532,
      longitude: -79.3832,
      pin: '1234',
      token: 'secret-token',
    } as unknown as DriverDiagnosticObservationInput;
    emitDriverDiagnosticObservation(poisonedState);
    await assert.rejects(observeDriverDiagnosticOperation({
      clientEventId: 'customer@example.com',
      operation: 'PROOF_UPLOAD',
      requestId: 'secret-request-id',
    }, async () => {
      throw new Error('Customer Jane at 1 Main St, token secret-token, GPS 43.6532,-79.3832');
    }));

    await harness.recorder.flush();
    const serialized = JSON.stringify(harness.receiver.getLatestEnvelope() as DriverDiagnosticEnvelope);
    assert.doesNotMatch(serialized, /1234|secret|customer@|Jane|Main St|43\.6532|-79\.3832/iu);
  });
});
