export type VerifiedDriverNoAssignedRouteReason =
  | 'no_route_choices'
  | 'route_lookup_not_found'
  | 'assigned_route_load_empty'
  | 'past_routes_hidden';

export function getVerifiedDriverNoAssignedRouteMessage(reason: VerifiedDriverNoAssignedRouteReason): string {
  switch (reason) {
    case 'no_route_choices':
    case 'route_lookup_not_found':
      return 'Signed in. No current or upcoming route is assigned right now. Pull down or tap Refresh routes after dispatch assigns a route.';
    case 'assigned_route_load_empty':
      return 'Signed in. Assigned routes are not ready yet. Pull down or tap Refresh routes after dispatch publishes the route.';
    case 'past_routes_hidden':
      return 'Signed in. Past routes are hidden and no current or upcoming route is assigned right now. Pull down or tap Refresh routes after dispatch assigns a route.';
  }
}
