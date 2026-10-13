import type { AssignedRouteCoordinates, AssignedRouteEndMode } from './assignedRoute';
import { classifyGpsOperationalState } from '../location/gpsOperationalState';
import { getLocationDistanceMeters } from '../notifications/stopArrivalNotifications';

const MAX_ROUTE_EVENT_LOCATION_AGE_MS = 30_000;
const MAX_FOREGROUND_LOCATION_DELAY_MS = 5_000;

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
  for (const [location, maxFutureMs] of [
    [input.currentLocation, MAX_FOREGROUND_LOCATION_DELAY_MS],
    [cachedLocation, 0],
  ] as const) {
    if (location === null || location === undefined || !isValidLocation(location)) continue;
    const ageMs = input.actionAt.getTime() - location.recordedAt.getTime();
    const gpsState = classifyGpsOperationalState({
      accuracyMeters: location.accuracyMeters,
      capturedAt: location.recordedAt.toISOString(),
      distanceMeters: null,
      now: input.actionAt,
    });
    if (
      ageMs >= -maxFutureMs
      && ageMs <= MAX_ROUTE_EVENT_LOCATION_AGE_MS
      && gpsState.accuracy === 'accurate'
    ) {
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

export const DEPOT_ARRIVAL_CONSECUTIVE_FIXES = 2;

/** Consecutive accurate fixes at the return location; any miss starts over. */
export function nextDepotArrivalStreak(input: {
  depot: AssignedRouteCoordinates | null;
  location: RouteEventLocationCandidate | null;
  now: Date;
  previousStreak: number;
  routeEndMode: AssignedRouteEndMode | undefined;
}): number {
  const trusted = resolveTrustedRouteEventLocation({
    actionAt: input.now,
    currentLocation: input.location,
    routePlanId: '',
  });
  const arrived = classifyRouteCompletionLocation({
    depot: input.depot,
    location: trusted,
    routeEndMode: input.routeEndMode,
  }) === 'confirmed';
  return arrived ? input.previousStreak + 1 : 0;
}

export type DepotArrivalState = {
  lastFixAt: number | null;
  streak: number;
};

/** Evaluate every distinct fix in time order, including misses between arrivals. */
export function nextDepotArrivalState(input: {
  depot: AssignedRouteCoordinates | null;
  locations: readonly RouteEventLocationCandidate[];
  now: Date;
  previousState?: DepotArrivalState;
  routeEndMode: AssignedRouteEndMode | undefined;
}): DepotArrivalState {
  let { lastFixAt, streak } = input.previousState ?? { lastFixAt: null, streak: 0 };
  if (lastFixAt !== null && input.now.getTime() - lastFixAt > MAX_ROUTE_EVENT_LOCATION_AGE_MS) streak = 0;
  for (const location of [...input.locations].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    const fixAt = location.recordedAt.getTime();
    if (!Number.isFinite(fixAt) || fixAt > input.now.getTime() + MAX_FOREGROUND_LOCATION_DELAY_MS) {
      streak = 0;
      continue;
    }
    if (lastFixAt !== null && fixAt <= lastFixAt) continue;
    streak = nextDepotArrivalStreak({ ...input, location, previousStreak: streak });
    lastFixAt = fixAt;
  }
  return { lastFixAt, streak };
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
