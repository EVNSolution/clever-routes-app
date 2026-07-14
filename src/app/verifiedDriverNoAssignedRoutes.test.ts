import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getVerifiedDriverNoAssignedRouteMessage,
} from './verifiedDriverNoAssignedRoutes';

describe('signed-in driver with no assigned routes', () => {
  it('uses route-empty copy instead of auth failure copy', () => {
    assert.match(getVerifiedDriverNoAssignedRouteMessage('no_route_choices'), /Signed in/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('route_lookup_not_found'), /Refresh routes/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('assigned_route_load_empty'), /dispatch publishes/);
    assert.match(getVerifiedDriverNoAssignedRouteMessage('past_routes_hidden'), /Past routes are hidden/);
  });
});
