import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  getInitialAccessValidation,
  getPlaceholderScreens,
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

  it('rejects phone-only access before server lookup', () => {
    assert.deepEqual(
      getInitialAccessValidation({ routeContext: '', phoneE164: '+14165550123' }),
      {
        ok: false,
        reason: 'route_context_required',
      },
    );
  });

  it('accepts route context plus E.164 phone as the access starting point', () => {
    assert.deepEqual(
      getInitialAccessValidation({ routeContext: 'route-tomato-2026-05-12', phoneE164: '+14165550123' }),
      {
        ok: true,
      },
    );
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

  it('defines placeholders for the first implementation navigation skeleton', () => {
    assert.deepEqual(
      getPlaceholderScreens().map((screen) => screen.id),
      ['routeAccess', 'companyGuidance', 'consentGate', 'assignedRoute', 'deliveryActive'],
    );
  });
});
