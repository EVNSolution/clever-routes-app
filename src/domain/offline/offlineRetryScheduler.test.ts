import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createOfflineRetryScheduler } from './offlineRetryScheduler';

describe('offline retry scheduler', () => {
  it('retries pending work while the app remains online and foregrounded', async () => {
    const scheduled: { delayMs: number; run: () => void }[] = [];
    let attempts = 0;
    const scheduler = createOfflineRetryScheduler({
      hasPendingSubmissions: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      retry: async () => { attempts += 1; return true; },
      schedule: (run, delayMs) => {
        scheduled.push({ delayMs, run });
        return scheduled.length;
      },
      cancel: () => undefined,
    });

    scheduler.start();
    assert.equal(scheduled[0]?.delayMs, 1_000);
    scheduled.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(attempts, 1);
    assert.equal(scheduled[0]?.delayMs, 1_000);
  });

  it('uses bounded exponential backoff and jitter', () => {
    const delays: number[] = [];
    const scheduler = createOfflineRetryScheduler({
      hasPendingSubmissions: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 1,
      retry: async () => true,
      schedule: (_run, delayMs) => {
        delays.push(delayMs);
        return delays.length;
      },
      cancel: () => undefined,
      policy: { initialDelayMs: 1_000, maxDelayMs: 4_000, jitterRatio: 0.25 },
    });

    scheduler.start();
    scheduler.recordFailure();
    scheduler.recordFailure();
    scheduler.recordFailure();

    assert.deepEqual(delays, [1_250, 2_500, 4_000, 4_000]);
  });

  it('backs off when a retry pass completes with retained failures', async () => {
    const scheduled: { delayMs: number; run: () => void }[] = [];
    const scheduler = createOfflineRetryScheduler({
      hasPendingSubmissions: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      retry: async () => false,
      schedule: (run, delayMs) => {
        scheduled.push({ delayMs, run });
        return scheduled.length;
      },
      cancel: () => undefined,
    });

    scheduler.start();
    scheduled.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(scheduled[0]?.delayMs, 2_000);
  });

  it('does not schedule while offline/backgrounded and resumes on foreground', () => {
    const delays: number[] = [];
    let foreground = false;
    const scheduler = createOfflineRetryScheduler({
      hasPendingSubmissions: () => true,
      isForeground: () => foreground,
      isOnline: () => true,
      random: () => 0.5,
      retry: async () => true,
      schedule: (_run, delayMs) => {
        delays.push(delayMs);
        return delays.length;
      },
      cancel: () => undefined,
    });

    scheduler.start();
    assert.deepEqual(delays, []);
    foreground = true;
    scheduler.notifyConditionsChanged();
    assert.deepEqual(delays, [1_000]);
  });
});
