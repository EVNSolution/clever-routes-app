import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverSyncHeartbeatApiClient,
  createDriverSyncHeartbeatScheduler,
  createDriverSyncTakeoverApiClient,
} from './driverSyncHeartbeat';

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
      random: () => 0.5,
      schedule: (run, delayMs) => { delays.push(delayMs); scheduled.push(run); return run; },
      sendHeartbeat: async () => { calls += 1; return calls > 1; },
    });

    scheduler.start();
    assert.deepEqual(delays, [15_000]);
    scheduled.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delays, [15_000, 30_000]);
    scheduled.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delays, [15_000, 30_000, 15_000]);
    assert.equal(calls, 2);
    scheduler.stop();
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
