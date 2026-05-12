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
import type { PersistedDriverAccess } from './driverAccessTokenStore';
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
  return createDriverApiClientsFromAccessToken({
    accessToken: input.routeAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
}

export function createDriverApiClientsFromPersistedDriverAccess(input: {
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  persistedAccess: PersistedDriverAccess;
}): DriverApiClients {
  return createDriverApiClientsFromAccessToken({
    accessToken: input.persistedAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
}

function createDriverApiClientsFromAccessToken(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
}): DriverApiClients {
  return {
    assignedRouteService: createAssignedRouteApiClient({
      accessToken: input.accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
    driverConsentService: createDriverConsentApiClient({
      accessToken: input.accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
  };
}
