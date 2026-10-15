import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRouteFinishGuard } from './routeFinishGuard';
import { createDriverAccessTokenStore } from '../domain/driver/driverAccessTokenStore';
import { finishDeliveryAfterActive } from '../domain/delivery/deliveryFinish';
import { createInMemoryOfflineSubmissionQueue } from '../domain/offline/offlineSubmissionQueue';
import { sampleInvitedRouteAccess } from '../domain/routeAccess/routeAccess';

async function finishConcurrently(tryAcquire: () => (() => void) | null) {
  const now = new Date('2026-05-12T06:45:00.000Z');
  const values = new Map<string, string>();
  const store = createDriverAccessTokenStore({ now: () => now, storage: {
    deleteItemAsync: async key => { values.delete(key); },
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
  } });
  await store.saveAuthenticatedDriver({ accountAccess: {
    accessToken: 'account-access', expiresAt: '2026-05-12T07:00:00.000Z',
    refreshToken: 'account-refresh', refreshTokenExpiresAt: '2026-06-12T07:00:00.000Z',
    tokenType: 'Bearer', ttlSeconds: 900, use: 'driver_account',
  }, phoneE164: '+14165550123' });
  const routePlanId = sampleInvitedRouteAccess.routeAccess.routePlanId;
  assert.equal(await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess), true);
  assert.equal(await store.saveActiveRouteSession({ routePlanId, navigationStepIndex: 1 }), true);
  const queue = createInMemoryOfflineSubmissionQueue();
  const sentEventIds: string[] = [];
  let stopCount = 0;
  let unblockNetwork: () => void = () => undefined;
  const network = new Promise<void>(resolve => { unblockNetwork = resolve; });
  let notifyFirstRequest: () => void = () => undefined;
  const firstRequest = new Promise<void>(resolve => { notifyFirstRequest = resolve; });
  const finish = async (offsetMs: number) => {
    const release = tryAcquire();
    if (release === null) return false;
    try {
      return await finishDeliveryAfterActive({
        deactivateActiveRouteSession: completion => store.markActiveRouteCompletionPending({ ...completion, routePlanId }),
        deliveryStart: { kind: 'delivery_active', flowState: 'delivery_active', locationPermission: 'foreground', message: 'active' },
        driverEventService: { recordDriverEvent: async event => {
          sentEventIds.push(event.clientEventId);
          notifyFirstRequest();
          await network;
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        } },
        now: new Date(now.getTime() + offsetMs), offlineQueue: queue, routePlanId,
        streamService: {
          getBackgroundAvailability: async () => true, hasStartedLocationUpdates: async () => true,
          getBackgroundPermission: async () => 'granted', requestBackgroundPermission: async () => 'granted',
          startLocationUpdates: async () => undefined, stopLocationUpdates: async () => { stopCount += 1; },
        },
      });
    } finally { release(); }
  };
  // Both callers have already completed their independent location snapshots.
  const manual = finish(0);
  const automatic = finish(1);
  await firstRequest;
  await new Promise<void>(resolve => setImmediate(resolve));
  unblockNetwork();
  const results = await Promise.all([manual, automatic]);
  return { results, sentEventIds, stopCount, pendingCount: queue.listPending().length };
}

describe('shared route finish guard', () => {
  it('records one completion and stops tracking once when manual and automatic finish race', async () => {
    const guard = createRouteFinishGuard();
    const result = await finishConcurrently(guard.tryAcquire);
    assert.equal(result.sentEventIds.length, 1);
    assert.equal(result.stopCount, 1);
    assert.equal(result.pendingCount, 0);
    assert.equal(result.results.filter(item => item === false).length, 1);
    // A later route can finish after this operation leaves its finally block.
    assert.notEqual(guard.tryAcquire(), null);
  });

  it('acquires the shared guard before persistence and releases it on every finish exit', () => {
    const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
    const finish = source.slice(source.indexOf('  async function finishRoute('), source.indexOf('  async function handleManualFinishRoute('));
    assert.match(finish, /const releaseRouteFinish = routeFinishGuardRef\.current\.tryAcquire\(\);\s*if \(releaseRouteFinish === null\) return false;/u);
    assert.ok(finish.indexOf('tryAcquire()') < finish.indexOf('await getExpoOfflineSubmissionQueue()'));
    assert.match(finish, /finally \{\s*releaseRouteFinish\(\);/u);
  });
});
