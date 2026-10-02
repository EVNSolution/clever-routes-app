import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import type {
  DriverDiagnosticContext,
  DriverDiagnosticEnvelope,
  DriverDiagnosticPermanentRejectionCode,
  DriverDiagnosticResponse,
  DriverDiagnosticSnapshot,
} from './driverDiagnosticContract';
import { isDriverDiagnosticPermanentRejectionCode, isSafeDiagnosticUuid } from './driverDiagnosticContract';
import type { DriverDiagnosticOutbox } from './driverDiagnosticOutbox';

export type DiagnosticCredential = { expiresAt: string; token: string };

export type DiagnosticCredentialStore = {
  get(accountOwnerHash: string): Promise<DiagnosticCredential | null>;
  remove(accountOwnerHash: string, expectedToken?: string): Promise<void>;
  set(accountOwnerHash: string, credential: DiagnosticCredential): Promise<void>;
};

export type DriverDiagnosticLiveState = {
  bootId: string;
  context: DriverDiagnosticContext;
  snapshot: DriverDiagnosticSnapshot;
};

export type DriverDiagnosticTransport = ReturnType<typeof createDriverDiagnosticTransport>;

function isCredentialCurrent(credential: DiagnosticCredential, now: Date) {
  const expiresAt = Date.parse(credential.expiresAt);
  const lifetimeMs = expiresAt - now.getTime();
  return Number.isFinite(expiresAt) && lifetimeMs > 30_000 && lifetimeMs <= 24 * 60 * 60 * 1_000 && credential.token.length > 0;
}

function hasHttpStatus(error: unknown, status: number) {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}

function parseBatchOutcome(response: unknown, sentIds: ReadonlySet<string>) {
  if (typeof response !== 'object' || response === null) return null;
  const candidate = response as Partial<DriverDiagnosticResponse>;
  if (
    !Array.isArray(candidate.acceptedDiagnosticIds) || !Array.isArray(candidate.rejectedDiagnostics)
    || typeof candidate.serverReceivedAt !== 'string' || !Number.isFinite(Date.parse(candidate.serverReceivedAt))
  ) return null;
  const accepted = new Set<string>();
  for (const id of candidate.acceptedDiagnosticIds) {
    if (!isSafeDiagnosticUuid(id) || !sentIds.has(id) || accepted.has(id)) return null;
    accepted.add(id);
  }
  const rejectedIds = new Set<string>();
  const rejected: { code: DriverDiagnosticPermanentRejectionCode; diagnosticId: string }[] = [];
  for (const rejection of candidate.rejectedDiagnostics) {
    if (
      typeof rejection !== 'object' || rejection === null
      || !isSafeDiagnosticUuid(rejection.diagnosticId) || !sentIds.has(rejection.diagnosticId)
      || rejectedIds.has(rejection.diagnosticId) || accepted.has(rejection.diagnosticId)
      || !isDriverDiagnosticPermanentRejectionCode(rejection.code)
    ) return null;
    rejectedIds.add(rejection.diagnosticId);
    rejected.push({ code: rejection.code, diagnosticId: rejection.diagnosticId });
  }
  return { acceptedIds: [...accepted], rejected };
}

export function createDriverDiagnosticTransport(input: {
  attemptTimeoutMs?: number;
  batchIdFactory: () => string;
  cancel?: (handle: unknown) => void;
  cancelAttemptTimeout?: (handle: unknown) => void;
  credentialStore: DiagnosticCredentialStore;
  deviceInstanceHash: string;
  minimumAttemptIntervalMs?: number;
  now?: () => Date;
  outbox: DriverDiagnosticOutbox;
  random?: () => number;
  register(input: { accountOwnerHash: string; deviceInstanceHash: string; signal: AbortSignal }): Promise<DiagnosticCredential>;
  schedule?: (run: () => void, delayMs: number) => unknown;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  send(input: {
    accountOwnerHash: string;
    credentialToken: string;
    envelope: DriverDiagnosticEnvelope;
    signal: AbortSignal;
  }): Promise<DriverDiagnosticResponse>;
}) {
  const now = input.now ?? (() => new Date());
  const random = input.random ?? Math.random;
  const schedule = input.schedule ?? ((run, delayMs) => setTimeout(run, delayMs));
  const cancel = input.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const minimumAttemptIntervalMs = input.minimumAttemptIntervalMs ?? 5_000;
  const boundedOptions = {
    ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
    ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
    timeoutMs: input.attemptTimeoutMs ?? 10_000,
  };
  const credentialCache = new Map<string, DiagnosticCredential>();
  let failureCount = 0;
  let inFlight: Promise<boolean> | null = null;
  let retryHandle: unknown;
  let immediateHandle: unknown;
  let latestProvider: (() => DriverDiagnosticLiveState | null) | null = null;
  let pendingImmediate = false;
  let pendingOverride = false;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let lifecycleGeneration = 0;
  let stopped = false;

  function cancelHandle(kind: 'immediate' | 'retry') {
    const handle = kind === 'immediate' ? immediateHandle : retryHandle;
    if (handle === undefined) return;
    cancel(handle);
    if (kind === 'immediate') immediateHandle = undefined;
    else retryHandle = undefined;
  }

  function nextBackoffMs() {
    const base = Math.min(5 * 60_000, 1_000 * (2 ** Math.min(failureCount, 9)));
    const jitter = 0.8 + (Math.max(0, Math.min(1, random())) * 0.4);
    return Math.max(minimumAttemptIntervalMs, Math.round(base * jitter));
  }

  function scheduleRetry() {
    if (stopped || retryHandle !== undefined || latestProvider === null) return;
    retryHandle = schedule(() => {
      retryHandle = undefined;
      const provider = latestProvider;
      if (provider !== null) void flush(provider);
    }, nextBackoffMs());
  }

  function persistCredential(
    owner: string,
    ownerGeneration: number,
    operationGeneration: number,
    credential: DiagnosticCredential,
  ) {
    const mutation = input.credentialStore.set(owner, credential);
    void mutation.then(() => {
      if (
        stopped || lifecycleGeneration !== operationGeneration
        || input.outbox.getGeneration() !== ownerGeneration || input.outbox.getAccountOwnerHash() !== owner
      ) {
        void runBoundedAsyncOperation(
          () => input.credentialStore.remove(owner, credential.token),
          boundedOptions,
        ).catch(() => undefined);
      }
    }, () => undefined);
    void runBoundedAsyncOperation(() => mutation, boundedOptions).catch(() => undefined);
  }

  async function getCredential(owner: string, ownerGeneration: number, operationGeneration: number): Promise<DiagnosticCredential | null> {
    const stillCurrent = () => !stopped
      && lifecycleGeneration === operationGeneration
      && input.outbox.getGeneration() === ownerGeneration
      && input.outbox.getAccountOwnerHash() === owner;
    const cached = credentialCache.get(owner);
    if (cached !== undefined && isCredentialCurrent(cached, now())) return cached;
    let stored: DiagnosticCredential | null = null;
    try {
      stored = await runBoundedAsyncOperation(() => input.credentialStore.get(owner), boundedOptions);
    } catch {
      stored = null;
    }
    if (!stillCurrent()) return null;
    if (stored !== null && isCredentialCurrent(stored, now())) {
      credentialCache.set(owner, stored);
      return stored;
    }
    try {
      const registered = await runBoundedAsyncOperation(
        (signal) => input.register({ accountOwnerHash: owner, deviceInstanceHash: input.deviceInstanceHash, signal }),
        boundedOptions,
      );
      if (!stillCurrent() || !isCredentialCurrent(registered, now())) return null;
      credentialCache.set(owner, registered);
      persistCredential(owner, ownerGeneration, operationGeneration, registered);
      return registered;
    } catch {
      return null;
    }
  }

  async function runFlush(
    provider: () => DriverDiagnosticLiveState | null,
    operationGeneration: number,
  ): Promise<{ shouldDrain: boolean; succeeded: boolean }> {
    const owner = input.outbox.getAccountOwnerHash();
    const ownerGeneration = input.outbox.getGeneration();
    const credential = await getCredential(owner, ownerGeneration, operationGeneration);
    if (credential === null) return { shouldDrain: false, succeeded: false };
    const live = provider();
    if (live === null) return { shouldDrain: false, succeeded: false };
    try {
      const envelope = input.outbox.buildBatch({
        batchId: input.batchIdFactory(), bootId: live.bootId,
        liveContext: live.context, liveSnapshot: live.snapshot,
      });
      const response = await runBoundedAsyncOperation(
        (signal) => input.send({ accountOwnerHash: owner, credentialToken: credential.token, envelope, signal }),
        boundedOptions,
      );
      if (
        stopped || lifecycleGeneration !== operationGeneration
        || input.outbox.getGeneration() !== ownerGeneration || input.outbox.getAccountOwnerHash() !== owner
      ) return { shouldDrain: false, succeeded: false };
      const sentIds = new Set(envelope.records.map(({ diagnosticId }) => diagnosticId));
      const outcome = parseBatchOutcome(response, sentIds);
      if (outcome === null || (envelope.records.length > 0 && outcome.acceptedIds.length + outcome.rejected.length === 0)) {
        return { shouldDrain: false, succeeded: false };
      }
      input.outbox.acknowledge(outcome.acceptedIds, owner);
      input.outbox.quarantine(outcome.rejected, owner, now().toISOString());
      return { shouldDrain: input.outbox.listPending().length > 0, succeeded: true };
    } catch (error) {
      if (hasHttpStatus(error, 401)) {
        credentialCache.delete(owner);
        void runBoundedAsyncOperation(
          () => input.credentialStore.remove(owner, credential.token),
          boundedOptions,
        ).catch(() => undefined);
      }
      return { shouldDrain: false, succeeded: false };
    }
  }

  function flush(
    provider: () => DriverDiagnosticLiveState | null,
    options?: { overrideBackoff?: boolean; skipMinimumInterval?: boolean },
  ): Promise<boolean> {
    latestProvider = provider;
    if (stopped) return Promise.resolve(false);
    if (options?.overrideBackoff === true) cancelHandle('retry');
    else if (retryHandle !== undefined) return Promise.resolve(false);
    cancelHandle('immediate');
    if (inFlight !== null) {
      pendingImmediate = true;
      pendingOverride ||= options?.overrideBackoff === true;
      return inFlight;
    }
    const remainingInterval = options?.skipMinimumInterval === true
      ? 0
      : Math.max(0, minimumAttemptIntervalMs - (now().getTime() - lastAttemptAt));
    if (remainingInterval > 0) {
      if (immediateHandle === undefined) {
        immediateHandle = schedule(() => {
          immediateHandle = undefined;
          const currentProvider = latestProvider;
          if (currentProvider !== null) void flush(currentProvider, options);
        }, remainingInterval);
      }
      return Promise.resolve(false);
    }
    const operationGeneration = lifecycleGeneration;
    lastAttemptAt = now().getTime();
    let completedSuccessfully = false;
    let shouldDrain = false;
    inFlight = runFlush(provider, operationGeneration)
      .then((outcome) => {
        if (stopped || lifecycleGeneration !== operationGeneration) return false;
        completedSuccessfully = outcome.succeeded;
        shouldDrain = outcome.shouldDrain;
        if (outcome.succeeded) {
          failureCount = 0;
          cancelHandle('retry');
        } else {
          failureCount += 1;
          scheduleRetry();
        }
        return outcome.succeeded;
      })
      .finally(() => {
        inFlight = null;
        if (stopped) return;
        if (!completedSuccessfully) {
          pendingImmediate = false;
          pendingOverride = false;
          return;
        }
        if ((pendingImmediate || shouldDrain) && latestProvider !== null) {
          const providerAfterCompletion = latestProvider;
          const overrideBackoff = pendingOverride;
          pendingImmediate = false;
          pendingOverride = false;
          requestImmediate(providerAfterCompletion, { overrideBackoff });
        }
      });
    return inFlight;
  }

  function requestImmediate(provider: () => DriverDiagnosticLiveState | null, options?: { overrideBackoff?: boolean }) {
    latestProvider = provider;
    if (stopped) return;
    if (inFlight !== null) {
      pendingImmediate = true;
      pendingOverride ||= options?.overrideBackoff === true;
      return;
    }
    if (immediateHandle !== undefined) return;
    if (retryHandle !== undefined && options?.overrideBackoff !== true) return;
    if (options?.overrideBackoff === true) cancelHandle('retry');
    const delayMs = Math.max(0, minimumAttemptIntervalMs - (now().getTime() - lastAttemptAt));
    immediateHandle = schedule(() => {
      immediateHandle = undefined;
      const currentProvider = latestProvider;
      if (currentProvider !== null) void flush(currentProvider, options);
    }, delayMs);
  }

  async function flushBeforeDetach(provider: () => DriverDiagnosticLiveState | null) {
    latestProvider = provider;
    cancelHandle('immediate');
    cancelHandle('retry');
    const running = inFlight;
    if (running !== null) await running.catch(() => false);
    if (stopped) return false;
    cancelHandle('immediate');
    cancelHandle('retry');
    pendingImmediate = false;
    pendingOverride = false;
    return flush(provider, { overrideBackoff: true, skipMinimumInterval: true });
  }

  return {
    flush,
    flushBeforeDetach,
    requestImmediate,
    stop: () => {
      stopped = true;
      lifecycleGeneration += 1;
      cancelHandle('immediate');
      cancelHandle('retry');
      latestProvider = null;
      pendingImmediate = false;
      pendingOverride = false;
    },
  };
}
