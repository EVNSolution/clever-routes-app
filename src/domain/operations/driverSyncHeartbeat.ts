import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import type {
  OfflineCompletionClearOutboxEntry,
  OfflineSubmissionQueue,
} from '../offline/offlineSubmissionQueue';

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
  accessIdentity: DriverCompletionClearRouteAccessIdentity;
  appVersion: string;
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  completedStopCount: number | null;
  driverContractVersion: 2;
  heartbeatService: DriverSyncHeartbeatService;
  identityService: DriverSyncIdentityService;
  isAttemptCurrent?: () => boolean;
  lifecycleSignal?: AbortSignal;
  outboxEntry: OfflineCompletionClearOutboxEntry;
  queue: OfflineSubmissionQueue;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  sessionKey: string;
  versionCode: number;
};

export type DriverCompletionClearRouteAccessIdentity = {
  assignmentGeneration: string;
  driverContractVersion: 2;
  routePlanId: string;
};

function hasExactCompletionClearAccess(
  entry: OfflineCompletionClearOutboxEntry,
  access: DriverCompletionClearRouteAccessIdentity,
): boolean {
  return entry.assignmentGeneration === access.assignmentGeneration
    && entry.driverContractVersion === access.driverContractVersion
    && entry.routePlanId === access.routePlanId;
}

function hasExactCompletionClearEntry(
  queue: OfflineSubmissionQueue,
  expected: OfflineCompletionClearOutboxEntry,
): boolean {
  return queue.listPendingCompletionClearEntries().some((entry) => (
    entry.accountOwnerHash === expected.accountOwnerHash
    && entry.assignmentGeneration === expected.assignmentGeneration
    && entry.completionClientEventId === expected.completionClientEventId
    && entry.driverContractVersion === expected.driverContractVersion
    && entry.routePlanId === expected.routePlanId
  ));
}

export type DriverCompletionClearHeartbeatOutcome = {
  failure: 'conflict' | 'failed' | 'not_pending' | 'unauthorized' | null;
  observed: boolean;
  result: DriverSyncHeartbeatResult | null;
};

export async function attemptDriverCompletionClearHeartbeat(
  input: DriverCompletionClearHeartbeatAttempt,
): Promise<DriverCompletionClearHeartbeatOutcome> {
  const routePlanId = input.outboxEntry.routePlanId;
  const queueProjection = projectDriverSyncQueueState(input.queue, routePlanId);
  if (
    queueProjection.finishPending
    || queueProjection.lastAcknowledgedAt === null
    || input.queue.getAccountOwnerHash() !== input.outboxEntry.accountOwnerHash
    || !hasExactCompletionClearAccess(input.outboxEntry, input.accessIdentity)
    || !hasExactCompletionClearEntry(input.queue, input.outboxEntry)
  ) {
    return { failure: 'not_pending', observed: false, result: null };
  }
  let deliveredMarkerWritten = false;
  let serverResult: DriverSyncHeartbeatResult | null = null;
  try {
    const result = await runBoundedAsyncOperation(async (signal) => {
      const identity = await input.identityService.next(input.sessionKey);
      const heartbeatResult = await input.heartbeatService.recordHeartbeat({
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
      serverResult = heartbeatResult;
      if (input.isAttemptCurrent?.() === false) return heartbeatResult;
      if (!heartbeatResult.accepted || heartbeatResult.conflict) return heartbeatResult;
      if (!input.queue.markCompletionClearHeartbeatDelivered(input.outboxEntry)) return heartbeatResult;
      deliveredMarkerWritten = true;
      await input.queue.whenPersisted();
      return heartbeatResult;
    }, {
      ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
      ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
      ...(input.lifecycleSignal === undefined ? {} : { signal: input.lifecycleSignal }),
      timeoutMs: input.attemptTimeoutMs ?? 15_000,
    });
    if (input.isAttemptCurrent?.() === false) {
      return { failure: 'failed', observed: false, result };
    }
    if (!result.accepted || result.conflict) {
      return { failure: result.conflict ? 'conflict' : 'failed', observed: false, result };
    }
    if (!deliveredMarkerWritten) {
      return { failure: 'failed', observed: false, result };
    }
    return { failure: null, observed: true, result };
  } catch (error) {
    if (deliveredMarkerWritten) input.queue.reopenCompletionClearHeartbeat(input.outboxEntry);
    return {
      failure: error instanceof DriverSyncHeartbeatHttpError && error.status === 401 ? 'unauthorized' : 'failed',
      observed: false,
      result: serverResult,
    };
  }
}

export async function deliverDriverCompletionClearHeartbeat(input: {
  attempt: DriverCompletionClearHeartbeatAttempt;
  refreshHeartbeatAccess?: (signal: AbortSignal) => Promise<{
    accessIdentity: DriverCompletionClearRouteAccessIdentity;
    heartbeatService: DriverSyncHeartbeatService;
  } | null>;
}): Promise<DriverCompletionClearHeartbeatOutcome> {
  const first = await attemptDriverCompletionClearHeartbeat(input.attempt);
  if (first.failure !== 'unauthorized' || input.refreshHeartbeatAccess === undefined) return first;
  let refreshedAccess: Awaited<ReturnType<NonNullable<typeof input.refreshHeartbeatAccess>>>;
  try {
    refreshedAccess = await runBoundedAsyncOperation(input.refreshHeartbeatAccess, {
      ...(input.attempt.cancelAttemptTimeout === undefined ? {} : { cancel: input.attempt.cancelAttemptTimeout }),
      ...(input.attempt.scheduleAttemptTimeout === undefined ? {} : { schedule: input.attempt.scheduleAttemptTimeout }),
      ...(input.attempt.lifecycleSignal === undefined ? {} : { signal: input.attempt.lifecycleSignal }),
      timeoutMs: input.attempt.attemptTimeoutMs ?? 15_000,
    });
  } catch {
    return first;
  }
  if (
    refreshedAccess === null
    || !hasExactCompletionClearAccess(input.attempt.outboxEntry, refreshedAccess.accessIdentity)
  ) return first;
  return attemptDriverCompletionClearHeartbeat({
    ...input.attempt,
    accessIdentity: refreshedAccess.accessIdentity,
    heartbeatService: refreshedAccess.heartbeatService,
  });
}

export class DriverSyncHeartbeatHttpError extends Error {
  constructor(readonly status: number) {
    super(`Driver sync heartbeat failed (${status})`);
  }
}

export class DriverSyncHeartbeatRateLimitError extends Error {
  constructor() {
    super('Driver sync heartbeat route rate limit reached');
    this.name = 'DriverSyncHeartbeatRateLimitError';
  }
}

export type DriverSyncHeartbeatRateLimiter = {
  tryAcquire(routePlanId: string): boolean;
};

export function createDriverSyncHeartbeatRateLimiter(input?: {
  maxWritesPerWindow?: number;
  now?: () => number;
  windowMs?: number;
}): DriverSyncHeartbeatRateLimiter {
  const maxWrites = input?.maxWritesPerWindow ?? 2;
  const now = input?.now ?? Date.now;
  const windowMs = input?.windowMs ?? 60_000;
  const writesByRoute = new Map<string, number[]>();
  return {
    tryAcquire(routePlanId) {
      const currentTime = now();
      const recent = (writesByRoute.get(routePlanId) ?? [])
        .filter((timestamp) => timestamp > currentTime - windowMs);
      if (recent.length >= maxWrites) {
        writesByRoute.set(routePlanId, recent);
        return false;
      }
      writesByRoute.set(routePlanId, [...recent, currentTime]);
      return true;
    },
  };
}

export function createRateLimitedDriverSyncHeartbeatService(input: {
  limiter: DriverSyncHeartbeatRateLimiter;
  routePlanId: string;
  service: DriverSyncHeartbeatService;
}): DriverSyncHeartbeatService {
  return {
    recordHeartbeat(request, options) {
      if (!input.limiter.tryAcquire(input.routePlanId)) {
        throw new DriverSyncHeartbeatRateLimitError();
      }
      return input.service.recordHeartbeat(request, options);
    },
  };
}

export function combineDriverSyncAbortSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal?.aborted === true) {
      controller.abort();
      break;
    }
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export async function flushDriverCompletionClearOutboxEntries(input: {
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  deliver(entry: OfflineCompletionClearOutboxEntry, signal: AbortSignal): Promise<boolean>;
  entries: readonly OfflineCompletionClearOutboxEntry[];
  isCurrent?: () => boolean;
  lifecycleSignal?: AbortSignal;
  resolveAccess(entry: OfflineCompletionClearOutboxEntry, signal: AbortSignal): Promise<boolean>;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  startIndex: number;
}): Promise<{ delivered: number; nextIndex: number }> {
  if (input.entries.length === 0) return { delivered: 0, nextIndex: 0 };
  const startIndex = Math.max(0, input.startIndex) % input.entries.length;
  const orderedEntries: OfflineCompletionClearOutboxEntry[] = [];
  for (let offset = 0; offset < input.entries.length; offset += 1) {
    const index = (startIndex + offset) % input.entries.length;
    orderedEntries.push(input.entries[index]!);
  }
  const outcomes = await Promise.all(orderedEntries.map(async (entry) => {
    try {
      return await runBoundedAsyncOperation(async (signal) => {
        if (input.isCurrent?.() === false) return false;
        if (!await input.resolveAccess(entry, signal)) return false;
        if (signal.aborted || input.isCurrent?.() === false) return false;
        const delivered = await input.deliver(entry, signal);
        return !signal.aborted && input.isCurrent?.() !== false && delivered;
      }, {
        ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
        ...(input.lifecycleSignal === undefined ? {} : { signal: input.lifecycleSignal }),
        ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
        timeoutMs: input.attemptTimeoutMs ?? 15_000,
      });
    } catch {
      return false;
    }
  }));
  const delivered = outcomes.filter(Boolean).length;
  return { delivered, nextIndex: (startIndex + 1) % input.entries.length };
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
    stop(options?: { carryImmediate?: boolean }) {
      if (!started) return false;
      const carryImmediateRequest = immediateRequested || running;
      started = false;
      immediateRequested = false;
      inFlightAbortController?.abort();
      inFlightAbortController = null;
      cancelScheduled();
      return options?.carryImmediate === true && carryImmediateRequest;
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
