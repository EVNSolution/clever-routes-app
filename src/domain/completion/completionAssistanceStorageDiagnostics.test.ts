import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  captureDriverDiagnosticOperationObserver,
  captureDriverDiagnosticOperationObserverForOwner,
  installDriverDiagnosticObserver,
  type DriverDiagnosticObservation,
  type DriverDiagnosticOperationMetadata,
  type DriverDiagnosticOperationObserver,
} from '../diagnostics/driverDiagnosticObservation';
import { createDriverDiagnosticProjection } from '../../app/driverDiagnosticProjection';
import type { CompletionAssistanceRawStorage } from './completionAssistanceSync';
import { observeCompletionAssistanceStorage } from './completionAssistanceStorageDiagnostics';

function createStorage(overrides: Partial<CompletionAssistanceRawStorage> = {}): CompletionAssistanceRawStorage {
  return {
    readCompletionAssistanceState: async () => null,
    removeCompletionAssistanceState: async () => undefined,
    updateCompletionAssistanceState: async (_owner, mutate) => mutate(null),
    ...overrides,
  };
}

describe('completion assistance storage diagnostics', () => {
  it('observes read, update, and remove under distinct safe storage identities', async () => {
    const observed: DriverDiagnosticOperationMetadata[] = [];
    const capturedOwners: string[] = [];
    let sequence = 0;
    const observe: DriverDiagnosticOperationObserver = async (metadata, operation) => {
      observed.push(metadata);
      return operation();
    };
    const storage = observeCompletionAssistanceStorage(
      createStorage(),
      (owner) => { capturedOwners.push(owner); return observe; },
      () => `10000000-0000-4000-8000-${(++sequence).toString().padStart(12, '0')}`,
    );

    await storage.readCompletionAssistanceState('not-emitted-owner');
    await storage.updateCompletionAssistanceState('not-emitted-owner', () => 'coordinates-not-emitted');
    await storage.removeCompletionAssistanceState('not-emitted-owner');

    assert.deepEqual(observed, [
      { clientEventId: 'completion-assistance-read:10000000-0000-4000-8000-000000000001', operation: 'STORAGE_READ' },
      { clientEventId: 'completion-assistance-write:10000000-0000-4000-8000-000000000002', operation: 'STORAGE_WRITE' },
      { clientEventId: 'completion-assistance-remove:10000000-0000-4000-8000-000000000003', operation: 'STORAGE_WRITE' },
    ]);
    assert.deepEqual(capturedOwners, ['not-emitted-owner', 'not-emitted-owner', 'not-emitted-owner']);
    assert.doesNotMatch(JSON.stringify(observed), /not-emitted-owner|coordinates-not-emitted/u);
  });

  it('rethrows the original storage failure after diagnostic observation', async () => {
    const failure = new Error('sensitive native database message');
    const observed: DriverDiagnosticOperationMetadata[] = [];
    const storage = observeCompletionAssistanceStorage(
      createStorage({ updateCompletionAssistanceState: async () => { throw failure; } }),
      () => async (metadata, operation) => { observed.push(metadata); return operation(); },
      () => '20000000-0000-4000-8000-000000000001',
    );

    await assert.rejects(
      storage.updateCompletionAssistanceState('not-emitted-owner', () => 'not-emitted-payload'),
      (error) => error === failure,
    );
    assert.deepEqual(observed, [
      { clientEventId: 'completion-assistance-write:20000000-0000-4000-8000-000000000001', operation: 'STORAGE_WRITE' },
    ]);
  });

  it('emits a safe write failure and operation-specific recovery without payload data', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { observations.push(observation); });
    let failWrite = true;
    let sequence = 0;
    const storage = observeCompletionAssistanceStorage(
      createStorage({
        updateCompletionAssistanceState: async (_owner, mutate) => {
          if (failWrite) throw new Error('customer coordinates and native database path');
          return mutate(null);
        },
      }),
      () => captureDriverDiagnosticOperationObserver(),
      () => `30000000-0000-4000-8000-${(++sequence).toString().padStart(12, '0')}`,
    );

    try {
      await assert.rejects(
        storage.updateCompletionAssistanceState('owner-not-emitted', () => 'coordinates-not-emitted'),
      );
      await storage.readCompletionAssistanceState('owner-not-emitted');
      failWrite = false;
      await storage.updateCompletionAssistanceState('owner-not-emitted', () => 'coordinates-not-emitted');
    } finally {
      installDriverDiagnosticObserver(null);
    }

    const operationEvents = observations.filter((event) => event.kind === 'OPERATION');
    assert.equal(operationEvents.some((event) => (
      event.phase === 'FAILED'
      && event.clientEventId === 'completion-assistance-write:30000000-0000-4000-8000-000000000001'
      && event.reasonCode === 'STORAGE_WRITE_FAILED'
    )), true);
    assert.equal(operationEvents.some((event) => (
      event.phase === 'SUCCEEDED' && event.clientEventId === 'completion-assistance-read:30000000-0000-4000-8000-000000000002'
    )), true);
    assert.equal(operationEvents.some((event) => (
      event.phase === 'SUCCEEDED' && event.clientEventId === 'completion-assistance-write:30000000-0000-4000-8000-000000000003'
    )), true);
    assert.doesNotMatch(JSON.stringify(observations), /customer|coordinates|database path|owner-not-emitted/u);
  });

  it('keeps a hung write blocker when a concurrent write succeeds and clears it on late settlement', async () => {
    const projection = createDriverDiagnosticProjection(() => new Date('2026-10-01T14:05:00.000Z'));
    const watchdogs = new Map<number, () => void>();
    let timerSequence = 0;
    let operationSequence = 0;
    let writeSequence = 0;
    let settleFirst!: (value: string) => void;
    installDriverDiagnosticObserver((observation) => { projection.observe(observation); }, {
      clearTimeout: (handle) => { watchdogs.delete(handle as number); },
      now: () => new Date('2026-10-01T14:05:00.000Z'),
      setTimeout: (callback) => {
        timerSequence += 1;
        watchdogs.set(timerSequence, callback);
        return timerSequence;
      },
    });
    const storage = observeCompletionAssistanceStorage(
      createStorage({
        updateCompletionAssistanceState: async (_owner, mutate) => {
          writeSequence += 1;
          if (writeSequence === 1) return new Promise<string>((resolve) => { settleFirst = resolve; });
          return mutate(null);
        },
      }),
      () => captureDriverDiagnosticOperationObserver(),
      () => `40000000-0000-4000-8000-${(++operationSequence).toString().padStart(12, '0')}`,
    );

    try {
      const first = storage.updateCompletionAssistanceState('owner-a', () => 'first');
      await Promise.resolve();
      watchdogs.get(1)?.();
      await storage.updateCompletionAssistanceState('owner-a', () => 'second');

      assert.deepEqual(projection.snapshot().blockers?.map(({ clientEventId, reason }) => ({ clientEventId, reason })), [{
        clientEventId: 'completion-assistance-write:40000000-0000-4000-8000-000000000001',
        reason: 'STORAGE_OPERATION_TIMEOUT',
      }]);

      settleFirst('first');
      await first;
      assert.deepEqual(projection.snapshot().blockers, []);
    } finally {
      installDriverDiagnosticObserver(null);
    }
  });

  it('passes through an old-owner invocation and drops a captured late outcome after owner switch', async () => {
    const oldObservations: DriverDiagnosticObservation[] = [];
    const newObservations: DriverDiagnosticObservation[] = [];
    let activeOwner: string | null = 'owner-a';
    let settle!: (value: string) => void;
    installDriverDiagnosticObserver((observation) => { oldObservations.push(observation); });
    const storage = observeCompletionAssistanceStorage(
      createStorage({
        updateCompletionAssistanceState: async () => new Promise<string>((resolve) => { settle = resolve; }),
      }),
      (owner) => captureDriverDiagnosticOperationObserverForOwner(owner, activeOwner),
      () => '50000000-0000-4000-8000-000000000001',
    );

    activeOwner = 'owner-b';
    assert.equal(await storage.readCompletionAssistanceState('owner-a'), null);
    assert.equal(oldObservations.length, 0);

    activeOwner = 'owner-a';
    const pending = storage.updateCompletionAssistanceState('owner-a', () => 'late');
    await Promise.resolve();
    activeOwner = 'owner-b';
    installDriverDiagnosticObserver((observation) => { newObservations.push(observation); });
    settle('late');
    await pending;

    assert.deepEqual(oldObservations.map((event) => event.kind === 'OPERATION' ? event.phase : event.kind), ['STARTED']);
    assert.deepEqual(newObservations, []);
    installDriverDiagnosticObserver(null);
  });

  it('labels completion state read rejection as a read failure', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      clearTimeout: () => undefined,
      setTimeout: () => 1,
    });
    const storage = observeCompletionAssistanceStorage(
      createStorage({ readCompletionAssistanceState: async () => { throw new Error('private read error'); } }),
      () => captureDriverDiagnosticOperationObserver(),
      () => '60000000-0000-4000-8000-000000000001',
    );

    try {
      await assert.rejects(storage.readCompletionAssistanceState('owner-a'));
    } finally {
      installDriverDiagnosticObserver(null);
    }

    const failed = observations.find((event) => event.kind === 'OPERATION' && event.phase === 'FAILED');
    assert.equal(failed?.kind === 'OPERATION' ? failed.operation : undefined, 'STORAGE_READ');
    assert.equal(failed?.kind === 'OPERATION' ? failed.reasonCode : undefined, 'STORAGE_READ_FAILED');
    assert.doesNotMatch(JSON.stringify(observations), /private read error|owner-a/u);
  });
});
