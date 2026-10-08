import type { RouteAccessRouteChoice } from '../domain/routeAccess/routeAccess';

export type RouteAssignmentIdentity = Pick<RouteAccessRouteChoice['routeAccess'],
  'assignmentGeneration' | 'driverContractVersion' | 'routePlanId'>;

export function isRouteAccessRefreshForAssignment(
  refreshed: RouteAssignmentIdentity,
  original: RouteAssignmentIdentity,
): boolean {
  return refreshed.routePlanId === original.routePlanId
    && refreshed.assignmentGeneration === original.assignmentGeneration
    && refreshed.driverContractVersion === original.driverContractVersion;
}
