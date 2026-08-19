import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../route/assignedRoute';
import {
  getDriverRouteNotificationNavigation,
  getStopArrivalProximityEvidence,
  parseDriverRouteNotificationData,
  formatStopArrivalNotificationContent,
  getStopArrivalNotificationCandidate,
  STOP_ARRIVAL_NOTIFICATION_TYPE,
} from './stopArrivalNotifications';

describe('stop arrival notifications', () => {
  it('classifies arrival distance against the existing fifty-metre stop radius', () => {
    const firstStop = sampleAssignedRoute.stops[0];
    const firstStopCoordinates = firstStop.coordinates;
    if (firstStopCoordinates === null) {
      assert.fail('sample stop must have coordinates');
    }

    const near = getStopArrivalProximityEvidence({
      location: firstStopCoordinates,
      route: sampleAssignedRoute,
      stop: firstStop,
    });
    const far = getStopArrivalProximityEvidence({
      location: { latitude: 0, longitude: 0 },
      route: sampleAssignedRoute,
      stop: firstStop,
    });

    assert.equal(near?.radiusMeters, 50);
    assert.equal(near?.isWithinRadius, true);
    assert.equal(near?.distanceMeters, 0);
    assert.equal(far?.isWithinRadius, false);
    assert.ok((far?.distanceMeters ?? 0) > 50);
  });

  it('reports unavailable proximity when neither the stop nor route geometry has a destination coordinate', () => {
    const firstStop = { ...sampleAssignedRoute.stops[0], coordinates: null };
    const routeWithoutStopPoint = {
      ...sampleAssignedRoute,
      routeStopPoints: sampleAssignedRoute.routeStopPoints.filter(
        (point) => point.deliveryStopId !== firstStop.deliveryStopId,
      ),
      stops: [firstStop, ...sampleAssignedRoute.stops.slice(1)],
    };

    assert.equal(getStopArrivalProximityEvidence({
      location: { latitude: 37.5133, longitude: 126.9428 },
      route: routeWithoutStopPoint,
      stop: firstStop,
    }), null);
  });

  it('uses the snapped route stop point when the stop itself has no coordinates', () => {
    const firstStop = { ...sampleAssignedRoute.stops[0], coordinates: null };
    const stopPoint = sampleAssignedRoute.routeStopPoints.find(
      (point) => point.deliveryStopId === firstStop.deliveryStopId,
    );
    assert.notEqual(stopPoint?.snappedCoordinates, null);
    assert.notEqual(stopPoint?.snappedCoordinates, undefined);
    const [longitude, latitude] = stopPoint!.snappedCoordinates!;

    const proximity = getStopArrivalProximityEvidence({
      location: { latitude, longitude },
      route: {
        ...sampleAssignedRoute,
        stops: [firstStop, ...sampleAssignedRoute.stops.slice(1)],
      },
      stop: firstStop,
    });

    assert.equal(proximity?.distanceMeters, 0);
    assert.equal(proximity?.isWithinRadius, true);
  });

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
      body: '100 King St W',
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
