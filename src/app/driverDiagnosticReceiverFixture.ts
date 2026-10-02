import type {
  DriverDiagnosticEnvelope,
  DriverDiagnosticPermanentRejectionCode,
  DriverDiagnosticResponse,
} from '../domain/diagnostics/driverDiagnosticContract';

export type ContractMockAttemptStatus = 'APPLIED' | 'DUPLICATE' | 'FAILED' | 'REJECTED';

export type ContractMockDiagnosticStatus =
  | 'AUTH_OR_ROUTE_BLOCKED'
  | 'DIAGNOSTIC_EVIDENCE_DEGRADED'
  | 'GPS_COLLECTION_STOPPED'
  | 'GPS_POST_COLLECTION_BLOCKED'
  | 'HEALTHY'
  | 'SERVER_APPLIED_CLIENT_ACK_UNKNOWN'
  | 'SERVER_RECEIVED_NOT_APPLIED'
  | 'SIGNAL_ABSENT_UNKNOWN'
  | 'UNKNOWN_INSUFFICIENT_EVIDENCE'
  | 'UNKNOWN_STALE_EVIDENCE';

type Attempt = {
  clientEventId: string;
  status: ContractMockAttemptStatus;
};

/**
 * Contract-only receiver used by app acceptance tests. This is deliberately not
 * a production server classifier; it fixes the evidence boundaries the server
 * implementation must preserve.
 */
export function createContractMockDiagnosticReceiver(input: {
  clockSkewBudgetMs?: number;
  collectionWarmupMs?: number;
  now: () => Date;
  signalAbsentAfterMs?: number;
  snapshotFreshForMs?: number;
}) {
  const clockSkewBudgetMs = input.clockSkewBudgetMs ?? 30_000;
  const collectionWarmupMs = input.collectionWarmupMs ?? 60_000;
  const signalAbsentAfterMs = input.signalAbsentAfterMs ?? 2 * 60_000;
  const snapshotFreshForMs = input.snapshotFreshForMs ?? 2 * 60_000;
  const attempts = new Map<string, Attempt>();
  const permanentRejections = new Map<string, DriverDiagnosticPermanentRejectionCode>();
  let lastContactAt: string | null = null;
  let latestEnvelope: DriverDiagnosticEnvelope | null = null;
  let locationExpectationIdentity: string | null = null;
  let locationExpectedSince: string | null = null;

  function expectationIdentity(envelope: DriverDiagnosticEnvelope) {
    const { liveContext } = envelope;
    return [
      envelope.bootId,
      liveContext.deviceInstanceHash,
      liveContext.routePlanId ?? '',
      liveContext.sessionGeneration ?? '',
      liveContext.assignmentGeneration ?? '',
    ].join('|');
  }

  function classify(): { since: string | null; status: ContractMockDiagnosticStatus } {
    const serverNow = input.now().getTime();
    if (lastContactAt === null || serverNow - Date.parse(lastContactAt) > signalAbsentAfterMs) {
      return { since: lastContactAt, status: 'SIGNAL_ABSENT_UNKNOWN' };
    }
    if (latestEnvelope === null) {
      return { since: lastContactAt, status: 'UNKNOWN_INSUFFICIENT_EVIDENCE' };
    }

    const snapshot = latestEnvelope.liveSnapshot;
    if (Math.abs(serverNow - Date.parse(snapshot.snapshotObservedAt)) > snapshotFreshForMs) {
      return { since: snapshot.snapshotObservedAt, status: 'UNKNOWN_STALE_EVIDENCE' };
    }
    const futureLocationTimestamp = [snapshot.lastGpsCallbackAt, snapshot.lastGpsCollectedAt]
      .find((observedAt) => observedAt !== null && Date.parse(observedAt) - serverNow > clockSkewBudgetMs);
    if (futureLocationTimestamp !== undefined) {
      return { since: futureLocationTimestamp, status: 'UNKNOWN_STALE_EVIDENCE' };
    }
    const isFresh = (observedAt: string | null) => {
      if (observedAt === null) return false;
      const ageMs = serverNow - Date.parse(observedAt);
      return ageMs >= -clockSkewBudgetMs && ageMs <= snapshotFreshForMs;
    };
    const callbackIsFresh = isFresh(snapshot.lastGpsCallbackAt);
    const collectionIsFresh = isFresh(snapshot.lastGpsCollectedAt);

    for (const blocker of snapshot.blockers ?? []) {
      const attempt = blocker.clientEventId === undefined ? undefined : attempts.get(blocker.clientEventId);
      if (attempt?.status === 'FAILED' || attempt?.status === 'REJECTED') {
        return { since: blocker.since, status: 'SERVER_RECEIVED_NOT_APPLIED' };
      }
      if (
        (attempt?.status === 'APPLIED' || attempt?.status === 'DUPLICATE')
        && blocker.stage === 'TRANSPORT'
        && snapshot.lastGpsSendAcknowledgedAt === null
      ) {
        return { since: blocker.since, status: 'SERVER_APPLIED_CLIENT_ACK_UNKNOWN' };
      }
    }

    const authOrRoute = (snapshot.blockers ?? []).find(({ stage }) => stage === 'AUTH' || stage === 'ROUTE');
    if (authOrRoute !== undefined) {
      return { since: authOrRoute.since, status: 'AUTH_OR_ROUTE_BLOCKED' };
    }

    const diagnosticStorageFailure = (snapshot.blockers ?? []).find(({ reason }) => reason === 'DIAGNOSTIC_STORAGE_FAILED');
    if (diagnosticStorageFailure !== undefined) {
      return { since: diagnosticStorageFailure.since, status: 'DIAGNOSTIC_EVIDENCE_DEGRADED' };
    }

    const postCollectionBlocker = (snapshot.blockers ?? []).find(({ stage }) => (
      stage === 'PROCESSING' || stage === 'STORAGE' || stage === 'TRANSPORT'
    ));
    if (
      postCollectionBlocker !== undefined
      && callbackIsFresh
      && collectionIsFresh
    ) {
      return { since: postCollectionBlocker.since, status: 'GPS_POST_COLLECTION_BLOCKED' };
    }

    if (snapshot.locationTaskExpected !== true) {
      return { since: snapshot.snapshotObservedAt, status: 'UNKNOWN_INSUFFICIENT_EVIDENCE' };
    }
    const freshLocationEvidence = [
      snapshot.locationPermission === 'DENIED' ? snapshot.stateObservedAt.locationPermission : null,
      snapshot.locationService === 'DISABLED' ? snapshot.stateObservedAt.locationService : null,
      snapshot.locationTask === 'ERROR' || snapshot.locationTask === 'STOPPED'
        ? snapshot.stateObservedAt.locationTask
        : null,
    ].find((observedAt) => (
      observedAt !== null && serverNow - Date.parse(observedAt) <= snapshotFreshForMs
    ));
    if (freshLocationEvidence !== undefined) {
      return { since: freshLocationEvidence, status: 'GPS_COLLECTION_STOPPED' };
    }
    if (
      snapshot.lastGpsCallbackAt !== null
      && serverNow - Date.parse(snapshot.lastGpsCallbackAt) > snapshotFreshForMs
    ) {
      return {
        since: snapshot.lastGpsCallbackAt,
        status: 'GPS_COLLECTION_STOPPED',
      };
    }
    if (snapshot.lastGpsCallbackAt === null) {
      if (locationExpectedSince === null || serverNow - Date.parse(locationExpectedSince) <= collectionWarmupMs) {
        return { since: locationExpectedSince, status: 'UNKNOWN_INSUFFICIENT_EVIDENCE' };
      }
      return { since: locationExpectedSince, status: 'GPS_COLLECTION_STOPPED' };
    }
    if (
      snapshot.lastGpsCollectedAt === null
      || serverNow - Date.parse(snapshot.lastGpsCollectedAt) > snapshotFreshForMs
    ) {
      return {
        since: snapshot.lastGpsCollectedAt ?? snapshot.lastGpsCallbackAt,
        status: 'GPS_COLLECTION_STOPPED',
      };
    }
    const queueIsFresh = isFresh(snapshot.businessQueue.observedAt);
    const gpsAcknowledgementIsFresh = isFresh(snapshot.lastGpsSendAcknowledgedAt);
    if (queueIsFresh && snapshot.businessQueue.queueDepth === 0 && gpsAcknowledgementIsFresh) {
      return { since: snapshot.snapshotObservedAt, status: 'HEALTHY' };
    }
    return { since: snapshot.snapshotObservedAt, status: 'UNKNOWN_INSUFFICIENT_EVIDENCE' };
  }

  return {
    classify,
    getLastContactAt: () => lastContactAt,
    getLatestEnvelope: () => latestEnvelope,
    receive: async (envelope: DriverDiagnosticEnvelope): Promise<DriverDiagnosticResponse> => {
      lastContactAt = input.now().toISOString();
      latestEnvelope = envelope;
      const currentExpectationIdentity = expectationIdentity(envelope);
      if (currentExpectationIdentity !== locationExpectationIdentity) {
        locationExpectationIdentity = currentExpectationIdentity;
        locationExpectedSince = null;
      }
      const snapshotIsFresh = Math.abs(
        input.now().getTime() - Date.parse(envelope.liveSnapshot.snapshotObservedAt),
      ) <= snapshotFreshForMs;
      if (envelope.liveSnapshot.locationTaskExpected === false) locationExpectedSince = null;
      else if (envelope.liveSnapshot.locationTaskExpected === true && snapshotIsFresh && locationExpectedSince === null) {
        locationExpectedSince = lastContactAt;
      }
      return {
        acceptedDiagnosticIds: envelope.records
          .map(({ diagnosticId }) => diagnosticId)
          .filter((diagnosticId) => !permanentRejections.has(diagnosticId)),
        rejectedDiagnostics: envelope.records.flatMap(({ diagnosticId }) => {
          const code = permanentRejections.get(diagnosticId);
          return code === undefined ? [] : [{ code, diagnosticId }];
        }),
        serverReceivedAt: lastContactAt,
      };
    },
    rejectDiagnostic: (diagnosticId: string, code: DriverDiagnosticPermanentRejectionCode) => {
      permanentRejections.set(diagnosticId, code);
    },
    recordAttempt: (attempt: Attempt) => {
      attempts.set(attempt.clientEventId, attempt);
    },
  };
}
