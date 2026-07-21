import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from './assignedRoute';
import {
  getAssignedRouteServerProgress,
  getStopDetailsProgressState,
  ROUTE_COMPANY_STEP_INDEX,
} from './routeStepProgress';

describe('route step progress state', () => {
  it('restores delivered stops and the next navigation step from server route state', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        ...stop,
        status: index === 0 ? 'DELIVERED' : 'ASSIGNED',
      })),
    };

    assert.deepEqual(getAssignedRouteServerProgress(route), {
      completedStopIds: [route.stops[0].deliveryStopId],
      navigationStepIndex: 2,
    });
  });

  it('restores Store Pickup when an in-progress route has no terminal stop yet', () => {
    assert.deepEqual(getAssignedRouteServerProgress(sampleAssignedRoute), {
      completedStopIds: [],
      navigationStepIndex: ROUTE_COMPANY_STEP_INDEX,
    });
  });

  it('restores the arrived stop instead of returning an in-progress route to Store Pickup', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        ...stop,
        status: index === 1 ? 'ARRIVED' : 'ASSIGNED',
      })),
    };

    assert.deepEqual(getAssignedRouteServerProgress(route), {
      completedStopIds: [],
      navigationStepIndex: 2,
    });
  });

  it('treats route-detail stop taps as read-only previews before the route session starts', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.ok(firstStop);

    const state = getStopDetailsProgressState({
      navigationStepIndex: ROUTE_COMPANY_STEP_INDEX,
      route: sampleAssignedRoute,
      selectedStopDetailsId: firstStop.deliveryStopId,
    });

    assert.equal(state?.kind, 'preview_stop');
    assert.equal(state?.stop.deliveryStopId, firstStop.deliveryStopId);
    assert.equal(state?.canMarkArrived, false);
  });

  it('allows arrived handling only for the currently active stop', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    const secondStop = sampleAssignedRoute.stops[1];
    assert.ok(firstStop);
    assert.ok(secondStop);

    assert.deepEqual(
      getStopDetailsProgressState({
        navigationStepIndex: 1,
        route: sampleAssignedRoute,
        selectedStopDetailsId: firstStop.deliveryStopId,
      }),
      {
        canMarkArrived: true,
        kind: 'current_stop',
        stop: firstStop,
      },
    );

    const previewState = getStopDetailsProgressState({
      navigationStepIndex: 1,
      route: sampleAssignedRoute,
      selectedStopDetailsId: secondStop.deliveryStopId,
    });

    assert.equal(previewState?.kind, 'preview_stop');
    assert.equal(previewState?.canMarkArrived, false);
    assert.equal(previewState?.stop.deliveryStopId, secondStop.deliveryStopId);
  });
});
