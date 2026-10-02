import type { DriverDiagnosticBlocker, DriverDiagnosticReasonCode, DriverDiagnosticSnapshot, DriverDiagnosticStage } from '../domain/diagnostics/driverDiagnosticContract';
import type { DriverDiagnosticObservation } from '../domain/diagnostics/driverDiagnosticObservation';

/** In-memory projection only: observing business work must never await its storage. */
export function createDriverDiagnosticProjection(now: () => Date = () => new Date()) {
  const blockers = new Map<string, DriverDiagnosticBlocker>();
  const settledStorageFailures = new Map<string, { blockerKey: string; recoveryGroup: string }>();
  const state: DriverDiagnosticSnapshot = {
    snapshotObservedAt: now().toISOString(),
    stateObservedAt: { lifecycle: null, network: null, locationPermission: null, locationService: null, locationTask: null },
    businessQueue: { observedAt: null, nextRetryAt: null, oldestAgeMs: null, oldestQueuedAt: null, queueDepth: 0, retryCount: 0 },
    lastGpsCallbackAt: null, lastGpsCollectedAt: null, lastGpsPersistedAt: null,
    lastGpsSendAcknowledgedAt: null, lastGpsSendAttemptAt: null,
    lifecycle: 'UNKNOWN', locationPermission: 'UNKNOWN', locationService: 'UNKNOWN',
    locationTask: 'UNKNOWN', locationTaskExpected: null, network: 'UNKNOWN',
  };
  function deleteBlocker(key: string) {
    blockers.delete(key);
    for (const [operationKey, settled] of settledStorageFailures) {
      if (settled.blockerKey === key) settledStorageFailures.delete(operationKey);
    }
  }
  function block(stage: DriverDiagnosticStage, reason: DriverDiagnosticReasonCode, event: DriverDiagnosticObservation) {
    const key = `${stage}:${event.kind === 'OPERATION' ? operationKey(event) : reason}`;
    const previous = blockers.get(key);
    if (event.kind === 'OPERATION') {
      for (const otherKey of blockers.keys()) {
        if (otherKey !== key && otherKey.endsWith(`:${operationKey(event)}`)) deleteBlocker(otherKey);
      }
    }
    blockers.delete(key);
    blockers.set(key, {
      stage, reason, since: previous?.reason === reason ? previous.since : event.observedAt, lastObservedAt: event.observedAt,
      ...('clientEventId' in event && event.clientEventId ? { clientEventId: event.clientEventId } : {}),
      ...('requestId' in event && event.requestId ? { requestId: event.requestId } : {}),
      ...('httpStatus' in event && event.httpStatus ? { httpStatus: event.httpStatus } : {}),
    });
    // The event outbox retains history; the live snapshot contains at most ten
    // current blockers, matching the wire contract's bound.
    while (blockers.size > 10) deleteBlocker(blockers.keys().next().value!);
    return key;
  }
  function operationKey(event: Extract<DriverDiagnosticObservation, { kind: 'OPERATION' }>) {
    return `${event.operation}:${event.clientEventId ?? ''}`;
  }
  function completionStorageRecoveryGroup(
    event: Extract<DriverDiagnosticObservation, { kind: 'OPERATION' }>,
  ): string | null {
    const match = event.clientEventId?.match(/^completion-assistance-(read|remove|write):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    if (match === null || match === undefined) return null;
    const resource = match[1];
    if (event.operation === 'STORAGE_READ' && resource === 'read') return 'completion-assistance-read';
    if (event.operation === 'STORAGE_WRITE' && (resource === 'remove' || resource === 'write')) {
      return `completion-assistance-${resource}`;
    }
    return null;
  }
  function transitionKey() {
    return JSON.stringify({
      lifecycle: state.lifecycle, network: state.network, permission: state.locationPermission,
      service: state.locationService, task: state.locationTask, expected: state.locationTaskExpected,
      collected: state.lastGpsCollectedAt !== null, attempted: state.lastGpsSendAttemptAt !== null, acknowledged: state.lastGpsSendAcknowledgedAt !== null,
      blockers: [...blockers.values()].map(({ stage, reason, since, clientEventId }) => ({ stage, reason, since, clientEventId })),
    });
  }
  function observe(event: DriverDiagnosticObservation) {
    const before = transitionKey();
    switch (event.kind) {
      case 'STATE': {
        for (const key of ['lifecycle', 'network', 'locationPermission', 'locationService', 'locationTask'] as const) {
          const value = event.patch?.[key];
          if (value !== undefined) {
            Object.assign(state, { [key]: value });
            state.stateObservedAt[key] = event.observedAt;
          }
        }
        if (event.patch?.locationTaskExpected !== undefined) state.locationTaskExpected = event.patch.locationTaskExpected;
        const timestamps = { lastGpsCallbackAt: event.callbackAt, lastGpsCollectedAt: event.collectedAt, lastGpsPersistedAt: event.persistedAt, lastGpsSendAttemptAt: event.sendAttemptAt, lastGpsSendAcknowledgedAt: event.sendAcknowledgedAt };
        for (const key of Object.keys(timestamps) as (keyof typeof timestamps)[]) {
          const at = timestamps[key];
          if (at && (state[key] === null || at > state[key]!)) state[key] = at;
        }
        for (const [key, blocker] of blockers) {
          if (event.clearStage === blocker.stage || event.clearReasonCodes?.includes(blocker.reason)) deleteBlocker(key);
        }
        if (event.blocker) block(event.blocker.stage, event.blocker.reasonCode, { ...event, ...event.blocker });
        break;
      }
      case 'OPERATION': {
        const stage: DriverDiagnosticStage = event.operation === 'AUTH_REFRESH' || event.reasonCode === 'HTTP_UNAUTHORIZED' ? 'AUTH'
          : event.operation === 'ROUTE_LOOKUP' || event.reasonCode === 'ROUTE_MISMATCH' || event.reasonCode === 'SESSION_MISMATCH' || event.reasonCode === 'ROUTE_NOT_IN_PROGRESS' ? 'ROUTE'
            : event.operation === 'STORAGE_WRITE' || event.operation === 'STORAGE_READ' ? 'STORAGE' : 'TRANSPORT';
        if (event.operation === 'GPS_SEND') {
          if (event.phase === 'STARTED') state.lastGpsSendAttemptAt = event.observedAt;
          if (event.phase === 'SUCCEEDED') state.lastGpsSendAcknowledgedAt = event.observedAt;
        }
        if (event.phase === 'FAILED' || event.phase === 'WATCHDOG_TIMEOUT') {
          const blockerKey = block(stage, event.reasonCode ?? 'OPERATION_TIMEOUT', event);
          const recoveryGroup = completionStorageRecoveryGroup(event);
          if (event.phase === 'FAILED' && recoveryGroup !== null) {
            settledStorageFailures.set(operationKey(event), { blockerKey, recoveryGroup });
          }
        }
        else if (event.phase === 'SUCCEEDED') {
          for (const key of blockers.keys()) if (key.endsWith(`:${operationKey(event)}`)) deleteBlocker(key);
          const recoveryGroup = completionStorageRecoveryGroup(event);
          if (recoveryGroup !== null) {
            for (const [settledKey, settled] of settledStorageFailures) {
              if (settled.recoveryGroup === recoveryGroup) {
                deleteBlocker(settled.blockerKey);
                settledStorageFailures.delete(settledKey);
              }
            }
          }
        }
        break;
      }
    }
    return before !== transitionKey();
  }
  return {
    observe,
    setLocationExpected: (expected: boolean | null) => { state.locationTaskExpected = expected; },
    setQueue: (queue: Omit<DriverDiagnosticSnapshot['businessQueue'], 'oldestAgeMs' | 'observedAt'>) => { state.businessQueue = { ...queue, oldestAgeMs: null, observedAt: now().toISOString() }; },
    setNextRetryAt: (at: string | null) => {
      const changed = state.businessQueue.nextRetryAt !== at;
      state.businessQueue.nextRetryAt = at;
      // A scheduler observation does not prove the queue itself was loaded.
      if (state.businessQueue.observedAt !== null) state.businessQueue.observedAt = now().toISOString();
      return changed;
    },
    snapshot: (): DriverDiagnosticSnapshot => ({
      ...state, snapshotObservedAt: now().toISOString(), stateObservedAt: { ...state.stateObservedAt },
      businessQueue: { ...state.businessQueue, oldestAgeMs: state.businessQueue.oldestQueuedAt === null ? null : Math.max(0, now().getTime() - Date.parse(state.businessQueue.oldestQueuedAt)) },
      blockers: [...blockers.values()].map((blocker) => ({ ...blocker })),
    }),
  };
}
