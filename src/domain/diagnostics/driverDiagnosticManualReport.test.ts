import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  DriverDiagnosticContext,
  DriverDiagnosticEnvelope,
  DriverDiagnosticRecord,
  DriverDiagnosticSnapshot,
} from './driverDiagnosticContract';
import {
  createDriverDiagnosticOutbox,
  type DiagnosticStorage,
} from './driverDiagnosticOutbox';
import { createDriverDiagnosticRecorder } from './driverDiagnosticRecorder';
import { createDriverDiagnosticTransport } from './driverDiagnosticTransport';

const context: DriverDiagnosticContext = {
  appVersion: '1.3.4',
  deviceInstanceHash: 'a'.repeat(64),
  os: 'ANDROID',
  osVersion: '16',
  routePlanId: 'f206b513-28ce-4521-82b4-6260d427ffcf',
  sessionGeneration: '2026-10-01T14:00:00.000Z',
  versionCode: 40,
};

const snapshot: DriverDiagnosticSnapshot = {
  businessQueue: {
    nextRetryAt: null,
    observedAt: '2026-10-01T14:05:00.000Z',
    oldestAgeMs: null,
    oldestQueuedAt: null,
    queueDepth: 0,
    retryCount: 0,
  },
  lastGpsCallbackAt: '2026-10-01T14:04:59.000Z',
  lastGpsCollectedAt: '2026-10-01T14:04:59.000Z',
  lastGpsPersistedAt: '2026-10-01T14:04:59.000Z',
  lastGpsSendAcknowledgedAt: '2026-10-01T14:04:59.000Z',
  lastGpsSendAttemptAt: '2026-10-01T14:04:59.000Z',
  lifecycle: 'FOREGROUND',
  locationPermission: 'GRANTED_FOREGROUND',
  locationService: 'ENABLED',
  locationTask: 'STARTED',
  locationTaskExpected: true,
  network: 'ONLINE',
  snapshotObservedAt: '2026-10-01T14:05:00.000Z',
  stateObservedAt: {
    lifecycle: '2026-10-01T14:05:00.000Z',
    locationPermission: '2026-10-01T14:05:00.000Z',
    locationService: '2026-10-01T14:05:00.000Z',
    locationTask: '2026-10-01T14:05:00.000Z',
    network: '2026-10-01T14:05:00.000Z',
  },
};

const ids = {
  batch1: '30000000-0000-4000-8000-000000000001',
  batch2: '30000000-0000-4000-8000-000000000002',
  boot: '10000000-0000-4000-8000-000000000001',
  report: '20000000-0000-4000-8000-000000000001',
} as const;

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryStorage(initial: DriverDiagnosticRecord[] = []) {
  const records = [...initial];
  const storage: DiagnosticStorage = {
    append: async (_owner, additions) => { records.push(...additions); },
    quarantine: async (_owner, entries) => {
      const ids = new Set(entries.map(({ record }) => record.diagnosticId));
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (ids.has(records[index]!.diagnosticId)) records.splice(index, 1);
      }
    },
    read: async () => [...records],
    remove: async (_owner, removals) => {
      const ids = new Set(removals);
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (ids.has(records[index]!.diagnosticId)) records.splice(index, 1);
      }
    },
  };
  return { records, storage };
}

function createHarness(input?: {
  idFactory?: () => string;
  maxRecords?: number;
  reportStatusCapacity?: number;
  storage?: DiagnosticStorage;
  send?: (envelope: DriverDiagnosticEnvelope) => Promise<{
    acceptedDiagnosticIds: string[];
    rejectedDiagnostics: { code: string; diagnosticId: string }[];
    serverReceivedAt: string;
  }>;
}) {
  const storage = input?.storage ?? memoryStorage().storage;
  const outbox = createDriverDiagnosticOutbox({
    accountOwnerHash: 'account-a',
    maxRecords: input?.maxRecords,
    reportStatusCapacity: input?.reportStatusCapacity,
    storage,
  });
  let batch = 0;
  const transport = createDriverDiagnosticTransport({
    batchIdFactory: () => (batch++ === 0 ? ids.batch1 : ids.batch2),
    credentialStore: {
      get: async () => ({ expiresAt: '2026-10-02T13:00:00.000Z', token: 'credential' }),
      remove: async () => undefined,
      set: async () => undefined,
    },
    deviceInstanceHash: context.deviceInstanceHash,
    minimumAttemptIntervalMs: 0,
    now: () => new Date('2026-10-01T14:05:00.000Z'),
    outbox,
    register: async () => { throw new Error('unused'); },
    schedule: () => ({ scheduled: true }),
    send: async ({ envelope }) => input?.send?.(envelope) ?? {
      acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId),
      rejectedDiagnostics: [],
      serverReceivedAt: '2026-10-01T14:05:01.000Z',
    },
  });
  const recorder = createDriverDiagnosticRecorder({
    bootId: ids.boot,
    context,
    idFactory: input?.idFactory ?? (() => ids.report),
    now: () => new Date('2026-10-01T14:05:00.000Z'),
    outbox,
    snapshot: () => snapshot,
    transport,
  });
  return { outbox, recorder, storage, transport };
}

describe('driver diagnostic manual report', () => {
  it('persists an offline report and restores its queued status after restart', async () => {
    const memory = memoryStorage();
    const first = createHarness({
      storage: memory.storage,
      send: async () => { throw new Error('offline'); },
    });
    const report = first.recorder.reportUserIssue();
    assert.ok(report);
    assert.equal(report.diagnosticId, ids.report);
    assert.equal(report.getStatus()?.state, 'SAVING');
    await tick();
    assert.equal(report.getStatus()?.state, 'QUEUED');
    assert.equal(await first.recorder.flush(), false);
    assert.equal(report.getStatus()?.state, 'QUEUED');
    first.transport.stop();

    const restarted = createHarness({ storage: memory.storage });
    await restarted.outbox.hydrate();
    assert.equal(restarted.recorder.getUserReportStatus(ids.report)?.state, 'QUEUED');
    restarted.transport.stop();
  });

  it('marks only the explicitly accepted report id as acknowledged', async () => {
    const otherId = '20000000-0000-4000-8000-000000000002';
    const harness = createHarness({
      send: async () => ({
        acceptedDiagnosticIds: [ids.report],
        rejectedDiagnostics: [],
        serverReceivedAt: '2026-10-01T14:05:02.000Z',
      }),
    });
    harness.outbox.record({
      bootId: ids.boot, context, diagnosticId: otherId, kind: 'ERROR',
      observedAt: '2026-10-01T14:04:00.000Z', sequence: 1, snapshot,
    });
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    await tick();
    assert.equal(await harness.recorder.flush(), true);
    assert.deepEqual(report.getStatus(), {
      serverReceivedAt: '2026-10-01T14:05:02.000Z',
      state: 'ACKNOWLEDGED',
      updatedAt: '2026-10-01T14:05:02.000Z',
    });
    assert.deepEqual(harness.outbox.listPending().map(({ diagnosticId }) => diagnosticId), [otherId]);
    harness.transport.stop();
  });

  it('distinguishes a permanent rejection from an ACK', async () => {
    const harness = createHarness({
      send: async () => ({
        acceptedDiagnosticIds: [],
        rejectedDiagnostics: [{ code: 'INVALID_RECORD', diagnosticId: ids.report }],
        serverReceivedAt: '2026-10-01T14:05:02.000Z',
      }),
    });
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    await tick();
    assert.equal(await harness.recorder.flush(), true);
    assert.deepEqual(report.getStatus(), {
      failure: 'PERMANENT_REJECTION',
      rejectionCode: 'INVALID_RECORD',
      state: 'FAILED',
      updatedAt: '2026-10-01T14:05:00.000Z',
    });
    harness.transport.stop();
  });

  it('reports an append rejection as a local storage failure', async () => {
    const harness = createHarness({
      storage: {
        append: async () => { throw new Error('write failed'); },
        quarantine: async () => undefined,
        read: async () => [],
        remove: async () => undefined,
      },
    });
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    const changes: string[] = [];
    report.subscribe((status) => changes.push(status.state));
    await tick();
    const status = report.getStatus();
    assert.equal(status?.state, 'FAILED');
    assert.equal(status?.state === 'FAILED' && status.failure, 'LOCAL_STORAGE');
    assert.deepEqual(changes, ['FAILED']);
    harness.transport.stop();
  });

  it('reports an append timeout without blocking a live ACK', async () => {
    const append = deferred<void>();
    const timeouts: { active: boolean; expire: () => void }[] = [];
    const harness = createHarness({
      storage: {
        append: async () => append.promise,
        quarantine: async () => undefined,
        read: async () => [],
        remove: async () => undefined,
      },
    });
    const timeoutOutbox = createDriverDiagnosticOutbox({
      accountOwnerHash: 'account-a',
      cancelTimeout: (handle) => { (handle as { active: boolean }).active = false; },
      operationTimeoutMs: 5,
      scheduleTimeout: (expire) => {
        const handle = { active: true, expire };
        timeouts.push(handle);
        return handle;
      },
      storage: harness.storage,
    });
    const timeoutTransport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T13:00:00.000Z', token: 'credential' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      minimumAttemptIntervalMs: 0,
      outbox: timeoutOutbox,
      register: async () => { throw new Error('unused'); },
      schedule: () => ({ scheduled: true }),
      send: async ({ envelope }) => ({ acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId), rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:03.000Z' }),
    });
    const recorder = createDriverDiagnosticRecorder({ bootId: ids.boot, context, idFactory: () => ids.report, outbox: timeoutOutbox, snapshot: () => snapshot, transport: timeoutTransport });
    const report = recorder.reportUserIssue();
    assert.ok(report);
    timeouts.find(({ active }) => active)?.expire();
    await tick();
    const failedStatus = report.getStatus();
    assert.equal(failedStatus?.state, 'FAILED');
    assert.equal(failedStatus?.state === 'FAILED' && failedStatus.failure, 'LOCAL_STORAGE');
    assert.equal(await recorder.flush(), true);
    assert.equal(report.getStatus()?.state, 'ACKNOWLEDGED');
    append.resolve();
    timeoutTransport.stop();
    harness.transport.stop();
  });

  it('bounds retained statuses and never treats a missing status as an ACK', async () => {
    const reportIds = [
      '20000000-0000-4000-8000-000000000011',
      '20000000-0000-4000-8000-000000000012',
    ];
    const harness = createHarness({
      idFactory: () => reportIds.shift()!,
      reportStatusCapacity: 1,
    });
    const first = harness.recorder.reportUserIssue();
    const second = harness.recorder.reportUserIssue();
    assert.ok(first);
    assert.ok(second);
    await tick();
    await tick();
    assert.equal(first.getStatus(), null);
    assert.equal(second.getStatus()?.state, 'QUEUED');
    harness.transport.stop();
  });

  it('marks a locally discarded report as failed instead of leaving a false queued status', async () => {
    const generated = [
      '20000000-0000-4000-8000-000000000021',
      '20000000-0000-4000-8000-000000000022',
    ];
    const harness = createHarness({
      idFactory: () => generated.shift()!,
      maxRecords: 1,
    });
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    harness.recorder.emitError({ blockers: [] });
    await tick();
    const status = report.getStatus();
    assert.equal(status?.state, 'FAILED');
    assert.equal(status?.state === 'FAILED' && status.failure, 'LOCAL_RETENTION');
    harness.transport.stop();
  });

  it('keeps arbitrary report metadata out of the serialized record', () => {
    const harness = createHarness();
    const report = harness.recorder.reportUserIssue({
      blockers: [{
        lastObservedAt: '2026-10-01T14:05:00.000Z',
        reason: 'secret-token-value',
        since: '2026-10-01T14:05:00.000Z',
        stage: 'TRANSPORT',
      }] as never,
      identifiers: { requestId: 'customer@example.com' },
    });
    assert.ok(report);
    const [record] = harness.outbox.listPending();
    assert.equal(record?.kind, 'USER_REPORT');
    assert.equal(record?.identifiers, undefined);
    assert.equal(record?.snapshot.blockers, undefined);
    assert.equal(JSON.stringify(record).includes('secret-token-value'), false);
    assert.equal(JSON.stringify(record).includes('customer@example.com'), false);
    harness.transport.stop();
  });

  it('keeps a report queued behind a full batch and ACKs it only in the later batch', async () => {
    const generated = Array.from({ length: 52 }, (_, index) => `20000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`);
    const reportId = generated[51]!;
    const sent: string[][] = [];
    const harness = createHarness({
      idFactory: () => generated[51]!,
      send: async (envelope) => {
        sent.push(envelope.records.map(({ diagnosticId }) => diagnosticId));
        return { acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId), rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:02.000Z' };
      },
    });
    for (let index = 0; index < 51; index += 1) {
      harness.outbox.record({ bootId: ids.boot, context, diagnosticId: generated[index], kind: 'STATE_CHANGE', observedAt: `2026-10-01T14:04:${String(index).padStart(2, '0')}.000Z`, sequence: index, snapshot });
    }
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    await tick();
    await harness.recorder.flush();
    assert.equal(report.getStatus()?.state, 'QUEUED');
    await harness.recorder.flush();
    assert.equal(report.getStatus()?.state, 'ACKNOWLEDGED');
    assert.equal(sent[0]?.includes(reportId), false);
    assert.equal(sent[1]?.includes(reportId), true);
    harness.transport.stop();
  });

  it('isolates report status across account generations and ignores a late ACK', async () => {
    const harness = createHarness();
    const changes: string[] = [];
    const report = harness.recorder.reportUserIssue();
    assert.ok(report);
    const unsubscribe = report.subscribe((status) => changes.push(status.state));
    await tick();
    harness.outbox.switchAccount('account-b');
    const changedStatus = report.getStatus();
    assert.equal(changedStatus?.state, 'FAILED');
    assert.equal(changedStatus?.state === 'FAILED' && changedStatus.failure, 'ACCOUNT_CHANGED');
    assert.equal(harness.recorder.getUserReportStatus(ids.report), null);
    harness.outbox.acknowledge([ids.report], 'account-a', '2026-10-01T14:05:04.000Z');
    assert.equal(report.getStatus()?.state, 'FAILED');
    assert.deepEqual(changes, ['QUEUED', 'FAILED']);
    unsubscribe();
    harness.transport.stop();
  });
});
