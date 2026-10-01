export const OFFLINE_RETRY_SCHEDULER_DEFAULT_POLICY = {
  initialDelayMs: 1_000,
  jitterRatio: 0.2,
  maxDelayMs: 60_000,
} as const;

export type OfflineRetrySchedulerPolicy = {
  initialDelayMs: number;
  jitterRatio: number;
  maxDelayMs: number;
};

export function createOfflineRetryScheduler(input: {
  cancel: (handle: unknown) => void;
  hasPendingSubmissions: () => boolean;
  isForeground: () => boolean;
  isOnline: () => boolean;
  now?: () => Date;
  onNextRetryAt?: (at: string | null) => void;
  policy?: OfflineRetrySchedulerPolicy;
  random?: () => number;
  retry: () => Promise<boolean>;
  schedule: (run: () => void, delayMs: number) => unknown;
}) {
  const policy = input.policy ?? OFFLINE_RETRY_SCHEDULER_DEFAULT_POLICY;
  const random = input.random ?? Math.random;
  let failureCount = 0;
  let handle: unknown;
  let running = false;
  let started = false;

  function reportNextRetry(at: string | null) {
    try { input.onNextRetryAt?.(at); } catch { /* diagnostics never change scheduling */ }
  }

  function cancelScheduled() {
    if (handle !== undefined) {
      input.cancel(handle);
      handle = undefined;
      reportNextRetry(null);
    }
  }

  function getDelayMs() {
    const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * (2 ** failureCount));
    const jitterMultiplier = 1 + ((Math.max(0, Math.min(1, random())) * 2 - 1) * policy.jitterRatio);
    return Math.max(0, Math.min(policy.maxDelayMs, Math.round(base * jitterMultiplier)));
  }

  function scheduleNext(delayOverrideMs?: number) {
    cancelScheduled();
    if (
      !started
      || running
      || !input.isOnline()
      || !input.isForeground()
      || !input.hasPendingSubmissions()
    ) {
      return;
    }
    const delayMs = delayOverrideMs ?? getDelayMs();
    reportNextRetry(new Date((input.now?.() ?? new Date()).getTime() + delayMs).toISOString());
    handle = input.schedule(() => {
      handle = undefined;
      reportNextRetry(null);
      running = true;
      void input.retry()
        .then((completedWithoutRetainedFailures) => {
          failureCount = completedWithoutRetainedFailures ? 0 : failureCount + 1;
        })
        .catch(() => { failureCount += 1; })
        .finally(() => {
          running = false;
          scheduleNext();
        });
    }, delayMs);
  }

  return {
    notifyConditionsChanged: (options?: { immediate?: boolean }) => {
      scheduleNext(options?.immediate === true ? 0 : undefined);
    },
    recordFailure: () => {
      failureCount += 1;
      scheduleNext();
    },
    start: () => {
      started = true;
      scheduleNext();
    },
    stop: () => {
      started = false;
      cancelScheduled();
    },
  };
}
