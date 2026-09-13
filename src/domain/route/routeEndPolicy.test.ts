import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyRouteCompletionLocation,
  requiresDepotReturn,
  resolveTrustedRouteEventLocation,
} from './routeEndPolicy';

const actionAt = new Date('2026-09-13T01:00:00.000Z');
const depot = { latitude: 43.6532, longitude: -79.3832 };

describe('route end policy', () => {
  it('requires return only when requested while preserving the legacy missing-field behavior', () => {
    assert.equal(requiresDepotReturn('RETURN_TO_DEPOT'), true);
    assert.equal(requiresDepotReturn('END_AT_LAST_STOP'), false);
    assert.equal(requiresDepotReturn(undefined), true);
  });

  it('accepts only fresh accurate evidence and route-matched fallback locations', () => {
    const currentLocation = {
      accuracyMeters: 15,
      latitude: 43.6532,
      longitude: -79.3832,
      recordedAt: new Date(actionAt.getTime() - 10_000),
    };
    assert.deepEqual(resolveTrustedRouteEventLocation({ actionAt, currentLocation, routePlanId: 'route-1' }), currentLocation);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, accuracyMeters: 101 },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, accuracyMeters: -1 },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, latitude: 0, longitude: 0 },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, recordedAt: new Date(actionAt.getTime() - 300_001) },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      cachedLocation: {
        ...currentLocation,
        recordedAt: new Date(actionAt.getTime() - 30_001),
        routePlanId: 'route-1',
      },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      cachedLocation: {
        ...currentLocation,
        recordedAt: new Date(actionAt.getTime() + 1),
        routePlanId: 'route-1',
      },
      routePlanId: 'route-1',
    }), null);
    assert.deepEqual(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, recordedAt: new Date(actionAt.getTime() + 5_000) },
      routePlanId: 'route-1',
    }), { ...currentLocation, recordedAt: new Date(actionAt.getTime() + 5_000) });
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, recordedAt: new Date(actionAt.getTime() + 5_001) },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      currentLocation: { ...currentLocation, recordedAt: new Date(actionAt.getTime() + 86_400_000) },
      routePlanId: 'route-1',
    }), null);
    assert.equal(resolveTrustedRouteEventLocation({
      actionAt,
      cachedLocation: { ...currentLocation, routePlanId: 'route-2' },
      routePlanId: 'route-1',
    }), null);
    assert.deepEqual(resolveTrustedRouteEventLocation({
      actionAt,
      cachedLocation: { ...currentLocation, routePlanId: 'route-1' },
      routePlanId: 'route-1',
    }), currentLocation);
    assert.deepEqual(resolveTrustedRouteEventLocation({
      actionAt,
      cachedLocation: { ...currentLocation, routePlanId: 'route-1' },
      currentLocation: { ...currentLocation, accuracyMeters: 101 },
      routePlanId: 'route-1',
    }), currentLocation);
  });

  it('classifies depot arrival using the server 150 metre threshold', () => {
    const location = { accuracyMeters: 10, ...depot, recordedAt: actionAt };
    assert.equal(classifyRouteCompletionLocation({ depot, location, routeEndMode: 'RETURN_TO_DEPOT' }), 'confirmed');
    assert.equal(classifyRouteCompletionLocation({
      depot,
      location: { ...location, latitude: 43.656 },
      routeEndMode: 'RETURN_TO_DEPOT',
    }), 'outside');
    assert.equal(classifyRouteCompletionLocation({ depot: null, location, routeEndMode: 'RETURN_TO_DEPOT' }), 'unverified');
    assert.equal(classifyRouteCompletionLocation({ depot: null, location: null, routeEndMode: 'END_AT_LAST_STOP' }), 'not_required');
  });
});
