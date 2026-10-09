import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleAssignedRoute } from '../route/assignedRoute';
import { buildDepotNavigationUrl, buildRouteNavigationUrl, buildStopNavigationUrl } from './stopNavigation';

describe('toll-aware navigation handoff', () => {
  it('passes avoid tolls to Google Maps route, stop and depot links', () => {
    assert.match(buildRouteNavigationUrl({ route: { ...sampleAssignedRoute, tollPolicy: 'AVOID_TOLLS' } })!, /avoid=tolls/);
    assert.match(buildStopNavigationUrl({ platform: 'ios', stop: sampleAssignedRoute.stops[0]!, tollPolicy: 'AVOID_TOLLS' })!, /avoid=tolls/);
    assert.match(buildDepotNavigationUrl({ platform: 'ios', depot: sampleAssignedRoute.depot, tollPolicy: 'AVOID_TOLLS' })!, /avoid=tolls/);
  });
  it('carries the policy through the Android provider resolver without changing legacy default links', () => {
    assert.match(buildStopNavigationUrl({ platform: 'android', stop: sampleAssignedRoute.stops[0]!, tollPolicy: 'AVOID_TOLLS' })!, /avoidTolls=true/);
    assert.doesNotMatch(buildStopNavigationUrl({ platform: 'android', stop: sampleAssignedRoute.stops[0]! })!, /avoidTolls/);
  });
});
