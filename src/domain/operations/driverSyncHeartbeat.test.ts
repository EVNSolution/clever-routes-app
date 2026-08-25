import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attemptDriverCompletionClearHeartbeat,
  createDriverSyncHeartbeatRateLimiter,
  createDriverSyncHeartbeatApiClient,
  createDriverSyncHeartbeatScheduler,
  createRateLimitedDriverSyncHeartbeatService,
  createDriverSyncTakeoverApiClient,
  deliverDriverCompletionClearHeartbeat,
  DriverSyncHeartbeatHttpError,
  DriverSyncHeartbeatRateLimitError,
  flushDriverCompletionClearOutboxRoutes,
  projectDriverSyncHeartbeatForEpoch,
  projectLatestDriverSyncHeartbeat,
} from './driverSyncHeartbeat';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

const request = {
  appVersion: '2.8.0',
  clientOccurredAt: '2026-08-22T14:05:00.000Z',
  completedStopCount: 1,
  currentStopSequence: 11,
  deviceInstanceHash: 'a'.repeat(64),
  driverContractVersion: 2,
  finishPending: true,
  firstErrorCode: 'RESPONSE_LOST',
  firstFailedAt: '2026-08-22T14:04:50.000Z',
  heartbeatSequence: 9,
  lastAcknowledgedAt: null,
  lastErrorCode: 'RESPONSE_LOST',
  lastRetryAt: '2026-08-22T14:04:55.000Z',
  locallyFinished: true,
  nextRetryAt: '2026-08-22T14:05:15.000Z',
  oldestQueuedAt: '2026-08-22T14:04:50.000Z',
  queueDepth: 1,
  retryCount: 1,
  retryJournal: [{ errorCode: 'RESPONSE_LOST', observedAt: '2026-08-22T14:04:50.000Z' }],
  sessionGeneration: '2026-08-22T12:00:00.000Z',
  totalStopCount: 14,
  versionCode: 20800,
} as const;

describe('driver sync heartbeat', () => {
  it('uses the route token channel and preserves the exact independent heartbeat payload', async () => {
    let captured: { body?: unknown; authorization?: string; method?: string; url?: string } = {};
    const client = createDriverSyncHeartbeatApiClient({
      accessToken: 'route-token',
      baseUrl: 'https://route.test',
      fetchImpl: async (url, init) => {
        captured = {
          authorization: init?.headers?.Authorization,
          body: JSON.parse(String(init?.body)),
          method: init?.method,
          url,
        };
        return new Response(JSON.stringify({
          data: {
            accepted: true,
            conflict: false,
            syncHealth: { heartbeatSequence: 9, state: 'HEALTHY' },
          },
          error: null,
        }), { status: 200 });
      },
    });

    assert.deepEqual(await client.recordHeartbeat(request), {
      accepted: true,
      conflict: false,
      heartbeatSequence: 9,
      state: 'HEALTHY',
    });
    assert.deepEqual(captured, {
      authorization: 'Bearer route-token',
      body: request,
      method: 'PUT',
      url: 'https://route.test/driver/sync-health',
    });
  });

  it('runs while ordered evidence is blocked and applies bounded backoff with jitter', async () => {
    const delays: number[] = [];
    const scheduled: (() => void)[] = [];
    let calls = 0;
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      isDegraded: () => true,
      random: () => 0.5,
      schedule: (run, delayMs) => { delays.push(delayMs); scheduled.push(run); return run; },
      sendHeartbeat: async () => { calls += 1; return calls > 1; },
    });

    scheduler.start();
    assert.deepEqual(delays, [30_000]);
    scheduled.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delays, [30_000, 60_000]);
    scheduled.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delays, [30_000, 60_000, 30_000]);
    assert.equal(calls, 2);
    scheduler.stop();
  });

  it('releases a wedged heartbeat attempt after timeout and ignores its late resolution', async () => {
    const retries: { delayMs: number; run: () => void }[] = [];
    const attemptExpirations: (() => void)[] = [];
    let resolveHung!: (accepted: boolean) => void;
    const scheduler = createDriverSyncHeartbeatScheduler({
      attemptTimeoutMs: 100,
      cancel: () => undefined,
      cancelAttemptTimeout: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      schedule: (run, delayMs) => { retries.push({ delayMs, run }); return run; },
      scheduleAttemptTimeout: (expire) => { attemptExpirations.push(expire); return expire; },
      sendHeartbeat: () => new Promise<boolean>((resolve) => { resolveHung = resolve; }),
    });

    scheduler.start();
    retries.shift()?.run();
    attemptExpirations.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(retries.map(({ delayMs }) => delayMs), [120_000]);

    resolveHung(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(retries.map(({ delayMs }) => delayMs), [120_000]);
    scheduler.stop();
  });

  it('sends an immediate heartbeat when durable completion state changes', async () => {
    const scheduled: { delayMs: number; run: () => void }[] = [];
    const cancelled: unknown[] = [];
    let calls = 0;
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: (handle) => { cancelled.push(handle); },
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      schedule: (run, delayMs) => {
        const handle = { delayMs, run };
        scheduled.push(handle);
        return handle;
      },
      sendHeartbeat: async () => { calls += 1; return true; },
    });

    scheduler.start();
    scheduler.requestImmediate();
    assert.equal(calls, 1);
    assert.equal(cancelled.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduled.at(-1)?.delayMs, 60_000);
    scheduler.stop();
  });

  it('does not lose an immediate request made before the scheduler starts', async () => {
    let calls = 0;
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      schedule: () => ({}),
      sendHeartbeat: async () => { calls += 1; return true; },
    });

    scheduler.requestImmediate();
    assert.equal(calls, 0);
    scheduler.start();
    assert.equal(calls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.stop();
  });

  it('carries an offline immediate request across scheduler remount', async () => {
    let online = false;
    let calls = 0;
    const input = {
      cancel: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => online,
      schedule: () => ({}),
      sendHeartbeat: async () => { calls += 1; return true; },
    };
    const first = createDriverSyncHeartbeatScheduler(input);
    first.start();
    first.requestImmediate();
    assert.equal(calls, 0);
    const carry = first.stop({ carryImmediate: true });
    assert.equal(carry, true);

    const second = createDriverSyncHeartbeatScheduler(input);
    if (carry) second.requestImmediate();
    online = true;
    second.start();
    assert.equal(calls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    second.stop();
  });

  it('uses healthy 60-second and degraded 30-second cadence within two writes per route per minute', () => {
    const healthyDelays: number[] = [];
    const degradedDelays: number[] = [];
    const create = (degraded: boolean, delays: number[]) => createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isDegraded: () => degraded,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0.5,
      schedule: (_run, delay) => { delays.push(delay); return {}; },
      sendHeartbeat: async () => true,
    });
    const healthy = create(false, healthyDelays);
    const degraded = create(true, degradedDelays);
    healthy.start();
    degraded.start();
    assert.deepEqual(healthyDelays, [60_000]);
    assert.deepEqual(degradedDelays, [30_000]);
    assert.ok(60_000 / degradedDelays[0]! <= 2);
    healthy.stop();
    degraded.stop();
  });

  it('never jitters degraded cadence below the two-writes-per-route-per-minute ceiling', () => {
    const delays: number[] = [];
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isDegraded: () => true,
      isForeground: () => true,
      isOnline: () => true,
      random: () => 0,
      schedule: (_run, delay) => { delays.push(delay); return {}; },
      sendHeartbeat: async () => true,
    });
    scheduler.start();
    assert.deepEqual(delays, [30_000]);
    assert.ok(60_000 / delays[0]! <= 2);
    scheduler.stop();
  });

  it('aborts an in-flight request when the scheduler account lifecycle stops', async () => {
    const observedSignals: AbortSignal[] = [];
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      schedule: () => ({}),
      sendHeartbeat: (signal) => {
        observedSignals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    });
    scheduler.start();
    scheduler.requestImmediate();
    assert.equal(observedSignals[0]?.aborted, false);
    assert.equal(scheduler.stop(), false);
    assert.equal(observedSignals[0]?.aborted, true);
    assert.equal(scheduler.stop({ carryImmediate: true }), false);
  });

  it('coalesces duplicate immediate requests while one heartbeat is running', async () => {
    let calls = 0;
    let resolveFirst!: (accepted: boolean) => void;
    const scheduler = createDriverSyncHeartbeatScheduler({
      cancel: () => undefined,
      hasActiveSession: () => true,
      isForeground: () => true,
      isOnline: () => true,
      schedule: () => ({}),
      sendHeartbeat: () => {
        calls += 1;
        return calls === 1 ? new Promise<boolean>((resolve) => { resolveFirst = resolve; }) : Promise.resolve(true);
      },
    });

    scheduler.start();
    scheduler.requestImmediate();
    scheduler.requestImmediate();
    scheduler.requestImmediate();
    assert.equal(calls, 1);
    resolveFirst(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    scheduler.stop();
  });

  it('does not regress local sync projection when an older heartbeat response arrives late', () => {
    const current = { accepted: true, conflict: false, heartbeatSequence: 12, state: 'HEALTHY' as const };
    const late = { accepted: true, conflict: true, heartbeatSequence: 11, state: 'BLOCKED' as const };
    assert.equal(projectLatestDriverSyncHeartbeat(current, late), current);
    assert.deepEqual(projectLatestDriverSyncHeartbeat(current, {
      accepted: true, conflict: false, heartbeatSequence: 13, state: 'DELAYED',
    }), {
      accepted: true, conflict: false, heartbeatSequence: 13, state: 'DELAYED',
    });
  });

  it('rejects a late account-A response after logout advances the session epoch', () => {
    const accountB = { accepted: true, conflict: false, heartbeatSequence: 2, state: 'HEALTHY' as const };
    const lateAccountA = { accepted: true, conflict: true, heartbeatSequence: 99, state: 'BLOCKED' as const };
    assert.equal(projectDriverSyncHeartbeatForEpoch(accountB, lateAccountA, 4, 5), accountB);
    assert.deepEqual(projectDriverSyncHeartbeatForEpoch(accountB, {
      accepted: true, conflict: false, heartbeatSequence: 3, state: 'DELAYED',
    }, 5, 5), {
      accepted: true, conflict: false, heartbeatSequence: 3, state: 'DELAYED',
    });
  });

  it('bounds identity persistence rejection and hangs before touching the server', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const createQueue = () => {
      const queue = createInMemoryOfflineSubmissionQueue();
      const item = queue.enqueueDriverEvent({
        clientEventId: 'completed', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
      });
      queue.acknowledge(item.queueItemId);
      return queue;
    };
    let serverCalls = 0;
    const rejected = await attemptDriverCompletionClearHeartbeat({
      appVersion: '1.2.0', completedStopCount: 11, driverContractVersion: 2,
      heartbeatService: { recordHeartbeat: async () => { serverCalls += 1; throw new Error('unused'); } },
      identityService: { next: async () => { throw new Error('secure store rejected'); } },
      queue: createQueue(), routePlanId, sessionKey: 'account:route:generation', versionCode: 18,
    });
    assert.equal(rejected.failure, 'failed');

    const expirations: (() => void)[] = [];
    const hungPromise = attemptDriverCompletionClearHeartbeat({
      appVersion: '1.2.0', attemptTimeoutMs: 10, cancelAttemptTimeout: () => undefined,
      completedStopCount: 11, driverContractVersion: 2,
      heartbeatService: { recordHeartbeat: async () => { serverCalls += 1; throw new Error('unused'); } },
      identityService: { next: () => new Promise(() => undefined) }, queue: createQueue(), routePlanId,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
      sessionKey: 'account:route:generation', versionCode: 18,
    });
    expirations.shift()?.();
    const hung = await hungPromise;
    assert.equal(hung.failure, 'failed');
    assert.equal(serverCalls, 0);
  });

  it('keeps the durable ACK-clear outbox until an accepted server observation', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'completed', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    queue.acknowledge(item.queueItemId);
    const base = {
      appVersion: '1.2.0', completedStopCount: 11, driverContractVersion: 2 as const,
      identityService: { next: async () => ({
        deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 1, sessionGeneration: 'generation',
      }) },
      queue, routePlanId, sessionKey: 'account:route:generation', versionCode: 18,
    };
    const unauthorized = await attemptDriverCompletionClearHeartbeat({
      ...base,
      heartbeatService: { recordHeartbeat: async () => { throw new DriverSyncHeartbeatHttpError(401); } },
    });
    assert.equal(unauthorized.failure, 'unauthorized');
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);

    let signal: AbortSignal | undefined;
    const accepted = await attemptDriverCompletionClearHeartbeat({
      ...base,
      heartbeatService: { recordHeartbeat: async (_request, options) => {
        signal = options?.signal;
        return { accepted: true, conflict: false, heartbeatSequence: 2, state: 'HEALTHY' };
      } },
    });
    assert.equal(signal instanceof AbortSignal, true);
    assert.equal(accepted.observed, true);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), []);
  });

  it('bounds a hung delivered-marker persistence without losing accepted evidence or closing the outbox', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const baseQueue = createInMemoryOfflineSubmissionQueue();
    const item = baseQueue.enqueueDriverEvent({
      clientEventId: 'accepted-persist-hang', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    baseQueue.acknowledge(item.queueItemId);
    const queue = { ...baseQueue, whenPersisted: () => new Promise<void>(() => undefined) };
    const expirations: (() => void)[] = [];
    const attempt = attemptDriverCompletionClearHeartbeat({
      appVersion: '1.2.0', attemptTimeoutMs: 10, cancelAttemptTimeout: () => undefined,
      completedStopCount: null, driverContractVersion: 2,
      heartbeatService: { recordHeartbeat: async () => ({
        accepted: true, conflict: false, heartbeatSequence: 3, state: 'HEALTHY',
      }) },
      identityService: { next: async () => ({
        deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 3, sessionGeneration: 'generation',
      }) },
      queue, routePlanId,
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
      sessionKey: 'account:route:generation', versionCode: 18,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expirations.shift()?.();
    const outcome = await attempt;
    assert.equal(outcome.observed, false);
    assert.deepEqual(outcome.result, {
      accepted: true, conflict: false, heartbeatSequence: 3, state: 'HEALTHY',
    });
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
  });

  it('aborts ACK-clear identity and transport work on logout while preserving the account outbox', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'logout-abort', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    queue.acknowledge(item.queueItemId);
    const lifecycle = new AbortController();
    const attempt = attemptDriverCompletionClearHeartbeat({
      appVersion: '1.2.0', completedStopCount: null, driverContractVersion: 2,
      heartbeatService: { recordHeartbeat: () => new Promise(() => undefined) },
      identityService: { next: async () => ({
        deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 1, sessionGeneration: 'generation-a',
      }) },
      lifecycleSignal: lifecycle.signal,
      queue, routePlanId, sessionKey: 'account-a:route:generation', versionCode: 18,
    });
    lifecycle.abort();
    assert.equal((await attempt).observed, false);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
  });

  it('fairly attempts route B when route A access is missing and rotates the next start', async () => {
    const delivered: string[] = [];
    const result = await flushDriverCompletionClearOutboxRoutes({
      deliver: async (routePlanId) => { delivered.push(routePlanId); return true; },
      resolveAccess: async (routePlanId) => routePlanId === 'route-b',
      routePlanIds: ['route-a', 'route-b'],
      startIndex: 0,
    });
    assert.deepEqual(delivered, ['route-b']);
    assert.deepEqual(result, { delivered: 1, nextIndex: 1 });
  });

  it('delivers route B without waiting for a hung route-A token recovery lane', async () => {
    const delivered: string[] = [];
    const expirations: (() => void)[] = [];
    const flush = flushDriverCompletionClearOutboxRoutes({
      attemptTimeoutMs: 10,
      cancelAttemptTimeout: () => undefined,
      deliver: async (routePlanId) => { delivered.push(routePlanId); return true; },
      resolveAccess: (routePlanId) => routePlanId === 'route-a'
        ? new Promise(() => undefined)
        : Promise.resolve(true),
      routePlanIds: ['route-a', 'route-b'],
      scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
      startIndex: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delivered, ['route-b']);
    expirations[0]?.();
    assert.deepEqual(await flush, { delivered: 1, nextIndex: 1 });
  });

  it('hard-limits combined periodic, pending, and ACK-clear writes to two per route per minute', async () => {
    let now = 1_000_000;
    let writes = 0;
    const limiter = createDriverSyncHeartbeatRateLimiter({ now: () => now });
    const raw = { recordHeartbeat: async () => {
      writes += 1;
      return { accepted: true, conflict: false, heartbeatSequence: writes, state: 'HEALTHY' as const };
    } };
    const periodic = createRateLimitedDriverSyncHeartbeatService({ limiter, routePlanId: 'route-a', service: raw });
    const pending = createRateLimitedDriverSyncHeartbeatService({ limiter, routePlanId: 'route-a', service: raw });
    const acknowledged = createRateLimitedDriverSyncHeartbeatService({ limiter, routePlanId: 'route-a', service: raw });
    await periodic.recordHeartbeat(request);
    await pending.recordHeartbeat(request);
    await assert.rejects(
      async () => acknowledged.recordHeartbeat(request),
      DriverSyncHeartbeatRateLimitError,
    );
    assert.equal(writes, 2);
    const otherRoute = createRateLimitedDriverSyncHeartbeatService({ limiter, routePlanId: 'route-b', service: raw });
    await otherRoute.recordHeartbeat(request);
    assert.equal(writes, 3);
    now += 60_001;
    await acknowledged.recordHeartbeat(request);
    assert.equal(writes, 4);
  });

  it('refreshes a 401 route token once and closes the outbox only after the refreshed observation', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'completed-refresh', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    queue.acknowledge(item.queueItemId);
    let refreshCalls = 0;
    const outcome = await deliverDriverCompletionClearHeartbeat({
      attempt: {
        appVersion: '1.2.0', completedStopCount: null, driverContractVersion: 2,
        heartbeatService: { recordHeartbeat: async () => { throw new DriverSyncHeartbeatHttpError(401); } },
        identityService: { next: async () => ({
          deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 1, sessionGeneration: 'generation',
        }) },
        queue, routePlanId, sessionKey: 'account:route:generation', versionCode: 18,
      },
      refreshHeartbeatService: async () => {
        refreshCalls += 1;
        return { recordHeartbeat: async () => ({
          accepted: true, conflict: false, heartbeatSequence: 2, state: 'HEALTHY',
        }) };
      },
    });
    assert.equal(refreshCalls, 1);
    assert.equal(outcome.observed, true);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), []);
  });

  it('bounds a hung 401 token refresh and leaves the outbox open', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'completed-refresh-hang', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    queue.acknowledge(item.queueItemId);
    let expireLatest: (() => void) | undefined;
    const delivery = deliverDriverCompletionClearHeartbeat({
      attempt: {
        appVersion: '1.2.0', attemptTimeoutMs: 10, cancelAttemptTimeout: () => undefined,
        completedStopCount: null, driverContractVersion: 2,
        heartbeatService: { recordHeartbeat: async () => { throw new DriverSyncHeartbeatHttpError(401); } },
        identityService: { next: async () => ({
          deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 1, sessionGeneration: 'generation',
        }) },
        queue, routePlanId,
        scheduleAttemptTimeout: (expire) => { expireLatest = expire; return expire; },
        sessionKey: 'account:route:generation', versionCode: 18,
      },
      refreshHeartbeatService: () => new Promise(() => undefined),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expireLatest?.();
    assert.equal((await delivery).observed, false);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
  });

  it('does not let an accepted account-A response close account-B state after the epoch changes', async () => {
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const queue = createInMemoryOfflineSubmissionQueue();
    const item = queue.enqueueDriverEvent({
      clientEventId: 'late-account-a', eventType: 'ROUTE_COMPLETED', occurredAt: new Date(), routePlanId,
    });
    queue.acknowledge(item.queueItemId);
    let currentEpoch = 7;
    let resolveServer!: (result: {
      accepted: boolean; conflict: boolean; heartbeatSequence: number; state: 'HEALTHY';
    }) => void;
    const attempt = attemptDriverCompletionClearHeartbeat({
      appVersion: '1.2.0', completedStopCount: null, driverContractVersion: 2,
      heartbeatService: { recordHeartbeat: () => new Promise((resolve) => { resolveServer = resolve; }) },
      identityService: { next: async () => ({
        deviceInstanceHash: 'a'.repeat(64), heartbeatSequence: 1, sessionGeneration: 'generation-a',
      }) },
      isAttemptCurrent: () => currentEpoch === 7,
      queue, routePlanId, sessionKey: 'account-a:route:generation', versionCode: 18,
    });
    await new Promise((resolve) => setImmediate(resolve));
    currentEpoch = 8;
    resolveServer({ accepted: true, conflict: false, heartbeatSequence: 1, state: 'HEALTHY' });
    assert.equal((await attempt).observed, false);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
  });

  it('requires an explicit account-token takeover request for a conflicting device lease', async () => {
    let authorization = '';
    let body: unknown;
    const client = createDriverSyncTakeoverApiClient({
      accountAccessToken: 'account-token',
      baseUrl: 'https://route.test/',
      fetchImpl: async (_url, init) => {
        authorization = init?.headers?.Authorization ?? '';
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { takenOver: true }, error: null }), { status: 200 });
      },
    });
    assert.equal(await client.takeover({
      deviceInstanceHash: 'c'.repeat(64),
      routePlanId: '11111111-1111-4111-8111-111111111111',
      sessionGeneration: '2026-08-22T12:00:00.000Z',
    }), true);
    assert.equal(authorization, 'Bearer account-token');
    assert.deepEqual(body, {
      deviceInstanceHash: 'c'.repeat(64),
      routePlanId: '11111111-1111-4111-8111-111111111111',
      sessionGeneration: '2026-08-22T12:00:00.000Z',
    });
  });
});
