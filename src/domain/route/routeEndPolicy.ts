import type { AssignedRouteCoordinates, AssignedRouteEndMode } from './assignedRoute';
import { classifyGpsOperationalState } from '../location/gpsOperationalState';
import { getLocationDistanceMeters } from '../notifications/stopArrivalNotifications';

export type RouteEventLocationCandidate = {
  accuracyMeters: number | null;
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

export type RouteEventLocationEvidence = RouteEventLocationCandidate & {
  accuracyMeters: number;
};

export type CachedRouteEventLocationEvidence = RouteEventLocationCandidate & {
  routePlanId: string;
};

export function requiresDepotReturn(routeEndMode: AssignedRouteEndMode | undefined): boolean {
  return routeEndMode !== 'END_AT_LAST_STOP';
}

export function resolveTrustedRouteEventLocation(input: {
  actionAt: Date;
  cachedLocation?: CachedRouteEventLocationEvidence | null;
  currentLocation?: RouteEventLocationCandidate | null;
  routePlanId: string;
}): RouteEventLocationEvidence | null {
  const cachedLocation = input.cachedLocation?.routePlanId === input.routePlanId
    ? input.cachedLocation
    : null;
  for (const location of [input.currentLocation, cachedLocation]) {
    if (location === null || location === undefined || !isValidLocation(location)) continue;
    const validationNow = location.recordedAt > input.actionAt ? location.recordedAt : input.actionAt;
    if (classifyGpsOperationalState({
      accuracyMeters: location.accuracyMeters,
      capturedAt: location.recordedAt.toISOString(),
      distanceMeters: null,
      now: validationNow,
    }).safeForProximity) {
      return {
        accuracyMeters: location.accuracyMeters,
        latitude: location.latitude,
        longitude: location.longitude,
        recordedAt: location.recordedAt,
      };
    }
  }
  return null;
}

export function classifyRouteCompletionLocation(input: {
  depot: AssignedRouteCoordinates | null;
  location: RouteEventLocationEvidence | null;
  routeEndMode: AssignedRouteEndMode | undefined;
}): 'confirmed' | 'not_required' | 'outside' | 'unverified' {
  if (!requiresDepotReturn(input.routeEndMode)) return 'not_required';
  if (input.depot === null || input.location === null) return 'unverified';
  return getLocationDistanceMeters(input.location, input.depot) <= 150 ? 'confirmed' : 'outside';
}

function isValidLocation(location: RouteEventLocationCandidate): location is RouteEventLocationEvidence {
  return location.accuracyMeters !== null
    && Number.isFinite(location.accuracyMeters)
    && location.accuracyMeters >= 0
    && Number.isFinite(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180
    && !(location.latitude === 0 && location.longitude === 0)
    && Number.isFinite(location.recordedAt.getTime());
}
