import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createOfflineRetryScheduler } from './offlineRetryScheduler';
import {
  createInMemoryOfflineSubmissionQueue,
  recoverPendingRouteEndReceipt,
} from './offlineSubmissionQueue';

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
    scheduler.notifyConditionsChanged({ immediate: true });
    assert.deepEqual(delays, [0]);
  });

  it('backs off after a hung completion receipt and ignores late APPLIED until the next lookup', async () => {
    const routePlanId = 'route-completion-pending';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      appVersion: '1.1.6',
      assignmentGeneration: '11',
      clientEventId: 'completion-pending-timeout',
      driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-08-22T19:42:10.000Z'),
      routePlanId,
      versionCode: 116,
    });
    const retrySchedules: { delayMs: number; run: () => void }[] = [];
    const attemptExpirations: (() => void)[] = [];
    let lookupCount = 0;
    let resolveLateApplied!: () => void;
    const appliedReceipt = {
      assignmentGeneration: '11', clientEventId: item.event.clientEventId, errorCode: null,
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222', routePlanId,
      routeStatus: 'COMPLETED', status: 'APPLIED',
    } as const;
    const lookupReceipt = () => {
      lookupCount += 1;
      if (lookupCount === 1) {
        return new Promise<typeof appliedReceipt>((resolve) => {
          resolveLateApplied = () => resolve(appliedReceipt);
        });
      }
      return Promise.resolve(appliedReceipt);
    };
    const scheduler = createOfflineRetryScheduler({
      cancel: () => undefined,
      hasPendingSubmissions: () => queue.listPending().length > 0,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      retry: async () => (await recoverPendingRouteEndReceipt({
        attemptTimeoutMs: 100,
        cancelAttemptTimeout: () => undefined,
        driverEventReceiptService: { lookupReceipt },
        queue,
        routePlanId,
        scheduleAttemptTimeout: (expire) => { attemptExpirations.push(expire); return expire; },
      })) === 'acknowledged',
      schedule: (run, delayMs) => { retrySchedules.push({ delayMs, run }); return run; },
    });

    scheduler.start();
    const firstAttempt = retrySchedules.shift();
    assert.equal(firstAttempt?.delayMs, 1_000);
    firstAttempt?.run();
    attemptExpirations.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending()[0]?.lastErrorCode, 'OPERATION_TIMEOUT');
    assert.equal(retrySchedules[0]?.delayMs, 2_000);

    resolveLateApplied();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.listPending().length, 1);
    retrySchedules.shift()?.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lookupCount, 2);
    assert.equal(queue.listPending().length, 0);
    assert.deepEqual(retrySchedules, []);
    scheduler.stop();
  });
});
