import { runBoundedAsyncOperation } from '../domain/async/boundedAsyncOperation';
import type {
  DriverAccessRestoreResult,
  ExpectedDriverAccessIdentity,
} from '../domain/driver/driverAccessTokenStore';
import type { DriverAccountAccessToken } from '../domain/driverAuth/driverAuth';

export type DriverRestoreAttemptPhase = 'LOAD' | 'REFRESH' | 'SAVE';

export type DriverRestoreExpectedIdentity = ExpectedDriverAccessIdentity;

export type DriverRestoreAttemptResult =
  | {
      access: Extract<DriverAccessRestoreResult, { kind: 'active' }>;
      kind: 'restored';
    }
  | {
      access: Exclude<DriverAccessRestoreResult, { kind: 'active' | 'refresh_required' }>;
      kind: 'login_required';
    }
  | {
      error: unknown;
      expectedIdentity?: DriverRestoreExpectedIdentity;
      kind: 'retryable_failure';
      phase: DriverRestoreAttemptPhase;
      stillPending: boolean;
    }
  | { kind: 'stale' };

export class DriverRestorePhasePendingError extends Error {
  readonly phase: DriverRestoreAttemptPhase;

  constructor(phase: DriverRestoreAttemptPhase) {
    super(`DRIVER_RESTORE_${phase}_STILL_PENDING`);
    this.name = 'DriverRestorePhasePendingError';
    this.phase = phase;
  }
}

type PendingPhase = {
  expectedIdentity?: DriverRestoreExpectedIdentity;
  phase: DriverRestoreAttemptPhase;
  raw: Promise<unknown>;
};

export function createDriverRestoreAttemptCoordinator(input: {
  cancelTimeout?: (handle: unknown) => void;
  isCurrent?: () => boolean;
  load(signal: AbortSignal): Promise<DriverAccessRestoreResult>;
  operationTimeoutMs?: number;
  refresh(
    refreshToken: string,
    signal: AbortSignal,
  ): Promise<{ accountAccess: DriverAccountAccessToken }>;
  save(
    accountAccess: DriverAccountAccessToken,
    expectedIdentity: DriverRestoreExpectedIdentity,
    signal: AbortSignal,
  ): Promise<void>;
  scheduleTimeout?: (expire: () => void, timeoutMs: number) => unknown;
}) {
  let generation = 0;
  let inFlight: Promise<DriverRestoreAttemptResult> | null = null;
  let pendingPhase: PendingPhase | null = null;

  function current(expectedGeneration: number): boolean {
    return generation === expectedGeneration && (input.isCurrent?.() ?? true);
  }

  function runPhase<T>(
    phase: DriverRestoreAttemptPhase,
    operation: (signal: AbortSignal) => Promise<T>,
    expectedIdentity?: DriverRestoreExpectedIdentity,
  ): Promise<T> {
    return runBoundedAsyncOperation((signal) => {
      const raw = Promise.resolve().then(() => operation(signal));
      const pending: PendingPhase = {
        ...(expectedIdentity === undefined ? {} : { expectedIdentity }),
        phase,
        raw,
      };
      pendingPhase = pending;
      void raw.finally(() => {
        if (pendingPhase === pending) pendingPhase = null;
      }).catch(() => undefined);
      return raw;
    }, {
      ...(input.cancelTimeout === undefined ? {} : { cancel: input.cancelTimeout }),
      ...(input.scheduleTimeout === undefined ? {} : { schedule: input.scheduleTimeout }),
      timeoutMs: input.operationTimeoutMs ?? 5_000,
    });
  }

  async function runAttempt(expectedGeneration: number): Promise<DriverRestoreAttemptResult> {
    let loaded: DriverAccessRestoreResult;
    try {
      loaded = await runPhase('LOAD', input.load);
    } catch (error) {
      return {
        error,
        kind: 'retryable_failure',
        phase: 'LOAD',
        stillPending: pendingPhase?.phase === 'LOAD',
      };
    }
    if (!current(expectedGeneration)) return { kind: 'stale' };
    if (loaded.kind === 'active') return { access: loaded, kind: 'restored' };
    if (loaded.kind !== 'refresh_required') return { access: loaded, kind: 'login_required' };

    const expectedIdentity: DriverRestoreExpectedIdentity = {
      accessToken: loaded.accountAccess.accessToken,
      phoneE164: loaded.driverProfile.phoneE164,
      refreshToken: loaded.accountAccess.refreshToken,
    };

    let refreshed: { accountAccess: DriverAccountAccessToken };
    try {
      refreshed = await runPhase(
        'REFRESH',
        (signal) => input.refresh(loaded.accountAccess.refreshToken, signal),
        expectedIdentity,
      );
    } catch (error) {
      return {
        error,
        expectedIdentity,
        kind: 'retryable_failure',
        phase: 'REFRESH',
        stillPending: pendingPhase?.phase === 'REFRESH',
      };
    }
    if (!current(expectedGeneration)) return { kind: 'stale' };

    try {
      await runPhase('SAVE', (signal) => input.save(
        refreshed.accountAccess,
        expectedIdentity,
        signal,
      ), expectedIdentity);
    } catch (error) {
      return {
        error,
        expectedIdentity,
        kind: 'retryable_failure',
        phase: 'SAVE',
        stillPending: pendingPhase?.phase === 'SAVE',
      };
    }
    if (!current(expectedGeneration)) return { kind: 'stale' };
    return {
      access: {
        ...loaded,
        accountAccess: refreshed.accountAccess,
        kind: 'active',
      },
      kind: 'restored',
    };
  }

  function attempt(): Promise<DriverRestoreAttemptResult> {
    if (inFlight !== null) return inFlight;
    if (pendingPhase !== null) {
      return Promise.resolve({
        error: new DriverRestorePhasePendingError(pendingPhase.phase),
        ...(pendingPhase.expectedIdentity === undefined
          ? {}
          : { expectedIdentity: pendingPhase.expectedIdentity }),
        kind: 'retryable_failure',
        phase: pendingPhase.phase,
        stillPending: true,
      });
    }
    const expectedGeneration = generation;
    const attemptPromise = runAttempt(expectedGeneration).finally(() => {
      if (inFlight === attemptPromise) inFlight = null;
    });
    inFlight = attemptPromise;
    return attemptPromise;
  }

  return {
    attempt,
    invalidate: () => { generation += 1; },
  };
}
