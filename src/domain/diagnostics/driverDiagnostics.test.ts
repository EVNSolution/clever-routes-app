import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverDiagnosticOutbox,
  type DiagnosticStorage,
} from './driverDiagnosticOutbox';
import {
  createDriverDiagnosticRecorder,
} from './driverDiagnosticRecorder';
import {
  createDriverDiagnosticTransport,
} from './driverDiagnosticTransport';
import type {
  DriverDiagnosticContext,
  DriverDiagnosticEnvelope,
  DriverDiagnosticRecord,
  DriverDiagnosticSnapshot,
} from './driverDiagnosticContract';
import { sanitizeDriverDiagnosticContext } from './driverDiagnosticContract';

const context: DriverDiagnosticContext = {
  appVersion: '1.3.3',
  deviceInstanceHash: 'a'.repeat(64),
  os: 'ANDROID',
  osVersion: '16',
  routePlanId: 'f206b513-28ce-4521-82b4-6260d427ffcf',
  sessionGeneration: '42',
  versionCode: 39,
};

const snapshot: DriverDiagnosticSnapshot = {
  businessQueue: {
    nextRetryAt: '2026-10-01T14:06:00.000Z',
    observedAt: '2026-10-01T14:05:00.000Z',
    oldestAgeMs: 53_193,
    oldestQueuedAt: '2026-10-01T14:04:06.807Z',
    queueDepth: 1,
    retryCount: 0,
  },
  lastGpsCallbackAt: '2026-10-01T14:04:19.000Z',
  lastGpsCollectedAt: '2026-10-01T14:04:19.000Z',
  lastGpsPersistedAt: '2026-10-01T14:04:20.000Z',
  lastGpsSendAcknowledgedAt: '2026-10-01T14:04:21.000Z',
  lastGpsSendAttemptAt: '2026-10-01T14:04:20.500Z',
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
  boot1: '10000000-0000-4000-8000-000000000001',
  boot2: '10000000-0000-4000-8000-000000000002',
  batch1: '30000000-0000-4000-8000-000000000001',
  diag1: '20000000-0000-4000-8000-000000000001',
  diag2: '20000000-0000-4000-8000-000000000002',
  diag3: '20000000-0000-4000-8000-000000000003',
  diag4: '20000000-0000-4000-8000-000000000004',
  diag5: '20000000-0000-4000-8000-000000000005',
  route2: 'f206b513-28ce-4521-82b4-6260d427ff00',
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryStorage(initial: unknown[] = []): DiagnosticStorage & { quarantined: unknown[]; records: unknown[] } {
  const records = [...initial];
  const quarantined: unknown[] = [];
  return {
    quarantined,
    records,
    append: async (_accountOwnerHash, additions) => { records.push(...additions); },
    quarantine: async (_accountOwnerHash, entries) => {
      quarantined.push(...entries);
      const rejected = new Set(entries.map(({ record }) => record.diagnosticId));
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const candidate = records[index] as { diagnosticId?: string };
        if (candidate.diagnosticId !== undefined && rejected.has(candidate.diagnosticId)) records.splice(index, 1);
      }
    },
    read: async () => [...records],
    remove: async (_accountOwnerHash, ids) => {
      const accepted = new Set(ids);
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const candidate = records[index] as { diagnosticId?: string };
        if (candidate.diagnosticId !== undefined && accepted.has(candidate.diagnosticId)) records.splice(index, 1);
      }
    },
  };
}

function rejection(code: string, diagnosticId: string = ids.diag1) {
  return { code, diagnosticId };
}

describe('driver diagnostics', () => {
  it('delivers a live error even while durable append is stalled', async () => {
    const append = deferred<void>();
    const sent: unknown[] = [];
    const storage: DiagnosticStorage = {
      append: async () => append.promise,
      quarantine: async () => undefined,
      read: async () => [],
      remove: async () => undefined,
    };
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: { get: async () => null, remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      outbox,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      register: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'diagnostic-secret' }),
      send: async ({ credentialToken, envelope }) => {
        assert.equal(credentialToken, 'diagnostic-secret');
        sent.push(envelope);
        return { acceptedDiagnosticIds: envelope.records.map((record) => record.diagnosticId), rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:01.000Z' };
      },
    });
    const recorder = createDriverDiagnosticRecorder({
      bootId: ids.boot1, context, now: () => new Date('2026-10-01T14:05:00.000Z'), outbox,
      idFactory: () => ids.diag1,
      snapshot: () => snapshot, transport,
    });

    recorder.emitError({ blockers: [{ lastObservedAt: '2026-10-01T14:05:00.000Z', reason: 'HTTP_TIMEOUT', since: '2026-10-01T14:04:06.807Z', stage: 'TRANSPORT' }] });
    await recorder.flush();

    assert.equal(sent.length, 1);
    assert.equal(outbox.listPending().length, 0);
    append.resolve();
  });

  it('replays durable records after restart and keeps them until an explicit accepted-id ACK', async () => {
    const storage = memoryStorage();
    const first = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    first.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    await new Promise((resolve) => setImmediate(resolve));

    const restarted = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    await restarted.hydrate();
    assert.deepEqual(restarted.listPending().map(({ diagnosticId }) => diagnosticId), [ids.diag1]);
    restarted.acknowledge(['unknown-id'], 'account-a');
    assert.equal(restarted.listPending().length, 1);
    restarted.acknowledge([ids.diag1], 'account-a');
    assert.equal(restarted.listPending().length, 0);
  });

  it('orders a durable ACK removal after an earlier slow append so restart cannot resurrect the record', async () => {
    const appendGate = deferred<void>();
    const persisted: DriverDiagnosticRecord[] = [];
    const storage: DiagnosticStorage = {
      append: async (_owner, records) => {
        await appendGate.promise;
        persisted.push(...records);
      },
      quarantine: async (_owner, entries) => {
        const removed = new Set(entries.map(({ record }) => record.diagnosticId));
        for (let index = persisted.length - 1; index >= 0; index -= 1) {
          if (removed.has(persisted[index]!.diagnosticId)) persisted.splice(index, 1);
        }
      },
      read: async () => [...persisted],
      remove: async (_owner, ids) => {
        const removed = new Set(ids);
        for (let index = persisted.length - 1; index >= 0; index -= 1) {
          if (removed.has(persisted[index]!.diagnosticId)) persisted.splice(index, 1);
        }
      },
    };
    const first = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    first.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    first.acknowledge([ids.diag1], 'account-a');
    appendGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const restarted = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    await restarted.hydrate();
    assert.deepEqual(restarted.listPending(), []);
    assert.deepEqual(persisted, []);
  });

  it('orders retention removal after the append of a newly discarded overflow record', async () => {
    const storage = memoryStorage();
    const first = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', maxRecords: 1, storage });
    first.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    first.record({ bootId: ids.boot1, context, diagnosticId: ids.diag2, kind: 'STATE_CHANGE', observedAt: '2026-10-01T14:05:01.000Z', sequence: 2, snapshot });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const restarted = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', maxRecords: 1, storage });
    await restarted.hydrate();
    assert.deepEqual(restarted.listPending().map(({ diagnosticId }) => diagnosticId), [ids.diag1]);
  });

  it('does not let a late send completion ACK a newly selected account', async () => {
    const sendResult = deferred<{ acceptedDiagnosticIds: string[]; rejectedDiagnostics: never[]; serverReceivedAt: string }>();
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'secret-a' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      outbox,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      register: async () => { throw new Error('unused'); },
      send: async () => sendResult.promise,
    });

    const pending = transport.flush(() => ({ bootId: ids.boot1, context, snapshot }));
    outbox.switchAccount('account-b');
    outbox.record({ bootId: ids.boot2, context: { ...context, routePlanId: ids.route2 }, diagnosticId: ids.diag2, kind: 'ERROR', observedAt: '2026-10-01T14:05:01.000Z', sequence: 1, snapshot });
    sendResult.resolve({ acceptedDiagnosticIds: [ids.diag1, ids.diag2], rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:02.000Z' });
    await pending;
    assert.deepEqual(outbox.listPending().map(({ diagnosticId }) => diagnosticId), [ids.diag2]);
    transport.stop();
  });

  it('drops poison fields and invalid hydrated records instead of serializing secrets or coordinates', async () => {
    const poisoned = {
      bootId: ids.boot1, context: { ...context, pin: '1234', token: 'secret' }, diagnosticId: ids.diag1,
      identifiers: { requestId: 'secret-request-token' }, kind: 'ERROR', latitude: 43.7, message: 'customer Jane at 1 Main St', observedAt: '2026-10-01T14:05:00.000Z',
      sequence: 1, snapshot: { ...snapshot, longitude: -79.4 }, url: 'https://secret.example/path',
    };
    const storage = memoryStorage([poisoned, { ...poisoned, diagnosticId: 'bad id with spaces' }]);
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    await outbox.hydrate();
    const serialized = JSON.stringify(outbox.buildBatch({ batchId: ids.batch1, bootId: ids.boot2, liveContext: context, liveSnapshot: snapshot }));
    assert.match(serialized, new RegExp(ids.diag1));
    assert.doesNotMatch(serialized, /1234|secret|Jane|Main St|43\.7|-79\.4|https:/);
    assert.equal(outbox.listPending().length, 1);
  });

  it('preserves only UUID or known producer-shaped request and client event identifiers', () => {
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({
      bootId: ids.boot1,
      context,
      diagnosticId: ids.diag1,
      identifiers: {
        clientEventId: 'continuous-location-2026-10-01T14:04:19.000Z-0',
        requestId: '40000000-0000-4000-8000-000000000001',
      },
      kind: 'ERROR',
      observedAt: '2026-10-01T14:05:00.000Z',
      sequence: 1,
      snapshot,
    });
    assert.deepEqual(outbox.listPending()[0]?.identifiers, {
      clientEventId: 'continuous-location-2026-10-01T14:04:19.000Z-0',
      requestId: '40000000-0000-4000-8000-000000000001',
    });
  });

  it('retains the initial failure while bounding age, count, batch size, and reporting discarded history', () => {
    const storage = memoryStorage();
    let now = new Date('2026-10-08T14:05:00.000Z');
    const outbox = createDriverDiagnosticOutbox({
      accountOwnerHash: 'account-a', maxRecords: 3, now: () => now, retentionMs: 7 * 24 * 60 * 60 * 1_000, storage,
    });
    for (let index = 0; index < 5; index += 1) {
      outbox.record({
        bootId: ids.boot1, context, diagnosticId: Object.values(ids).filter((id) => id.startsWith('2'))[index]!, kind: 'ERROR',
        observedAt: index === 0 ? '2026-09-30T14:04:00.000Z' : new Date(now.getTime() + index).toISOString(),
        sequence: index + 1, snapshot,
      });
    }
    const batch = outbox.buildBatch({ batchId: ids.batch1, bootId: ids.boot1, liveContext: context, liveSnapshot: snapshot, maxBytes: 4_096, maxRecords: 2 });
    assert.deepEqual(batch.records.map(({ diagnosticId }) => diagnosticId), [ids.diag2, ids.diag4]);
    assert.equal(batch.discardedRecordCount, 2);
    assert.ok(JSON.stringify(batch).length <= 4_096);
  });

  it('bounds credential and send failures and backs off without a busy loop', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: { get: async () => null, remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      outbox,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      random: () => 0.5,
      register: async () => { throw new Error('offline'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      cancel: () => undefined,
      send: async () => { throw new Error('unreachable'); },
    });

    await transport.flush(() => ({ bootId: ids.boot1, context, snapshot }));
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.delayMs, 5_000);
    assert.equal(outbox.listPending().length, 1);
  });

  it('sends fresh live state separately from replay so old history cannot replace current evidence', async () => {
    const storage = memoryStorage();
    const oldSnapshot = { ...snapshot, lifecycle: 'BACKGROUND' as const, network: 'OFFLINE' as const };
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-09-30T14:05:00.000Z', sequence: 1, snapshot: oldSnapshot });
    const envelope = outbox.buildBatch({ batchId: ids.batch1, bootId: ids.boot2, liveContext: context, liveSnapshot: snapshot });
    assert.equal(envelope.liveSnapshot.network, 'ONLINE');
    assert.equal(envelope.records[0]?.snapshot.network, 'OFFLINE');
    assert.equal(envelope.bootId, ids.boot2);
  });

  it('retains canonical ISO session generation separately from numeric assignment generation', () => {
    assert.deepEqual(sanitizeDriverDiagnosticContext({
      ...context,
      assignmentGeneration: '12',
      sessionGeneration: '2026-10-01T13:00:00.000Z',
    }), {
      ...context,
      assignmentGeneration: '12',
      sessionGeneration: '2026-10-01T13:00:00.000Z',
    });
  });

  it('coalesces urgent storms and keeps failure backoff in force', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage: memoryStorage() });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      outbox,
      random: () => 0.5,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async () => { throw new Error('offline'); },
    });
    const live = () => ({ bootId: ids.boot1, context, snapshot });

    transport.requestImmediate(live);
    transport.requestImmediate(live);
    transport.requestImmediate(live);
    assert.deepEqual(schedules.map(({ delayMs }) => delayMs), [0]);
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(schedules.map(({ delayMs }) => delayMs), [5_000]);
    transport.requestImmediate(live);
    transport.requestImmediate(live);
    assert.deepEqual(schedules.map(({ delayMs }) => delayMs), [5_000]);
  });

  it('rebuilds live evidence at retry time and does not schedule after stop', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const firstSend = deferred<{ acceptedDiagnosticIds: string[]; rejectedDiagnostics: never[]; serverReceivedAt: string }>();
    const sentNetworks: string[] = [];
    let currentSnapshot: DriverDiagnosticSnapshot = { ...snapshot, network: 'OFFLINE' };
    let clock = new Date('2026-10-01T14:05:00.000Z');
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    let sends = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      random: () => 0.5,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async ({ envelope }) => {
        sends += 1;
        sentNetworks.push(envelope.liveSnapshot.network);
        if (sends === 1) throw new Error('offline');
        return firstSend.promise;
      },
    });
    const live = () => ({ bootId: ids.boot1, context, snapshot: currentSnapshot });

    await transport.flush(live);
    assert.equal(schedules[0]?.delayMs, 5_000);
    currentSnapshot = { ...snapshot, network: 'ONLINE' };
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sentNetworks, ['OFFLINE', 'ONLINE']);
    transport.stop();
    firstSend.resolve({ acceptedDiagnosticIds: [ids.diag1], rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:05.000Z' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outbox.listPending().length, 1);
    assert.deepEqual(schedules, []);
  });

  it('retries the same diagnostic id after a hung response without accepting the late response', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const timeouts: { active: boolean; expire: () => void }[] = [];
    const lateResponse = deferred<{ acceptedDiagnosticIds: string[]; rejectedDiagnostics: never[]; serverReceivedAt: string }>();
    let clock = new Date('2026-10-01T14:05:00.000Z');
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: clock.toISOString(), sequence: 1, snapshot });
    const sentIds: string[][] = [];
    let sends = 0;
    const transport = createDriverDiagnosticTransport({
      attemptTimeoutMs: 100,
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      cancelAttemptTimeout: (handle) => { (handle as { active: boolean }).active = false; },
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      random: () => 0.5,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      scheduleAttemptTimeout: (expire) => {
        const handle = { active: true, expire };
        timeouts.push(handle);
        return handle;
      },
      send: async ({ envelope }) => {
        sends += 1;
        sentIds.push(envelope.records.map(({ diagnosticId }) => diagnosticId));
        return sends === 1
          ? lateResponse.promise
          : { acceptedDiagnosticIds: [ids.diag1], rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() };
      },
    });

    const first = transport.flush(() => ({ bootId: ids.boot1, context, snapshot }));
    await new Promise((resolve) => setImmediate(resolve));
    timeouts.find(({ active }) => active)?.expire();
    assert.equal(await first, false);
    assert.equal(schedules[0]?.delayMs, 5_000);
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sentIds, [[ids.diag1], [ids.diag1]]);
    assert.equal(outbox.listPending().length, 0);
    lateResponse.resolve({ acceptedDiagnosticIds: [ids.diag1], rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outbox.listPending().length, 0);
    transport.stop();
  });

  it('sends a coalesced follow-up when state changes during an in-flight diagnostic request', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const firstResponse = deferred<{ acceptedDiagnosticIds: string[]; rejectedDiagnostics: never[]; serverReceivedAt: string }>();
    let clock = new Date('2026-10-01T14:05:00.000Z');
    let currentSnapshot: DriverDiagnosticSnapshot = { ...snapshot, network: 'OFFLINE' };
    const sentNetworks: string[] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    let sends = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async ({ envelope }) => {
        sends += 1;
        sentNetworks.push(envelope.liveSnapshot.network);
        return sends === 1
          ? firstResponse.promise
          : { acceptedDiagnosticIds: [], rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() };
      },
    });
    const live = () => ({ bootId: ids.boot1, context, snapshot: currentSnapshot });

    transport.requestImmediate(live);
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    currentSnapshot = { ...snapshot, network: 'ONLINE' };
    transport.requestImmediate(live);
    firstResponse.resolve({ acceptedDiagnosticIds: [], rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(schedules[0]?.delayMs, 5_000);
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sentNetworks, ['OFFLINE', 'ONLINE']);
    transport.stop();
  });

  it('drains more than one bounded batch without waiting for another app heartbeat', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    let clock = new Date('2026-10-01T14:05:00.000Z');
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    for (let index = 1; index <= 55; index += 1) {
      outbox.record({
        bootId: ids.boot1,
        context,
        diagnosticId: `50000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        kind: 'ERROR',
        observedAt: clock.toISOString(),
        sequence: index,
        snapshot,
      });
    }
    const batchSizes: number[] = [];
    let batchSequence = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => `60000000-0000-4000-8000-${(++batchSequence).toString(16).padStart(12, '0')}`,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async ({ envelope }) => {
        batchSizes.push(envelope.records.length);
        return { acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId), rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() };
      },
    });
    const live = () => ({ bootId: ids.boot1, context, snapshot });

    assert.equal(await transport.flush(live), true);
    const firstBatchSize = batchSizes[0]!;
    assert.ok(firstBatchSize > 0 && firstBatchSize <= 50);
    assert.equal(outbox.listPending().length, 55 - firstBatchSize);
    assert.equal(schedules[0]?.delayMs, 5_000);
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(batchSizes.reduce((total, size) => total + size, 0), 55);
    assert.equal(outbox.listPending().length, 0);
    transport.stop();
  });

  it('backs off when a non-empty diagnostic batch receives an empty ACK', async () => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage: memoryStorage() });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      outbox,
      random: () => 0.5,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async () => ({ acceptedDiagnosticIds: [], rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:00.000Z' }),
    });

    assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), false);
    assert.equal(outbox.listPending().length, 1);
    assert.deepEqual(schedules.map(({ delayMs }) => delayMs), [5_000]);
    transport.stop();
  });

  it('quarantines only permanent rejections from the sent batch and keeps replay moving', async (test) => {
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag2, kind: 'STATE_CHANGE', observedAt: '2026-10-01T14:05:01.000Z', sequence: 2, snapshot });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => new Date('2026-10-01T14:05:02.000Z'),
      outbox,
      register: async () => { throw new Error('unused'); },
      send: async () => ({
        acceptedDiagnosticIds: [ids.diag2],
        rejectedDiagnostics: [rejection('INVALID_RECORD')],
        serverReceivedAt: '2026-10-01T14:05:02.000Z',
      }),
    });
    test.after(() => transport.stop());

    assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), true);
    assert.deepEqual(outbox.listPending(), []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(storage.quarantined.map((entry) => {
      const value = entry as { code: string; quarantinedAt: string; record: DriverDiagnosticRecord };
      return { code: value.code, diagnosticId: value.record.diagnosticId, quarantinedAt: value.quarantinedAt };
    }), [{ code: 'INVALID_RECORD', diagnosticId: ids.diag1, quarantinedAt: '2026-10-01T14:05:02.000Z' }]);
  });

  it('applies none of a response containing unknown, foreign, duplicate, or overlapping outcomes', async (test) => {
    const invalidResponses = [
      { acceptedDiagnosticIds: [], rejectedDiagnostics: [rejection('FUTURE_REJECTION')] },
      { acceptedDiagnosticIds: [ids.diag1], rejectedDiagnostics: [rejection('INVALID_RECORD')] },
      { acceptedDiagnosticIds: [ids.diag1, ids.diag1], rejectedDiagnostics: [] },
      { acceptedDiagnosticIds: [], rejectedDiagnostics: [rejection('INVALID_RECORD', ids.diag3)] },
      { acceptedDiagnosticIds: [], rejectedDiagnostics: [null as never] },
    ];
    for (const response of invalidResponses) {
      const storage = memoryStorage();
      const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
      outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
      const transport = createDriverDiagnosticTransport({
        batchIdFactory: () => ids.batch1,
        credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
        deviceInstanceHash: context.deviceInstanceHash,
        outbox,
        register: async () => { throw new Error('unused'); },
        send: async () => ({ ...response, serverReceivedAt: '2026-10-01T14:05:02.000Z' }),
      });
      test.after(() => transport.stop());
      assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), false);
      assert.deepEqual(outbox.listPending().map(({ diagnosticId }) => diagnosticId), [ids.diag1]);
      assert.deepEqual(storage.quarantined, []);
    }
  });

  it('durably quarantines a rejected record so restart does not replay it', async () => {
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    outbox.quarantine([{ code: 'DIAGNOSTIC_ID_CONFLICT', diagnosticId: ids.diag1 }], 'account-a', '2026-10-01T14:05:02.000Z');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const restarted = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage });
    await restarted.hydrate();
    assert.deepEqual(restarted.listPending(), []);
    assert.equal(storage.quarantined.length, 1);
  });

  it('drains after a full bounded permanent-rejection batch without head-of-line blocking', async (test) => {
    const schedules: { delayMs: number; run: () => void }[] = [];
    let clock = new Date('2026-10-01T14:05:00.000Z');
    const storage = memoryStorage();
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage });
    for (let index = 1; index <= 52; index += 1) {
      outbox.record({
        bootId: ids.boot1,
        context,
        diagnosticId: `90000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        kind: 'ERROR',
        observedAt: clock.toISOString(),
        sequence: index,
        snapshot,
      });
    }
    let batchSequence = 0;
    let sends = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => `91000000-0000-4000-8000-${(++batchSequence).toString(16).padStart(12, '0')}`,
      cancel: () => undefined,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => { schedules.push({ delayMs, run }); return run; },
      send: async ({ envelope }) => {
        sends += 1;
        return sends === 1
          ? {
              acceptedDiagnosticIds: [],
              rejectedDiagnostics: envelope.records.map(({ diagnosticId }) => rejection('ROUTE_ACCESS_REVOKED', diagnosticId)),
              serverReceivedAt: clock.toISOString(),
            }
          : {
              acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId),
              rejectedDiagnostics: [],
              serverReceivedAt: clock.toISOString(),
            };
      },
    });
    test.after(() => transport.stop());

    assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), true);
    const firstBatchSize = 52 - outbox.listPending().length;
    assert.ok(firstBatchSize > 0 && firstBatchSize <= 50);
    assert.equal(outbox.listPending().length, 52 - firstBatchSize);
    assert.equal(schedules[0]?.delayMs, 5_000);
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outbox.listPending().length, 0);
    assert.equal(storage.quarantined.length, firstBatchSize);
  });

  it('conditionally removes a diagnostic credential that finishes persisting after stop', async () => {
    const setGate = deferred<void>();
    const removals: { owner: string; token?: string }[] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage: memoryStorage() });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      credentialStore: {
        get: async () => null,
        remove: async (owner, token) => { removals.push({ owner, ...(token === undefined ? {} : { token }) }); },
        set: async () => setGate.promise,
      },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      outbox,
      register: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'stale-token' }),
      send: async () => ({ acceptedDiagnosticIds: [], rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:00.000Z' }),
    });

    assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), true);
    transport.stop();
    setGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(removals, [{ owner: 'account-a', token: 'stale-token' }]);
  });

  it('recovers from a cached diagnostic credential 401 by conditionally removing it and registering a fresh credential', async (test) => {
    const schedules: { active: boolean; delayMs: number; run: () => void }[] = [];
    let clock = new Date('2026-10-01T14:05:00.000Z');
    let storedCredential: { expiresAt: string; token: string } | null = {
      expiresAt: '2026-10-02T14:00:00.000Z',
      token: 'stale-token',
    };
    const removals: { owner: string; token?: string }[] = [];
    const sentTokens: string[] = [];
    let registrations = 0;
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: clock.toISOString(), sequence: 1, snapshot });
    let batchSequence = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => `72000000-0000-4000-8000-${(++batchSequence).toString(16).padStart(12, '0')}`,
      cancel: (handle) => { (handle as { active: boolean }).active = false; },
      credentialStore: {
        get: async () => storedCredential,
        remove: async (owner, token) => {
          removals.push({ owner, ...(token === undefined ? {} : { token }) });
          if (token === undefined || storedCredential?.token === token) storedCredential = null;
        },
        set: async (_owner, credential) => { storedCredential = credential; },
      },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      random: () => 0.5,
      register: async () => {
        registrations += 1;
        return { expiresAt: '2026-10-02T14:05:00.000Z', token: 'fresh-token' };
      },
      schedule: (run, delayMs) => {
        const handle = { active: true, delayMs, run };
        schedules.push(handle);
        return handle;
      },
      send: async ({ credentialToken, envelope }) => {
        sentTokens.push(credentialToken);
        if (credentialToken === 'stale-token') throw Object.assign(new Error('unauthorized'), { status: 401 });
        return {
          acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId),
          rejectedDiagnostics: [],
          serverReceivedAt: clock.toISOString(),
        };
      },
    });
    test.after(() => transport.stop());

    assert.equal(await transport.flush(() => ({ bootId: ids.boot1, context, snapshot })), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(removals, [{ owner: 'account-a', token: 'stale-token' }]);
    assert.equal(storedCredential, null);
    assert.deepEqual(schedules.filter(({ active }) => active).map(({ delayMs }) => delayMs), [5_000]);

    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.find(({ active }) => active)?.run();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registrations, 1);
    assert.deepEqual(sentTokens, ['stale-token', 'fresh-token']);
    assert.equal((storedCredential as { token: string } | null)?.token, 'fresh-token');
    assert.deepEqual(outbox.listPending(), []);
  });

  it('waits for an older in-flight envelope then sends one fresh final envelope without the rate delay', async () => {
    const firstResponse = deferred<{ acceptedDiagnosticIds: string[]; rejectedDiagnostics: never[]; serverReceivedAt: string }>();
    const sentIds: string[][] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage: memoryStorage() });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    let sends = 0;
    let batchSequence = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => `70000000-0000-4000-8000-${(++batchSequence).toString(16).padStart(12, '0')}`,
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      outbox,
      register: async () => { throw new Error('unused'); },
      send: async ({ envelope }) => {
        sends += 1;
        sentIds.push(envelope.records.map(({ diagnosticId }) => diagnosticId));
        return sends === 1
          ? firstResponse.promise
          : { acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId), rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:00.000Z' };
      },
    });
    const live = () => ({ bootId: ids.boot1, context, snapshot });

    const first = transport.flush(live);
    await new Promise((resolve) => setImmediate(resolve));
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag2, kind: 'ERROR', observedAt: '2026-10-01T14:05:01.000Z', sequence: 2, snapshot });
    const final = transport.flushBeforeDetach(live);
    firstResponse.resolve({ acceptedDiagnosticIds: [ids.diag1], rejectedDiagnostics: [], serverReceivedAt: '2026-10-01T14:05:01.000Z' });
    assert.equal(await first, true);
    assert.equal(await final, true);
    assert.deepEqual(sentIds, [[ids.diag1], [ids.diag2]]);
    transport.stop();
  });

  it('wakes credential registration after authentication recovers while preserving the minimum interval', async () => {
    const schedules: { active: boolean; delayMs: number; run: () => void }[] = [];
    let authenticated = false;
    let clock = new Date('2026-10-01T14:05:00.000Z');
    let registrations = 0;
    let sends = 0;
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', now: () => clock, storage: memoryStorage() });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: (handle) => { (handle as { active: boolean }).active = false; },
      credentialStore: { get: async () => null, remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      random: () => 0.5,
      register: async () => {
        registrations += 1;
        if (!authenticated) throw new Error('AUTH_CREDENTIAL_MISSING');
        return { expiresAt: '2026-10-02T14:00:00.000Z', token: 'diagnostic-token' };
      },
      schedule: (run, delayMs) => {
        const handle = { active: true, delayMs, run };
        schedules.push(handle);
        return handle;
      },
      send: async () => {
        sends += 1;
        return { acceptedDiagnosticIds: [], rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() };
      },
    });
    const recorder = createDriverDiagnosticRecorder({
      bootId: ids.boot1,
      context,
      idFactory: () => ids.diag1,
      now: () => clock,
      outbox,
      snapshot: () => snapshot,
      transport,
    });

    assert.equal(await recorder.flush(), false);
    assert.equal(registrations, 1);
    assert.deepEqual(schedules.filter(({ active }) => active).map(({ delayMs }) => delayMs), [5_000]);
    authenticated = true;
    recorder.notifyAuthenticated();
    assert.deepEqual(schedules.filter(({ active }) => active).map(({ delayMs }) => delayMs), [5_000]);
    clock = new Date('2026-10-01T14:05:05.000Z');
    schedules.find(({ active }) => active)?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registrations, 2);
    assert.equal(sends, 1);
    transport.stop();
  });

  it('accepts an external sequence supplier so route rebinds in one boot stay monotonic', () => {
    const schedules: unknown[] = [];
    const outbox = createDriverDiagnosticOutbox({ accountOwnerHash: 'account-a', storage: memoryStorage() });
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => ids.batch1,
      cancel: () => undefined,
      credentialStore: { get: async () => null, remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      outbox,
      register: async () => { throw new Error('unused'); },
      schedule: (run) => { schedules.push(run); return run; },
      send: async () => { throw new Error('unused'); },
    });
    const generatedIds = [ids.diag1, ids.diag2];
    let globalSequence = 40;
    const recorder = createDriverDiagnosticRecorder({
      bootId: ids.boot1,
      context,
      idFactory: () => generatedIds.shift()!,
      nextSequence: () => ++globalSequence,
      outbox,
      snapshot: () => snapshot,
      transport,
    });

    recorder.emitStateChange();
    recorder.emitStateChange();
    assert.deepEqual(outbox.listPending().map(({ sequence }) => sequence), [41, 42]);
    assert.equal(schedules.length, 1);
    transport.stop();
  });

  it('emits one storage failure transition and recovers only after the failed operation class succeeds', async () => {
    let appendFails = true;
    const transitions: string[] = [];
    const storage: DiagnosticStorage = {
      append: async () => { if (appendFails) throw new Error('append failed'); },
      quarantine: async () => undefined,
      read: async () => [],
      remove: async () => undefined,
    };
    const outbox = createDriverDiagnosticOutbox({
      accountOwnerHash: 'account-a',
      onStorageStateChange: (state) => { transitions.push(state.kind); },
      storage,
    });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: '2026-10-01T14:05:00.000Z', sequence: 1, snapshot });
    await new Promise((resolve) => setImmediate(resolve));
    outbox.acknowledge([ids.diag1], 'account-a');
    await outbox.hydrate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(transitions, ['FAILED']);

    appendFails = false;
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag2, kind: 'STATE_CHANGE', observedAt: '2026-10-01T14:05:01.000Z', sequence: 2, snapshot });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(transitions, ['FAILED', 'RECOVERED']);
  });

  it('retains concurrent append and remove failures until both operation classes recover', async () => {
    let appendFails = true;
    let removeFails = true;
    let clock = new Date('2026-10-01T14:05:00.000Z');
    const transitions: string[] = [];
    const outbox = createDriverDiagnosticOutbox({
      accountOwnerHash: 'account-a',
      now: () => clock,
      onStorageStateChange: (state) => { transitions.push(state.kind); },
      storage: {
        append: async () => { if (appendFails) throw new Error('append failed'); },
        quarantine: async () => undefined,
        read: async () => [],
        remove: async () => { if (removeFails) throw new Error('remove failed'); },
      },
    });
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag1, kind: 'ERROR', observedAt: clock.toISOString(), sequence: 1, snapshot });
    await new Promise((resolve) => setImmediate(resolve));
    clock = new Date('2026-10-01T14:05:01.000Z');
    outbox.acknowledge([ids.diag1], 'account-a');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(transitions, ['FAILED']);
    assert.equal(outbox.getStorageFailure()?.since, '2026-10-01T14:05:00.000Z');

    appendFails = false;
    outbox.record({ bootId: ids.boot1, context, diagnosticId: ids.diag2, kind: 'STATE_CHANGE', observedAt: clock.toISOString(), sequence: 2, snapshot });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(transitions, ['FAILED']);
    assert.equal(outbox.getStorageFailure()?.since, '2026-10-01T14:05:01.000Z');

    removeFails = false;
    outbox.acknowledge([ids.diag2], 'account-a');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(transitions, ['FAILED', 'RECOVERED']);
    assert.equal(outbox.getStorageFailure(), null);
  });

  it('sends a diagnostic storage failure immediately after a stalled append times out and sends recovery once', async () => {
    const appendGate = deferred<void>();
    const storageTimeouts: { active: boolean; expire: () => void }[] = [];
    const transportSchedules: { active: boolean; delayMs: number; run: () => void }[] = [];
    const envelopes: DriverDiagnosticEnvelope[] = [];
    let clock = new Date('2026-10-01T14:05:00.000Z');
    let recorder!: ReturnType<typeof createDriverDiagnosticRecorder>;
    const outbox = createDriverDiagnosticOutbox({
      accountOwnerHash: 'account-a',
      cancelTimeout: (handle) => { (handle as { active: boolean }).active = false; },
      now: () => clock,
      onStorageStateChange: (state) => {
        if (state.kind === 'FAILED') recorder.emitError({ blockers: [] });
        else recorder.emitStateChange();
      },
      scheduleTimeout: (expire) => {
        const handle = { active: true, expire };
        storageTimeouts.push(handle);
        return handle;
      },
      storage: {
        append: async () => appendGate.promise,
        quarantine: async () => undefined,
        read: async () => [],
        remove: async () => undefined,
      },
    });
    let batchSequence = 0;
    const transport = createDriverDiagnosticTransport({
      batchIdFactory: () => `80000000-0000-4000-8000-${(++batchSequence).toString(16).padStart(12, '0')}`,
      cancel: (handle) => { (handle as { active: boolean }).active = false; },
      credentialStore: { get: async () => ({ expiresAt: '2026-10-02T14:00:00.000Z', token: 'token' }), remove: async () => undefined, set: async () => undefined },
      deviceInstanceHash: context.deviceInstanceHash,
      now: () => clock,
      outbox,
      register: async () => { throw new Error('unused'); },
      schedule: (run, delayMs) => {
        const handle = { active: true, delayMs, run };
        transportSchedules.push(handle);
        return handle;
      },
      send: async ({ envelope }) => {
        envelopes.push(envelope);
        return { acceptedDiagnosticIds: envelope.records.map(({ diagnosticId }) => diagnosticId), rejectedDiagnostics: [], serverReceivedAt: clock.toISOString() };
      },
    });
    const generatedIds = [ids.diag1, ids.diag2, ids.diag3];
    recorder = createDriverDiagnosticRecorder({
      bootId: ids.boot1,
      context,
      idFactory: () => generatedIds.shift()!,
      now: () => clock,
      outbox,
      snapshot: () => snapshot,
      transport,
    });

    recorder.emitStateChange();
    assert.equal(await recorder.flush(), true);
    assert.equal(envelopes.length, 1);
    clock = new Date('2026-10-01T14:05:05.000Z');
    storageTimeouts.find(({ active }) => active)?.expire();
    await new Promise((resolve) => setImmediate(resolve));
    const failureSend = transportSchedules.find(({ active }) => active);
    if (failureSend !== undefined) {
      failureSend.active = false;
      failureSend.run();
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(envelopes.length, 2);
    assert.equal(envelopes[1]?.liveSnapshot.blockers?.[0]?.reason, 'DIAGNOSTIC_STORAGE_FAILED');

    storageTimeouts.find(({ active }) => active)?.expire();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(transportSchedules.filter(({ active }) => active).length, 0);

    appendGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(transportSchedules.filter(({ active }) => active).length, 1);
    clock = new Date('2026-10-01T14:05:10.000Z');
    const recoverySend = transportSchedules.find(({ active }) => active);
    if (recoverySend !== undefined) {
      recoverySend.active = false;
      recoverySend.run();
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(envelopes.length, 3);
    assert.equal(envelopes[2]?.liveSnapshot.blockers?.some(({ reason }) => reason === 'DIAGNOSTIC_STORAGE_FAILED') ?? false, false);
    transport.stop();
  });
});
