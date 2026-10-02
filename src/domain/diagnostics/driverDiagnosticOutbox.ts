import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import {
  DRIVER_DIAGNOSTIC_SCHEMA_VERSION,
  isSafeDiagnosticUuid,
  sanitizeDriverDiagnosticRecord,
  sanitizeDriverDiagnosticContext,
  sanitizeDriverDiagnosticSnapshot,
  type DriverDiagnosticEnvelope,
  type DriverDiagnosticContext,
  type DriverDiagnosticRecord,
  type DriverDiagnosticQuarantineEntry,
  type DriverDiagnosticSnapshot,
} from './driverDiagnosticContract';

export type DiagnosticStorage = {
  append(accountOwnerHash: string, records: readonly DriverDiagnosticRecord[]): Promise<void>;
  quarantine(accountOwnerHash: string, entries: readonly DriverDiagnosticQuarantineEntry[]): Promise<void>;
  read(accountOwnerHash: string): Promise<unknown[]>;
  remove(accountOwnerHash: string, diagnosticIds: readonly string[]): Promise<void>;
};

export type DriverDiagnosticOutbox = ReturnType<typeof createDriverDiagnosticOutbox>;

export type DiagnosticStorageState =
  | { kind: 'FAILED'; reason: 'DIAGNOSTIC_STORAGE_FAILED'; since: string }
  | { kind: 'RECOVERED'; observedAt: string };

const defaultRetentionMs = 7 * 24 * 60 * 60 * 1_000;
const defaultMaxRecords = 1_000;
const defaultOperationTimeoutMs = 5_000;

export function createDriverDiagnosticOutbox(input: {
  accountOwnerHash: string;
  cancelTimeout?: (handle: unknown) => void;
  maxRecords?: number;
  now?: () => Date;
  operationTimeoutMs?: number;
  onStorageStateChange?: (state: DiagnosticStorageState) => void;
  retentionMs?: number;
  scheduleTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  storage: DiagnosticStorage;
}) {
  const now = input.now ?? (() => new Date());
  const maxRecords = Math.max(1, input.maxRecords ?? defaultMaxRecords);
  const retentionMs = input.retentionMs ?? defaultRetentionMs;
  const timeoutOptions = {
    ...(input.cancelTimeout === undefined ? {} : { cancel: input.cancelTimeout }),
    ...(input.scheduleTimeout === undefined ? {} : { schedule: input.scheduleTimeout }),
    timeoutMs: input.operationTimeoutMs ?? defaultOperationTimeoutMs,
  };
  let accountOwnerHash = input.accountOwnerHash;
  let generation = 0;
  let discardedRecordCount = 0;
  let records: DriverDiagnosticRecord[] = [];
  const acknowledged = new Set<string>();
  const acknowledgedOrder: string[] = [];
  const storageMutationChains = new Map<string, Promise<void>>();
  type StorageOperation = 'APPEND' | 'QUARANTINE' | 'READ' | 'REMOVE';
  const storageFailures = new Map<StorageOperation, string>();

  function getStorageFailure() {
    if (storageFailures.size === 0) return null;
    return {
      reason: 'DIAGNOSTIC_STORAGE_FAILED' as const,
      since: [...storageFailures.values()].sort()[0]!,
    };
  }

  function notifyStorageStateChange(state: DiagnosticStorageState) {
    try {
      input.onStorageStateChange?.(state);
    } catch {
      // Diagnostic observation must never break storage or business work.
    }
  }

  function clearStorageFailure(
    owner: string,
    ownerGeneration: number,
    operation: StorageOperation,
  ) {
    if (
      generation !== ownerGeneration || accountOwnerHash !== owner
      || !storageFailures.has(operation)
    ) return;
    storageFailures.delete(operation);
    if (storageFailures.size === 0) {
      notifyStorageStateChange({ kind: 'RECOVERED', observedAt: now().toISOString() });
    }
  }

  function prune() {
    const cutoff = now().getTime() - retentionMs;
    const removedIds: string[] = [];
    const retained = records.filter((record) => {
      const keep = Date.parse(record.observedAt) >= cutoff && !acknowledged.has(record.diagnosticId);
      if (!keep) removedIds.push(record.diagnosticId);
      return keep;
    });
    discardedRecordCount += records.length - retained.length;
    records = retained;
    if (records.length > maxRecords) {
      const firstError = records.find((record) => record.kind === 'ERROR');
      const newestCount = maxRecords - (firstError === undefined ? 0 : 1);
      const newest = newestCount === 0 ? [] : records.slice(-newestCount);
      const keep = new Set(newest.map(({ diagnosticId }) => diagnosticId));
      if (firstError !== undefined) keep.add(firstError.diagnosticId);
      const overflowIds = records.filter(({ diagnosticId }) => !keep.has(diagnosticId)).map(({ diagnosticId }) => diagnosticId);
      records = records.filter(({ diagnosticId }) => keep.has(diagnosticId));
      removedIds.push(...overflowIds);
      discardedRecordCount += overflowIds.length;
    }
    if (removedIds.length > 0) persistRemove(accountOwnerHash, removedIds);
  }

  function noteStorageFailure(
    owner: string,
    ownerGeneration: number,
    operation: StorageOperation,
  ) {
    if (generation !== ownerGeneration || accountOwnerHash !== owner) return;
    const wasHealthy = storageFailures.size === 0;
    if (!storageFailures.has(operation)) storageFailures.set(operation, now().toISOString());
    if (wasHealthy) {
      notifyStorageStateChange({
        kind: 'FAILED',
        reason: 'DIAGNOSTIC_STORAGE_FAILED',
        since: getStorageFailure()!.since,
      });
    }
  }

  function enqueueStorageMutation(
    owner: string,
    ownerGeneration: number,
    operationKind: Exclude<StorageOperation, 'READ'>,
    operation: () => Promise<void>,
  ) {
    const previous = storageMutationChains.get(owner) ?? Promise.resolve();
    const mutation = previous.catch(() => undefined).then(operation);
    storageMutationChains.set(owner, mutation);
    void mutation.then(
      () => {
        if (storageMutationChains.get(owner) === mutation) storageMutationChains.delete(owner);
        clearStorageFailure(owner, ownerGeneration, operationKind);
      },
      () => {
        if (storageMutationChains.get(owner) === mutation) storageMutationChains.delete(owner);
      },
    );
    void runBoundedAsyncOperation(() => mutation, timeoutOptions)
      .catch(() => noteStorageFailure(owner, ownerGeneration, operationKind));
  }

  function persistAppend(owner: string, ownerGeneration: number, additions: readonly DriverDiagnosticRecord[]) {
    enqueueStorageMutation(owner, ownerGeneration, 'APPEND', () => input.storage.append(owner, additions));
  }

  function persistRemove(owner: string, ids: readonly string[]) {
    enqueueStorageMutation(owner, generation, 'REMOVE', () => input.storage.remove(owner, ids));
  }

  function persistQuarantine(owner: string, entries: readonly DriverDiagnosticQuarantineEntry[]) {
    enqueueStorageMutation(owner, generation, 'QUARANTINE', () => input.storage.quarantine(owner, entries));
  }

  function rememberRemoved(ids: readonly string[]) {
    ids.forEach((id) => acknowledged.add(id));
    acknowledgedOrder.push(...ids);
    while (acknowledgedOrder.length > 2_000) {
      const expired = acknowledgedOrder.shift();
      if (expired !== undefined) acknowledged.delete(expired);
    }
  }

  return {
    acknowledge: (diagnosticIds: readonly string[], expectedAccountOwnerHash: string) => {
      if (expectedAccountOwnerHash !== accountOwnerHash) return false;
      const accepted = new Set(diagnosticIds);
      const removable = records.filter((record) => accepted.has(record.diagnosticId)).map((record) => record.diagnosticId);
      if (removable.length === 0) return true;
      rememberRemoved(removable);
      records = records.filter((record) => !accepted.has(record.diagnosticId));
      persistRemove(accountOwnerHash, removable);
      return true;
    },
    buildBatch: (options: {
      batchId: string;
      bootId: string;
      liveContext: DriverDiagnosticContext;
      liveSnapshot: DriverDiagnosticSnapshot;
      maxBytes?: number;
      maxRecords?: number;
      sentAt?: string;
    }): DriverDiagnosticEnvelope => {
      if (!isSafeDiagnosticUuid(options.batchId) || !isSafeDiagnosticUuid(options.bootId)) {
        throw new Error('INVALID_DIAGNOSTIC_ENVELOPE_ID');
      }
      prune();
      const liveSnapshot = sanitizeDriverDiagnosticSnapshot(options.liveSnapshot);
      const liveContext = sanitizeDriverDiagnosticContext(options.liveContext);
      if (liveSnapshot === null || liveContext === null) throw new Error('INVALID_DIAGNOSTIC_LIVE_STATE');
      const selected: DriverDiagnosticRecord[] = [];
      const recordLimit = options.maxRecords ?? 50;
      const byteLimit = options.maxBytes ?? 64 * 1_024;
      const base = {
        batchId: options.batchId,
        bootId: options.bootId,
        discardedRecordCount,
        liveContext,
        liveSnapshot,
        schemaVersion: DRIVER_DIAGNOSTIC_SCHEMA_VERSION,
        sentAt: options.sentAt ?? now().toISOString(),
      };
      for (const record of records.slice(0, recordLimit)) {
        const candidate = { ...base, records: [...selected, record] };
        if (JSON.stringify(candidate).length > byteLimit) break;
        selected.push(record);
      }
      return { ...base, records: selected };
    },
    getAccountOwnerHash: () => accountOwnerHash,
    getGeneration: () => generation,
    getStorageFailure,
    hydrate: async () => {
      const owner = accountOwnerHash;
      const ownerGeneration = generation;
      try {
        const stored = await runBoundedAsyncOperation(() => input.storage.read(owner), timeoutOptions);
        if (generation !== ownerGeneration || accountOwnerHash !== owner) return;
        const hydrated = stored.map(sanitizeDriverDiagnosticRecord).filter((record): record is DriverDiagnosticRecord => record !== null);
        const byId = new Map(records.map((record) => [record.diagnosticId, record]));
        hydrated.forEach((record) => {
          if (!acknowledged.has(record.diagnosticId)) byId.set(record.diagnosticId, record);
        });
        records = [...byId.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.sequence - right.sequence);
        clearStorageFailure(owner, ownerGeneration, 'READ');
        prune();
      } catch {
        noteStorageFailure(owner, ownerGeneration, 'READ');
      }
    },
    listPending: () => [...records],
    quarantine: (
      rejections: readonly { code: DriverDiagnosticQuarantineEntry['code']; diagnosticId: string }[],
      expectedAccountOwnerHash: string,
      quarantinedAt = now().toISOString(),
    ) => {
      if (expectedAccountOwnerHash !== accountOwnerHash) return false;
      const byId = new Map(rejections.map((rejection) => [rejection.diagnosticId, rejection.code]));
      const entries = records.flatMap((record): DriverDiagnosticQuarantineEntry[] => {
        const code = byId.get(record.diagnosticId);
        return code === undefined ? [] : [{ code, quarantinedAt, record }];
      });
      if (entries.length === 0) return true;
      const quarantinedIds = entries.map(({ record }) => record.diagnosticId);
      rememberRemoved(quarantinedIds);
      const quarantined = new Set(quarantinedIds);
      records = records.filter((record) => !quarantined.has(record.diagnosticId));
      persistQuarantine(accountOwnerHash, entries);
      return true;
    },
    record: (value: unknown) => {
      const record = sanitizeDriverDiagnosticRecord(value);
      if (record === null) return null;
      if (records.some(({ diagnosticId }) => diagnosticId === record.diagnosticId)) return record;
      if (record.kind === 'HEARTBEAT') {
        const superseded = records.filter((candidate) => candidate.kind === 'HEARTBEAT').map(({ diagnosticId }) => diagnosticId);
        if (superseded.length > 0) {
          records = records.filter((candidate) => candidate.kind !== 'HEARTBEAT');
          discardedRecordCount += superseded.length;
          persistRemove(accountOwnerHash, superseded);
        }
      }
      records.push(record);
      persistAppend(accountOwnerHash, generation, [record]);
      prune();
      return record;
    },
    switchAccount: (nextAccountOwnerHash: string) => {
      if (nextAccountOwnerHash === accountOwnerHash) return;
      accountOwnerHash = nextAccountOwnerHash;
      generation += 1;
      records = [];
      acknowledged.clear();
      acknowledgedOrder.length = 0;
      discardedRecordCount = 0;
      storageFailures.clear();
    },
  };
}
