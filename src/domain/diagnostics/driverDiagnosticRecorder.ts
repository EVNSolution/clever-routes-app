import {
  sanitizeDriverDiagnosticSnapshot,
  type DriverDiagnosticBlocker,
  type DriverDiagnosticContext,
  type DriverDiagnosticIdentifiers,
  type DriverDiagnosticKind,
  type DriverDiagnosticSnapshot,
} from './driverDiagnosticContract';
import type { DriverDiagnosticOutbox, DriverDiagnosticReportStatus } from './driverDiagnosticOutbox';
import type { DriverDiagnosticTransport } from './driverDiagnosticTransport';

export type DriverDiagnosticRecorder = ReturnType<typeof createDriverDiagnosticRecorder>;
export type DriverDiagnosticReportHandle = {
  diagnosticId: string;
  getStatus(): DriverDiagnosticReportStatus | null;
  subscribe(listener: (status: DriverDiagnosticReportStatus) => void): () => void;
};

export function createDriverDiagnosticRecorder(input: {
  bootId: string;
  context: DriverDiagnosticContext;
  idFactory: () => string;
  nextSequence?: () => number;
  now?: () => Date;
  outbox: DriverDiagnosticOutbox;
  snapshot: () => DriverDiagnosticSnapshot;
  transport: DriverDiagnosticTransport;
}) {
  const now = input.now ?? (() => new Date());
  let sequence = 0;

  function currentSnapshot(extraBlockers?: readonly DriverDiagnosticBlocker[]) {
    const current = input.snapshot();
    const storageFailure = input.outbox.getStorageFailure();
    const blockers = [
      ...(storageFailure === null ? [] : [{
        lastObservedAt: now().toISOString(),
        reason: storageFailure.reason,
        since: storageFailure.since,
        stage: 'STORAGE' as const,
      }]),
      ...(extraBlockers ?? []),
      ...(current.blockers ?? []),
    ];
    return sanitizeDriverDiagnosticSnapshot({
      ...current,
      ...(blockers.length === 0 ? {} : { blockers }),
    });
  }

  function liveState() {
    const snapshot = currentSnapshot();
    return snapshot === null ? null : { bootId: input.bootId, context: input.context, snapshot };
  }

  function emit(kind: DriverDiagnosticKind, options?: {
    blockers?: readonly DriverDiagnosticBlocker[];
    identifiers?: DriverDiagnosticIdentifiers;
  }) {
    const observedAt = now().toISOString();
    const snapshot = currentSnapshot(options?.blockers);
    if (snapshot === null) return null;
    sequence = input.nextSequence?.() ?? sequence + 1;
    const record = input.outbox.record({
      bootId: input.bootId,
      context: input.context,
      diagnosticId: input.idFactory(),
      ...(options?.identifiers === undefined ? {} : { identifiers: options.identifiers }),
      kind,
      observedAt,
      sequence,
      snapshot,
    });
    input.transport.requestImmediate(liveState);
    return record;
  }

  function reportUserIssue(options?: {
    blockers?: readonly DriverDiagnosticBlocker[];
    identifiers?: DriverDiagnosticIdentifiers;
  }): DriverDiagnosticReportHandle | null {
    const accountOwnerHash = input.outbox.getAccountOwnerHash();
    const generation = input.outbox.getGeneration();
    const record = emit('USER_REPORT', options);
    if (record === null) return null;
    return {
      diagnosticId: record.diagnosticId,
      getStatus: () => input.outbox.getReportStatus(
        record.diagnosticId,
        accountOwnerHash,
        generation,
      ),
      subscribe: (listener: (status: DriverDiagnosticReportStatus) => void) => (
        input.outbox.subscribeReportStatus(
          record.diagnosticId,
          accountOwnerHash,
          generation,
          listener,
        )
      ),
    };
  }

  return {
    emitError: (options: { blockers: readonly DriverDiagnosticBlocker[]; identifiers?: DriverDiagnosticIdentifiers }) => emit('ERROR', options),
    emitHeartbeat: () => emit('HEARTBEAT'),
    emitStateChange: (options?: { blockers?: readonly DriverDiagnosticBlocker[]; identifiers?: DriverDiagnosticIdentifiers }) => emit('STATE_CHANGE', options),
    flush: () => {
      return input.transport.flush(liveState, { overrideBackoff: true });
    },
    flushBeforeDetach: () => input.transport.flushBeforeDetach(liveState),
    notifyForeground: () => {
      input.transport.requestImmediate(liveState, { overrideBackoff: true });
    },
    notifyAuthenticated: () => {
      input.transport.requestImmediate(liveState, { overrideBackoff: true });
    },
    notifyOnline: () => {
      input.transport.requestImmediate(liveState, { overrideBackoff: true });
    },
    getUserReportStatus: (diagnosticId: string) => input.outbox.getReportStatus(diagnosticId),
    reportUserIssue,
  };
}
