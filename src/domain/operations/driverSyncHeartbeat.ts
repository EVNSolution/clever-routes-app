import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

export type DriverSyncRetryJournalEntry = {
  errorCode: string;
  observedAt: string;
};

export type DriverSyncHeartbeatRequest = {
  appVersion: string;
  clientOccurredAt: string;
  completedStopCount: number | null;
  currentStopSequence: number | null;
  deviceInstanceHash: string;
  driverContractVersion: number;
  finishPending: boolean;
  firstErrorCode: string | null;
  firstFailedAt: string | null;
  heartbeatSequence: number;
  lastAcknowledgedAt: string | null;
  lastErrorCode: string | null;
  lastRetryAt: string | null;
  locallyFinished: boolean | null;
  nextRetryAt: string | null;
  oldestQueuedAt: string | null;
  queueDepth: number | null;
  retryCount: number;
  retryJournal: readonly DriverSyncRetryJournalEntry[] | null;
  sessionGeneration: string;
  totalStopCount: number | null;
  versionCode: number;
};

export type DriverSyncHeartbeatResult = {
  accepted: boolean;
  conflict: boolean;
  heartbeatSequence: number;
  state: 'HEALTHY' | 'DELAYED' | 'BLOCKED' | 'UNKNOWN';
};

export type DriverSyncHeartbeatService = {
  recordHeartbeat(
    request: DriverSyncHeartbeatRequest,
    options?: { signal?: AbortSignal },
  ): Promise<DriverSyncHeartbeatResult>;
};

export type DriverSyncIdentityService = {
  next(sessionKey: string): Promise<{
    deviceInstanceHash: string;
    heartbeatSequence: number;
    sessionGeneration: string;
  }>;
};

export type DriverSyncQueueProjection = Pick<DriverSyncHeartbeatRequest,
  | 'finishPending'
  | 'firstErrorCode'
  | 'firstFailedAt'
  | 'lastAcknowledgedAt'
  | 'lastErrorCode'
  | 'lastRetryAt'
  | 'locallyFinished'
  | 'nextRetryAt'
  | 'oldestQueuedAt'
  | 'queueDepth'
  | 'retryCount'
  | 'retryJournal'
>;

export function projectDriverSyncQueueState(
  queue: OfflineSubmissionQueue,
  routePlanId: string,
): DriverSyncQueueProjection {
  const pending = queue.listPending().filter((item) => (
    item.kind === 'driver_event' ? item.event.routePlanId === routePlanId : item.request.routePlanId === routePlanId
  ));
  const firstPending = pending[0];
  const completion = queue.getRouteCompletionTelemetry(routePlanId);
  return {
    finishPending: completion.finishPending,
    firstErrorCode: firstPending?.firstErrorCode ?? null,
    firstFailedAt: firstPending?.journal.find((entry) => entry.kind === 'ATTEMPT')?.at ?? null,
    lastAcknowledgedAt: completion.lastAcknowledgedAt,
    lastErrorCode: pending.at(-1)?.lastErrorCode ?? null,
    lastRetryAt: pending.flatMap((item) => item.journal).filter((entry) => entry.kind === 'ATTEMPT').at(-1)?.at ?? null,
    locallyFinished: completion.locallyFinished,
    nextRetryAt: null,
    oldestQueuedAt: firstPending?.enqueuedAt ?? null,
    queueDepth: pending.length,
    retryCount: pending.reduce((total, item) => total + item.attempts, 0),
    retryJournal: pending.flatMap((item) => item.journal)
      .filter((entry) => entry.kind === 'ATTEMPT' || entry.kind === 'RECONCILIATION')
      .slice(-8)
      .map((entry) => ({ errorCode: entry.code, observedAt: entry.at })),
  };
}

export type DriverCompletionClearHeartbeatAttempt = {
  appVersion: string;
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  completedStopCount: number | null;
  driverContractVersion: 2;
  heartbeatService: DriverSyncHeartbeatService;
  identityService: DriverSyncIdentityService;
  isAttemptCurrent?: () => boolean;
  queue: OfflineSubmissionQueue;
  routePlanId: string;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  sessionKey: string;
  versionCode: number;
};

export type DriverCompletionClearHeartbeatOutcome = {
  failure: 'conflict' | 'failed' | 'not_pending' | 'unauthorized' | null;
  observed: boolean;
  result: DriverSyncHeartbeatResult | null;
};

export async function attemptDriverCompletionClearHeartbeat(
  input: DriverCompletionClearHeartbeatAttempt,
): Promise<DriverCompletionClearHeartbeatOutcome> {
  const queueProjection = projectDriverSyncQueueState(input.queue, input.routePlanId);
  if (
    queueProjection.finishPending
    || queueProjection.lastAcknowledgedAt === null
    || !input.queue.listPendingCompletionClearRoutePlanIds().includes(input.routePlanId)
  ) {
    return { failure: 'not_pending', observed: false, result: null };
  }
  try {
    const result = await runBoundedAsyncOperation(async (signal) => {
      const identity = await input.identityService.next(input.sessionKey);
      return input.heartbeatService.recordHeartbeat({
        ...queueProjection,
        appVersion: input.appVersion,
        clientOccurredAt: new Date().toISOString(),
        completedStopCount: input.completedStopCount,
        currentStopSequence: null,
        deviceInstanceHash: identity.deviceInstanceHash,
        driverContractVersion: input.driverContractVersion,
        heartbeatSequence: identity.heartbeatSequence,
        sessionGeneration: identity.sessionGeneration,
        totalStopCount: null,
        versionCode: input.versionCode,
      }, { signal });
    }, {
      ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
      ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
      timeoutMs: input.attemptTimeoutMs ?? 15_000,
    });
    if (input.isAttemptCurrent?.() === false) {
      return { failure: 'failed', observed: false, result };
    }
    if (!result.accepted || result.conflict) {
      return { failure: result.conflict ? 'conflict' : 'failed', observed: false, result };
    }
    if (!input.queue.markRouteCompletionClearHeartbeatDelivered(input.routePlanId)) {
      return { failure: 'failed', observed: false, result };
    }
    await input.queue.whenPersisted();
    return { failure: null, observed: true, result };
  } catch (error) {
    return {
      failure: error instanceof DriverSyncHeartbeatHttpError && error.status === 401 ? 'unauthorized' : 'failed',
      observed: false,
      result: null,
    };
  }
}

export async function deliverDriverCompletionClearHeartbeat(input: {
  attempt: DriverCompletionClearHeartbeatAttempt;
  refreshHeartbeatService?: (signal: AbortSignal) => Promise<DriverSyncHeartbeatService | null>;
}): Promise<DriverCompletionClearHeartbeatOutcome> {
  const first = await attemptDriverCompletionClearHeartbeat(input.attempt);
  if (first.failure !== 'unauthorized' || input.refreshHeartbeatService === undefined) return first;
  let refreshedService: DriverSyncHeartbeatService | null;
  try {
    refreshedService = await runBoundedAsyncOperation(input.refreshHeartbeatService, {
      ...(input.attempt.cancelAttemptTimeout === undefined ? {} : { cancel: input.attempt.cancelAttemptTimeout }),
      ...(input.attempt.scheduleAttemptTimeout === undefined ? {} : { schedule: input.attempt.scheduleAttemptTimeout }),
      timeoutMs: input.attempt.attemptTimeoutMs ?? 15_000,
    });
  } catch {
    return first;
  }
  if (refreshedService === null) return first;
  return attemptDriverCompletionClearHeartbeat({ ...input.attempt, heartbeatService: refreshedService });
}

export class DriverSyncHeartbeatHttpError extends Error {
  constructor(readonly status: number) {
    super(`Driver sync heartbeat failed (${status})`);
  }
}

type FetchLike = (url: string, init?: {
  body?: string;
  cache?: 'no-store';
  credentials?: 'omit';
  headers?: Record<string, string>;
  method?: string;
  signal?: AbortSignal;
}) => Promise<Response>;

export function createDriverSyncHeartbeatApiClient(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): DriverSyncHeartbeatService {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async recordHeartbeat(request, options) {
      const response = await fetchImpl(`${input.baseUrl.replace(/\/$/u, '')}/driver/sync-health`, {
        body: JSON.stringify(request),
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
        signal: options?.signal,
      });
      if (!response.ok) throw new DriverSyncHeartbeatHttpError(response.status);
      return parseHeartbeatResponse(await response.json());
    },
  };
}

export function createDriverSyncTakeoverApiClient(input: {
  accountAccessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async takeover(request: { deviceInstanceHash: string; routePlanId: string; sessionGeneration: string }) {
      const response = await fetchImpl(`${input.baseUrl.replace(/\/$/u, '')}/driver/sync-health/takeover`, {
        body: JSON.stringify(request),
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${input.accountAccessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`Driver sync takeover failed (${response.status})`);
      const value = await response.json() as { data?: { takenOver?: unknown } };
      if (value.data?.takenOver !== true) throw new Error('Invalid driver sync takeover response');
      return true;
    },
  };
}

export function createDriverSyncHeartbeatScheduler(input: {
  attemptTimeoutMs?: number;
  cancel(handle: unknown): void;
  cancelAttemptTimeout?: (handle: unknown) => void;
  hasActiveSession(): boolean;
  isForeground(): boolean;
  isOnline(): boolean;
  isDegraded?(): boolean;
  random?: () => number;
  schedule(run: () => void, delayMs: number): unknown;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  sendHeartbeat(signal: AbortSignal): Promise<boolean>;
}) {
  const random = input.random ?? Math.random;
  let failureCount = 0;
  let handle: unknown;
  let immediateRequested = false;
  let inFlightAbortController: AbortController | null = null;
  let running = false;
  let started = false;

  function cancelScheduled() {
    if (handle !== undefined) input.cancel(handle);
    handle = undefined;
  }
  function scheduleNext() {
    cancelScheduled();
    if (!started || running || !input.hasActiveSession() || !input.isForeground() || !input.isOnline()) return;
    const cadence = input.isDegraded?.() === true ? 30_000 : 60_000;
    const base = Math.min(120_000, cadence * (2 ** failureCount));
    const jitter = 1 + ((Math.max(0, Math.min(1, random())) * 2 - 1) * 0.2);
    const delay = Math.max(cadence, Math.min(120_000, Math.round(base * jitter)));
    handle = input.schedule(() => {
      handle = undefined;
      runNow();
    }, delay);
  }
  function runNow() {
    cancelScheduled();
    if (!started || !input.hasActiveSession() || !input.isForeground() || !input.isOnline()) return;
    if (running) {
      immediateRequested = true;
      return;
    }
    immediateRequested = false;
    running = true;
    void runBoundedAsyncOperation((timeoutSignal) => {
      const lifecycleController = new AbortController();
      inFlightAbortController = lifecycleController;
      if (timeoutSignal.aborted) lifecycleController.abort();
      else timeoutSignal.addEventListener('abort', () => lifecycleController.abort(), { once: true });
      return input.sendHeartbeat(lifecycleController.signal);
    }, {
        ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
        ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
        timeoutMs: input.attemptTimeoutMs ?? 15_000,
      })
        .then((accepted) => { failureCount = accepted ? 0 : failureCount + 1; })
        .catch(() => { failureCount += 1; })
        .finally(() => {
          inFlightAbortController = null;
          running = false;
          if (immediateRequested) runNow();
          else scheduleNext();
        });
  }

  return {
    notifyConditionsChanged() {
      if (immediateRequested) runNow();
      else scheduleNext();
    },
    requestImmediate() {
      immediateRequested = true;
      runNow();
    },
    start() {
      started = true;
      if (immediateRequested) runNow();
      else scheduleNext();
    },
    stop() {
      const carryImmediateRequest = immediateRequested || running;
      started = false;
      immediateRequested = false;
      inFlightAbortController?.abort();
      inFlightAbortController = null;
      cancelScheduled();
      return carryImmediateRequest;
    },
  };
}

export function projectLatestDriverSyncHeartbeat(
  current: DriverSyncHeartbeatResult | null,
  incoming: DriverSyncHeartbeatResult,
): DriverSyncHeartbeatResult {
  return current !== null && current.heartbeatSequence > incoming.heartbeatSequence ? current : incoming;
}

export function projectDriverSyncHeartbeatForEpoch(
  current: DriverSyncHeartbeatResult | null,
  incoming: DriverSyncHeartbeatResult,
  requestEpoch: number,
  currentEpoch: number,
): DriverSyncHeartbeatResult | null {
  return requestEpoch === currentEpoch ? projectLatestDriverSyncHeartbeat(current, incoming) : current;
}

function parseHeartbeatResponse(value: unknown): DriverSyncHeartbeatResult {
  const data = typeof value === 'object' && value !== null
    && typeof (value as { data?: unknown }).data === 'object'
    && (value as { data: unknown }).data !== null
    ? (value as { data: Record<string, unknown> }).data
    : null;
  const syncHealth = data !== null && typeof data.syncHealth === 'object' && data.syncHealth !== null
    ? data.syncHealth as Record<string, unknown>
    : null;
  const state = syncHealth?.state;
  const heartbeatSequence = syncHealth?.heartbeatSequence;
  if (
    data === null
    || typeof data.accepted !== 'boolean'
    || typeof data.conflict !== 'boolean'
    || !Number.isSafeInteger(heartbeatSequence)
    || !['HEALTHY', 'DELAYED', 'BLOCKED', 'UNKNOWN'].includes(String(state))
  ) throw new Error('Invalid driver sync heartbeat response');
  return {
    accepted: data.accepted,
    conflict: data.conflict,
    heartbeatSequence: heartbeatSequence as number,
    state: state as DriverSyncHeartbeatResult['state'],
  };
}
