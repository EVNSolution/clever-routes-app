import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getInviteCodeFallbackMessage,
  getVerifiedDriverNoAssignedRouteMessage,
  shouldOpenRoutesForVerifiedNoRoute,
  shouldRequestInviteCodeForRouteNotFound,
} from './verifiedDriverNoAssignedRoutes';

describe('driver phone login with no assigned routes', () => {
  it('treats NOT_FOUND route lookup as an empty signed-in route state only after invite verification', () => {
    const lookupResult = {
      kind: 'denied' as const,
      message: 'No active route is assigned to this phone number.',
      status: 'NOT_FOUND' as const,
    };

    assert.equal(shouldOpenRoutesForVerifiedNoRoute({ allowVerifiedDriverNoRoute: true, lookupResult }), true);
    assert.equal(shouldOpenRoutesForVerifiedNoRoute({ allowVerifiedDriverNoRoute: false, lookupResult }), false);
  });

  it('falls back from stale returning-driver phone lookup to invite-code entry', () => {
    const lookupResult = {
      kind: 'denied' as const,
      message: 'No active route is assigned to this phone number.',
      status: 'NOT_FOUND' as const,
    };

    assert.equal(shouldRequestInviteCodeForRouteNotFound({ allowInviteCodeFallback: true, lookupResult }), true);
    assert.equal(shouldRequestInviteCodeForRouteNotFound({ allowInviteCodeFallback: false, lookupResult }), false);
  });

  it('does not convert disabled or blocked drivers into an empty route or invite fallback state', () => {
    for (const status of ['DISABLED', 'BLOCKED'] as const) {
      const lookupResult = {
        kind: 'denied' as const,
        message: 'Driver cannot continue.',
        status,
      };
      assert.equal(shouldOpenRoutesForVerifiedNoRoute({ allowVerifiedDriverNoRoute: true, lookupResult }), false);
      assert.equal(shouldRequestInviteCodeForRouteNotFound({ allowInviteCodeFallback: true, lookupResult }), false);
    }
  });

  it('uses route-empty copy instead of auth failure copy', () => {
    assert.match(getVerifiedDriverNoAssignedRouteMessage('no_route_choices'), /Phone number verified/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('route_lookup_not_found'), /Refresh routes/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('assigned_route_load_empty'), /dispatch publishes/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('past_routes_hidden'), /Past routes are hidden/);
  });

  it('uses invite-code copy for phone-only stale sessions', () => {
    assert.match(getInviteCodeFallbackMessage(), /Enter the 6-character invite code/);
    assert.doesNotMatch(getInviteCodeFallbackMessage(), /failed|error/i);
  });
});
