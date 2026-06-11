import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../route/assignedRoute';
import {
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
});
