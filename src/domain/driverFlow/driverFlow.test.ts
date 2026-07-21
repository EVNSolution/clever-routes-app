import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  getMvpRouteTabs,
  getMvpScenarioScreens,
  getStopCompletionProofFields,
} from './driverFlow';

describe('driver app MVP flow', () => {
  it('keeps route context and company guidance before route access', () => {
    assert.deepEqual(DRIVER_FLOW_STATES, [
      'unidentified',
      'route_context_entered',
      'company_context_confirmed',
      'invited',
      'consent_required',
      'consent_recorded',
      'route_ready',
      'delivery_active',
      'delivery_finished',
    ]);
  });

  it('does not reveal route details before consent is recorded', () => {
    assert.equal(canRevealRouteDetails('company_context_confirmed'), false);
    assert.equal(canRevealRouteDetails('consent_required'), false);
    assert.equal(canRevealRouteDetails('consent_recorded'), true);
  });

  it('allows delivery active only after route is ready and OS location permission is granted', () => {
    assert.equal(canEnterDeliveryActive({ state: 'route_ready', hasLocationPermission: false }), false);
    assert.equal(canEnterDeliveryActive({ state: 'consent_recorded', hasLocationPermission: true }), false);
    assert.equal(canEnterDeliveryActive({ state: 'route_ready', hasLocationPermission: true }), true);
  });

  it('defines the user-facing MVP screens instead of a debug guard page', () => {
    assert.deepEqual(
      getMvpScenarioScreens().map((screen) => screen.id),
      [
        'login',
        'routeList',
        'routeDetail',
        'routeSession',
        'liveTracking',
        'stopDetails',
        'arrivalCheck',
        'completedDeliveries',
      ],
    );

    assert.deepEqual(
      getMvpScenarioScreens().map((screen) => screen.title),
      [
        'Login / Driver Verification',
        'My Routes',
        'Route Details',
        'Route Session',
        'Live Tracking',
        'Stop Details',
        'Arrival Check',
        'Completed Deliveries',
      ],
    );
  });

  it('shows route lists by lifecycle status tabs', () => {
    assert.deepEqual(getMvpRouteTabs(), [
      { id: 'ready', label: 'Ready' },
      { id: 'active', label: 'In progress' },
      { id: 'completed', label: 'Completed' },
    ]);
  });

  it('keeps all stop completion proof inputs optional', () => {
    assert.deepEqual(getStopCompletionProofFields(), [
      { id: 'photo', label: 'Photo Proof', required: false },
      { id: 'todayNote', label: 'Delivery Result', required: false },
      { id: 'locationTip', label: 'Location Tip', required: false },
      { id: 'additionalNotes', label: 'Other Notes', required: false },
    ]);
  });
});
