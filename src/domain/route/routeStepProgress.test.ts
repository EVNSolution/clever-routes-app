import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from './assignedRoute';
import {
  buildOutOfOrderStopArrivalWarning,
  getAssignedRouteServerProgress,
  getNextIncompleteRouteStepIndex,
  getStopDetailsProgressState,
  isStopCompleted,
  ROUTE_COMPANY_STEP_INDEX,
} from './routeStepProgress';

describe('route step progress state', () => {
  it('recognizes both server-terminal and locally completed stops', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.ok(firstStop);

    assert.equal(isStopCompleted({ ...firstStop, status: 'DELIVERED' }, []), true);
    assert.equal(isStopCompleted({ ...firstStop, status: 'FAILED' }, []), true);
    assert.equal(isStopCompleted({ ...firstStop, status: 'ASSIGNED' }, [firstStop.deliveryStopId]), true);
    assert.equal(isStopCompleted({ ...firstStop, status: 'ASSIGNED' }, []), false);
  });

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

  it('keeps an out-of-order arrived stop active even when an earlier stop is already completed', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        ...stop,
        status: index === 0 ? 'DELIVERED' : 'ARRIVED',
      })),
    };

    assert.deepEqual(getAssignedRouteServerProgress(route), {
      completedStopIds: [route.stops[0].deliveryStopId],
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

  it('does not replace a missing selected stop with the current stop', () => {
    assert.equal(
      getStopDetailsProgressState({
        navigationStepIndex: 1,
        route: sampleAssignedRoute,
        selectedStopDetailsId: 'removed-stop',
      }),
      null,
    );
  });

  it('warns before arriving at an incomplete stop outside the planned current order', () => {
    const secondStop = sampleAssignedRoute.stops[1];
    assert.ok(secondStop);

    assert.deepEqual(buildOutOfOrderStopArrivalWarning({
      completedStopIds: [],
      navigationStepIndex: 1,
      route: sampleAssignedRoute,
      selectedStopId: secondStop.deliveryStopId,
    }), {
      message: 'Stop 2 is not the current planned stop. Stop 1 remains incomplete. Confirming arrival will update live ETAs and notify the administrator.',
      title: 'Arrive out of order?',
    });
  });

  it('does not warn for the current or completed stop', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    const secondStop = sampleAssignedRoute.stops[1];
    assert.ok(firstStop);
    assert.ok(secondStop);

    assert.equal(buildOutOfOrderStopArrivalWarning({
      completedStopIds: [],
      navigationStepIndex: 1,
      route: sampleAssignedRoute,
      selectedStopId: firstStop.deliveryStopId,
    }), null);
    assert.equal(buildOutOfOrderStopArrivalWarning({
      completedStopIds: [secondStop.deliveryStopId],
      navigationStepIndex: 1,
      route: sampleAssignedRoute,
      selectedStopId: secondStop.deliveryStopId,
    }), null);
  });

  it('does not warn when returning to the earliest incomplete planned stop', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.ok(firstStop);

    assert.equal(buildOutOfOrderStopArrivalWarning({
      completedStopIds: [],
      navigationStepIndex: 2,
      route: sampleAssignedRoute,
      selectedStopId: firstStop.deliveryStopId,
    }), null);
  });

  it('continues forward after an out-of-order completion before wrapping to skipped stops', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    const secondStop = sampleAssignedRoute.stops[1];
    assert.ok(firstStop);
    assert.ok(secondStop);

    assert.equal(getNextIncompleteRouteStepIndex({
      completedStopIds: [secondStop.deliveryStopId],
      currentStopId: secondStop.deliveryStopId,
      route: sampleAssignedRoute,
    }), 1);
    assert.equal(getNextIncompleteRouteStepIndex({
      completedStopIds: [firstStop.deliveryStopId],
      currentStopId: firstStop.deliveryStopId,
      route: sampleAssignedRoute,
    }), 2);
  });
});
