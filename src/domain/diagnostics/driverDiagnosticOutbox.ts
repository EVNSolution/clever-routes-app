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

export type DriverDiagnosticReportStatus =
  | { state: 'SAVING'; updatedAt: string }
  | { state: 'QUEUED'; updatedAt: string }
  | { serverReceivedAt: string; state: 'ACKNOWLEDGED'; updatedAt: string }
  | {
    failure: 'ACCOUNT_CHANGED' | 'LOCAL_RETENTION' | 'LOCAL_STORAGE' | 'PERMANENT_REJECTION';
    rejectionCode?: DriverDiagnosticQuarantineEntry['code'];
    state: 'FAILED';
    updatedAt: string;
  };

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
  reportStatusCapacity?: number;
  retentionMs?: number;
  scheduleTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  storage: DiagnosticStorage;
}) {
  const now = input.now ?? (() => new Date());
  const maxRecords = Math.max(1, input.maxRecords ?? defaultMaxRecords);
  const retentionMs = input.retentionMs ?? defaultRetentionMs;
  const reportStatusCapacity = Math.max(1, input.reportStatusCapacity ?? 256);
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
  const reportStatuses = new Map<string, DriverDiagnosticReportStatus>();
  const reportStatusSubscribers = new Map<string, Set<(status: DriverDiagnosticReportStatus) => void>>();
  type StorageOperation = 'APPEND' | 'QUARANTINE' | 'READ' | 'REMOVE';
  const storageFailures = new Map<StorageOperation, string>();

  function reportStatusKey(owner: string, ownerGeneration: number, diagnosticId: string) {
    return `${ownerGeneration}:${owner}:${diagnosticId}`;
  }

  function setReportStatus(
    owner: string,
    ownerGeneration: number,
    diagnosticId: string,
    status: DriverDiagnosticReportStatus,
  ) {
    const key = reportStatusKey(owner, ownerGeneration, diagnosticId);
    const existing = reportStatuses.get(key);
    if (
      existing?.state === 'ACKNOWLEDGED'
      || (existing?.state === 'FAILED' && existing.failure !== 'LOCAL_STORAGE')
    ) return;
    if (
      existing?.state === status.state
      && (existing.state !== 'FAILED' || status.state !== 'FAILED'
        || (existing.failure === status.failure && existing.rejectionCode === status.rejectionCode))
    ) return;
    reportStatuses.delete(key);
    reportStatuses.set(key, status);
    const subscribers = reportStatusSubscribers.get(key);
    if (subscribers !== undefined) {
      for (const subscriber of subscribers) {
        try {
          subscriber(status);
        } catch {
          // Report-status observers must not break diagnostic persistence or delivery.
        }
      }
    }
    while (reportStatuses.size > reportStatusCapacity) {
      const oldestKey = reportStatuses.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      reportStatuses.delete(oldestKey);
      reportStatusSubscribers.delete(oldestKey);
    }
  }

  function setReportStatusForRecords(
    owner: string,
    ownerGeneration: number,
    additions: readonly DriverDiagnosticRecord[],
    status: DriverDiagnosticReportStatus,
  ) {
    additions.forEach((record) => {
      if (record.kind === 'USER_REPORT') {
        setReportStatus(owner, ownerGeneration, record.diagnosticId, status);
      }
    });
  }

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
    const beforePrune = records;
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
    const removed = new Set(removedIds);
    beforePrune.forEach((record) => {
      if (removed.has(record.diagnosticId) && record.kind === 'USER_REPORT') {
        setReportStatus(accountOwnerHash, generation, record.diagnosticId, {
          failure: 'LOCAL_RETENTION', state: 'FAILED', updatedAt: now().toISOString(),
        });
      }
    });
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
    callbacks?: { onFailure?: () => void; onSuccess?: () => void },
  ) {
    const previous = storageMutationChains.get(owner) ?? Promise.resolve();
    const mutation = previous.catch(() => undefined).then(operation);
    storageMutationChains.set(owner, mutation);
    void mutation.then(
      () => {
        if (storageMutationChains.get(owner) === mutation) storageMutationChains.delete(owner);
        clearStorageFailure(owner, ownerGeneration, operationKind);
        callbacks?.onSuccess?.();
      },
      () => {
        if (storageMutationChains.get(owner) === mutation) storageMutationChains.delete(owner);
        callbacks?.onFailure?.();
      },
    );
    void runBoundedAsyncOperation(() => mutation, timeoutOptions)
      .catch(() => {
        noteStorageFailure(owner, ownerGeneration, operationKind);
        callbacks?.onFailure?.();
      });
  }

  function persistAppend(owner: string, ownerGeneration: number, additions: readonly DriverDiagnosticRecord[]) {
    enqueueStorageMutation(owner, ownerGeneration, 'APPEND', () => input.storage.append(owner, additions), {
      onFailure: () => setReportStatusForRecords(owner, ownerGeneration, additions, {
        failure: 'LOCAL_STORAGE', state: 'FAILED', updatedAt: now().toISOString(),
      }),
      onSuccess: () => setReportStatusForRecords(owner, ownerGeneration, additions, {
        state: 'QUEUED', updatedAt: now().toISOString(),
      }),
    });
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
    acknowledge: (
      diagnosticIds: readonly string[],
      expectedAccountOwnerHash: string,
      serverReceivedAt = now().toISOString(),
    ) => {
      if (expectedAccountOwnerHash !== accountOwnerHash) return false;
      const accepted = new Set(diagnosticIds);
      const removable = records.filter((record) => accepted.has(record.diagnosticId)).map((record) => record.diagnosticId);
      if (removable.length === 0) return true;
      const receivedAtValue = Date.parse(serverReceivedAt);
      const acknowledgedAt = Number.isFinite(receivedAtValue)
        ? new Date(receivedAtValue).toISOString()
        : now().toISOString();
      records.forEach((record) => {
        if (accepted.has(record.diagnosticId) && record.kind === 'USER_REPORT') {
          setReportStatus(accountOwnerHash, generation, record.diagnosticId, {
            serverReceivedAt: acknowledgedAt, state: 'ACKNOWLEDGED', updatedAt: acknowledgedAt,
          });
        }
      });
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
          if (!acknowledged.has(record.diagnosticId)) {
            byId.set(record.diagnosticId, record);
            if (record.kind === 'USER_REPORT') {
              setReportStatus(owner, ownerGeneration, record.diagnosticId, {
                state: 'QUEUED', updatedAt: now().toISOString(),
              });
            }
          }
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
      entries.forEach(({ code, record }) => {
        if (record.kind === 'USER_REPORT') {
          setReportStatus(accountOwnerHash, generation, record.diagnosticId, {
            failure: 'PERMANENT_REJECTION', rejectionCode: code,
            state: 'FAILED', updatedAt: quarantinedAt,
          });
        }
      });
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
      if (record.kind === 'USER_REPORT') {
        setReportStatus(accountOwnerHash, generation, record.diagnosticId, {
          state: 'SAVING', updatedAt: now().toISOString(),
        });
      }
      persistAppend(accountOwnerHash, generation, [record]);
      prune();
      return record;
    },
    switchAccount: (nextAccountOwnerHash: string) => {
      if (nextAccountOwnerHash === accountOwnerHash) return;
      records.forEach((record) => {
        if (record.kind === 'USER_REPORT') {
          setReportStatus(accountOwnerHash, generation, record.diagnosticId, {
            failure: 'ACCOUNT_CHANGED', state: 'FAILED', updatedAt: now().toISOString(),
          });
        }
      });
      accountOwnerHash = nextAccountOwnerHash;
      generation += 1;
      records = [];
      acknowledged.clear();
      acknowledgedOrder.length = 0;
      discardedRecordCount = 0;
      storageFailures.clear();
    },
    getReportStatus: (
      diagnosticId: string,
      expectedAccountOwnerHash = accountOwnerHash,
      expectedGeneration = generation,
    ) => reportStatuses.get(reportStatusKey(
      expectedAccountOwnerHash,
      expectedGeneration,
      diagnosticId,
    )) ?? null,
    subscribeReportStatus: (
      diagnosticId: string,
      expectedAccountOwnerHash: string,
      expectedGeneration: number,
      listener: (status: DriverDiagnosticReportStatus) => void,
    ) => {
      const key = reportStatusKey(expectedAccountOwnerHash, expectedGeneration, diagnosticId);
      const subscribers = reportStatusSubscribers.get(key) ?? new Set();
      subscribers.add(listener);
      reportStatusSubscribers.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) reportStatusSubscribers.delete(key);
      };
    },
  };
}
