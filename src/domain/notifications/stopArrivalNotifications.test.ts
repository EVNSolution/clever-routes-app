import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../route/assignedRoute';
import {
  getDriverRouteNotificationNavigation,
  parseDriverRouteNotificationData,
  formatStopArrivalNotificationContent,
  getStopArrivalNotificationCandidate,
  parseStopArrivalNotificationData,
  STOP_ARRIVAL_NOTIFICATION_TYPE,
} from './stopArrivalNotifications';

describe('stop arrival notifications', () => {
  it('creates a stop-arrival notification candidate when the active stop is within the allowed radius', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.notEqual(firstStop.coordinates, null);

    const candidate = getStopArrivalNotificationCandidate({
      completedStopIds: [],
      currentStepIndex: 1,
      isActiveRoute: true,
      lastLocation: firstStop.coordinates,
      notifiedStopIds: [],
      radiusMeters: 50,
      route: sampleAssignedRoute,
    });

    assert.equal(candidate?.data.type, STOP_ARRIVAL_NOTIFICATION_TYPE);
    assert.equal(candidate?.data.routePlanId, sampleAssignedRoute.id);
    assert.equal(candidate?.data.deliveryStopId, firstStop.deliveryStopId);
    assert.equal(candidate?.stop.deliveryStopId, firstStop.deliveryStopId);
    assert.deepEqual(candidate === null ? null : formatStopArrivalNotificationContent(candidate), {
      body: 'You have arrived near the destination: 100 King St W, Toronto, ON, M5X 1A9.\nTomato box (Size: Large): 2',
      title: 'Arrived near Stop 1',
    });
  });

  it('does not notify for company pickup, completed stops, repeated stops, or distant stops', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    assert.notEqual(firstStop.coordinates, null);

    const base = {
      completedStopIds: [],
      currentStepIndex: 1,
      isActiveRoute: true,
      lastLocation: firstStop.coordinates,
      notifiedStopIds: [],
      radiusMeters: 50,
      route: sampleAssignedRoute,
    };

    assert.equal(getStopArrivalNotificationCandidate({ ...base, currentStepIndex: 0 }), null);
    assert.equal(getStopArrivalNotificationCandidate({ ...base, completedStopIds: [firstStop.deliveryStopId] }), null);
    assert.equal(getStopArrivalNotificationCandidate({ ...base, notifiedStopIds: [firstStop.deliveryStopId] }), null);
    assert.equal(getStopArrivalNotificationCandidate({ ...base, lastLocation: { latitude: 0, longitude: 0 } }), null);
  });

  it('parses only the agreed server FCM stop-arrival payload', () => {
    assert.deepEqual(parseStopArrivalNotificationData({
      deliveryStopId: 'stop-1',
      routePlanId: 'route-1',
      type: 'stop_arrival',
    }), {
      deliveryStopId: 'stop-1',
      routePlanId: 'route-1',
      type: STOP_ARRIVAL_NOTIFICATION_TYPE,
    });

    assert.equal(parseStopArrivalNotificationData({ deliveryStopId: 'stop-1', routePlanId: 'route-1' }), null);
    assert.equal(parseStopArrivalNotificationData({ deliveryStopId: '', routePlanId: 'route-1', type: 'stop_arrival' }), null);
  });

  it('parses route assignment notifications without accepting customer data', () => {
    assert.deepEqual(parseDriverRouteNotificationData({
      action: 'assigned',
      childVersion: '3',
      routeGroupingId: 'group-1',
      routePlanId: 'route-1',
      type: 'driver_route_changed',
    }), {
      action: 'assigned',
      childVersion: 3,
      routeGroupingId: 'group-1',
      routePlanId: 'route-1',
      type: 'driver_route_changed',
    });
    assert.equal(parseDriverRouteNotificationData({
      action: 'assigned',
      childVersion: '3',
      routeGroupingId: 'group-1',
      routePlanId: 'route-1',
      type: 'wrong_type',
    }), null);
  });

  it('opens only the refreshed target route and protects a different active route', () => {
    assert.equal(getDriverRouteNotificationNavigation({
      action: 'assigned',
      activeRoutePlanId: null,
      availableRoutePlanIds: ['route-1'],
      openRequested: true,
      routePlanId: 'route-1',
    }), 'open_route');
    assert.equal(getDriverRouteNotificationNavigation({
      action: 'changed',
      activeRoutePlanId: 'active-route',
      availableRoutePlanIds: ['active-route', 'route-1'],
      openRequested: true,
      routePlanId: 'route-1',
    }), 'active_route_protected');
    assert.equal(getDriverRouteNotificationNavigation({
      action: 'released',
      activeRoutePlanId: null,
      availableRoutePlanIds: [],
      openRequested: true,
      routePlanId: 'route-1',
    }), 'refresh_only');
    assert.equal(getDriverRouteNotificationNavigation({
      action: 'assigned',
      activeRoutePlanId: null,
      availableRoutePlanIds: [],
      openRequested: true,
      routePlanId: 'route-1',
    }), 'target_unavailable');
  });
});
