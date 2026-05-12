import {
  createAssignedRouteApiClient,
  type AssignedRouteService,
  type FetchLike as AssignedRouteFetchLike,
} from './assignedRoute';
import {
  createDriverConsentApiClient,
  type DriverConsentService,
  type FetchLike as DriverConsentFetchLike,
} from './driverConsent';
import type { RouteAccessLookupResult } from './routeAccess';

export type DriverApiClients = {
  assignedRouteService: AssignedRouteService;
  driverConsentService: DriverConsentService;
};

export type DriverApiClientsFetchLike = AssignedRouteFetchLike & DriverConsentFetchLike;

export function createDriverApiClientsFromRouteAccess(input: {
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>;
}): DriverApiClients {
  const accessToken = input.routeAccess.driverAccess.accessToken;

  return {
    assignedRouteService: createAssignedRouteApiClient({
      accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
    driverConsentService: createDriverConsentApiClient({
      accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
  };
}
