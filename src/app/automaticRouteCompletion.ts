import type { AssignedRoute } from '../domain/route/assignedRoute';
import { isStopCompleted } from '../domain/route/routeStepProgress';
import { DEPOT_ARRIVAL_CONSECUTIVE_FIXES, nextDepotArrivalState, type DepotArrivalState, type RouteEventLocationCandidate } from '../domain/route/routeEndPolicy';

export function getAutomaticRouteCompletionSession<T extends { route: AssignedRoute }>(input: {
  activeRoutePlanId: string | null;
  completedStopIds: string[];
  routeSessions: T[];
  routeStatus: string;
}): T | null {
  if (input.routeStatus !== 'active' || input.activeRoutePlanId === null) return null;
  const session = input.routeSessions.find(candidate => candidate.route.id === input.activeRoutePlanId);
  return session !== undefined && session.route.stops.every(stop => isStopCompleted(stop, input.completedStopIds))
    ? session : null;
}

export function createAutomaticRouteCompletion() {
  let routeKey: string | null = null;
  let arrival: DepotArrivalState = { lastFixAt: null, streak: 0 };
  let request: object | null = null;
  return {
    setRoute(nextRouteKey: string | null) {
      if (routeKey === nextRouteKey) return;
      routeKey = nextRouteKey;
      arrival = { lastFixAt: null, streak: 0 };
      request = null;
    },
    async observe(input: {
      complete: (isCurrent: () => boolean) => Promise<boolean>;
      locations: readonly RouteEventLocationCandidate[];
      now: Date;
      route: AssignedRoute;
      routeKey: string;
    }): Promise<void> {
      if (routeKey !== input.routeKey || request !== null) return;
      arrival = nextDepotArrivalState({
        depot: input.route.depot,
        locations: input.locations,
        now: input.now,
        previousState: arrival,
        routeEndMode: input.route.routeEndMode,
      });
      if (arrival.streak < DEPOT_ARRIVAL_CONSECUTIVE_FIXES) return;
      const currentRequest = {};
      request = currentRequest;
      const isCurrent = () => routeKey === input.routeKey && request === currentRequest;
      let completed = false;
      try {
        completed = await input.complete(isCurrent);
      } catch {
        // A failed automatic attempt can retry with two new fixes; manual Finish remains available.
      } finally {
        if (isCurrent() && !completed) {
          request = null;
          arrival = { ...arrival, streak: 0 };
        }
      }
    },
  };
}
