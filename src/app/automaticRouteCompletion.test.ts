import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { createAutomaticRouteCompletion, getAutomaticRouteCompletionSession } from './automaticRouteCompletion';

const now = new Date('2026-10-13T00:00:00.000Z');
const depot = { latitude: 43.6532, longitude: -79.3832 };
const route = { ...sampleAssignedRoute, id: 'active', depot, routeEndMode: 'RETURN_TO_DEPOT' as const };
const locations = [-10, 0].map(seconds => ({ ...depot, accuracyMeters: 10, recordedAt: new Date(now.getTime() + seconds * 1000) }));
const base = { route, routeKey: 'active:1', locations, now };

describe('automatic route completion', () => {
  it('selects the active session and its access even when another completed route is visible', () => {
    const active = { route, access: 'active-access' };
    const viewed = { route: { ...route, id: 'viewed', stops: route.stops.map(stop => ({ ...stop, status: 'DELIVERED' })) }, access: 'viewed-access' };
    const input = { activeRoutePlanId: 'active', routeSessions: [viewed, active], routeStatus: 'active' as const };
    assert.equal(getAutomaticRouteCompletionSession({ ...input, completedStopIds: [] }), null);
    assert.equal(getAutomaticRouteCompletionSession({ ...input, completedStopIds: route.stops.map(stop => stop.deliveryStopId) }), active);
    assert.equal(getAutomaticRouteCompletionSession({ ...input, activeRoutePlanId: null, completedStopIds: [] }), null);
  });

  it('retries after rejection or cancellation, and suppresses concurrent requests', async () => {
    const completion = createAutomaticRouteCompletion();
    completion.setRoute(base.routeKey);
    let calls = 0;
    await completion.observe({ ...base, complete: async () => { calls += 1; throw new Error('failed'); } });
    const next = { ...base, now: new Date(now.getTime() + 20_000), locations: locations.map(fix => ({ ...fix, recordedAt: new Date(fix.recordedAt.getTime() + 20_000) })) };
    await completion.observe({ ...next, complete: async () => { calls += 1; return false; } });
    assert.equal(calls, 2);
    let resolve: (value: boolean) => void = () => undefined;
    const later = { ...base, now: new Date(now.getTime() + 40_000), locations: locations.map(fix => ({ ...fix, recordedAt: new Date(fix.recordedAt.getTime() + 40_000) })) };
    const pending = completion.observe({ ...later, complete: () => { calls += 1; return new Promise<boolean>(done => { resolve = done; }); } });
    await completion.observe({ ...later, complete: async () => { calls += 1; return true; } });
    assert.equal(calls, 3);
    resolve(true);
    await pending;
  });

  it('resets streak and invalidates an in-flight completion when the route changes', async () => {
    const completion = createAutomaticRouteCompletion();
    completion.setRoute(base.routeKey);
    let isCurrent = () => true;
    let resolve: (value: boolean) => void = () => undefined;
    const pending = completion.observe({ ...base, complete: current => { isCurrent = current; return new Promise<boolean>(done => { resolve = done; }); } });
    assert.equal(isCurrent(), true);
    completion.setRoute('next:2');
    assert.equal(isCurrent(), false);
    let calls = 0;
    await completion.observe({ ...base, routeKey: 'next:2', locations: [locations[0]], complete: async () => { calls += 1; return true; } });
    assert.equal(calls, 0);
    resolve(false);
    await pending;
    await completion.observe({ ...base, routeKey: 'next:2', locations: [locations[1]], complete: async () => { calls += 1; return true; } });
    assert.equal(calls, 1);
  });
});
