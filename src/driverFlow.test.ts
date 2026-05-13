import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  getInitialAccessValidation,
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

  it('accepts phone-only access as the lookup starting point', () => {
    assert.deepEqual(
      getInitialAccessValidation({ phoneE164: '+14165550123' }),
      {
        ok: true,
      },
    );
  });

  it('still accepts route context plus E.164 phone as an optional narrowed lookup', () => {
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

  it('defines the user-facing MVP screens instead of a debug guard page', () => {
    assert.deepEqual(
      getMvpScenarioScreens().map((screen) => screen.id),
      ['login', 'routeList', 'routeDetail', 'navigation', 'stopProof'],
    );
  });

  it('shows route lists by delivery status tabs', () => {
    assert.deepEqual(getMvpRouteTabs(), [
      { id: 'upcoming', label: '배송전' },
      { id: 'active', label: '배송중' },
      { id: 'completed', label: '배송완료' },
    ]);
  });

  it('keeps optional stop proof inputs implemented as driver choices', () => {
    assert.deepEqual(getStopCompletionProofFields(), [
      { id: 'photo', label: '배송완료 사진', required: true },
      { id: 'todayNote', label: '금일 배송시 특이사항', required: false },
      { id: 'locationTip', label: '배송지의 특성 팁', required: false },
    ]);
  });
});
