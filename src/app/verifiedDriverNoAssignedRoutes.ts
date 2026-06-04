import type { RouteAccessSubmissionResult } from '../domain/routeAccess/routeAccess';

export type VerifiedDriverNoAssignedRouteReason =
  | 'no_route_choices'
  | 'route_lookup_not_found'
  | 'assigned_route_load_empty'
  | 'past_routes_hidden';

export function shouldOpenRoutesForVerifiedNoRoute(input: {
  allowVerifiedDriverNoRoute: boolean;
  lookupResult: RouteAccessSubmissionResult;
}): boolean {
  return input.allowVerifiedDriverNoRoute && input.lookupResult.kind === 'denied' && input.lookupResult.status === 'NOT_FOUND';
}

export function shouldRequestInviteCodeForRouteNotFound(input: {
  allowInviteCodeFallback: boolean;
  lookupResult: RouteAccessSubmissionResult;
}): boolean {
  return input.allowInviteCodeFallback && input.lookupResult.kind === 'denied' && input.lookupResult.status === 'NOT_FOUND';
}

export function getVerifiedDriverNoAssignedRouteMessage(reason: VerifiedDriverNoAssignedRouteReason): string {
  switch (reason) {
    case 'no_route_choices':
    case 'route_lookup_not_found':
      return 'Phone number verified. No current or upcoming route is assigned right now. Pull down or tap Refresh routes after dispatch assigns a route.';
    case 'assigned_route_load_empty':
      return 'Phone number verified. Assigned routes are not ready yet. Pull down or tap Refresh routes after dispatch publishes the route.';
    case 'past_routes_hidden':
      return 'Phone number verified. Past routes are hidden and no current or upcoming route is assigned right now. Pull down or tap Refresh routes after dispatch assigns a route.';
  }
}

export function getInviteCodeFallbackMessage(): string {
  return 'No current route was found for this phone yet. Enter the 6-character invite code to link the driver app; routes can be assigned later.';
}
