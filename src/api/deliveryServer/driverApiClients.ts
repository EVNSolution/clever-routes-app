import {
  createAssignedRouteApiClient,
  type AssignedRouteService,
  type FetchLike as AssignedRouteFetchLike,
} from '../../domain/route/assignedRoute';
import {
  createDriverConsentApiClient,
  type DriverConsentService,
  type FetchLike as DriverConsentFetchLike,
} from '../../domain/consent/driverConsent';
import {
  createDriverEventsApiClient,
  type DriverEventService,
  type FetchLike as DriverEventFetchLike,
} from '../../domain/events/driverEvents';
import type { PersistedDriverAccess } from '../../domain/driver/driverAccessTokenStore';
import {
  createProofMediaUploadApiClient,
  type FetchLike as ProofMediaUploadFetchLike,
  type ProofMediaUploadService,
} from '../../domain/proof/proofMediaUpload';
import type { RouteAccessLookupResult } from '../../domain/routeAccess/routeAccess';

export type DriverApiClients = {
  assignedRouteService: AssignedRouteService;
  driverConsentService: DriverConsentService;
  driverEventService: DriverEventService;
  proofMediaUploadService: ProofMediaUploadService;
};

export type DriverApiClientsFetchLike = AssignedRouteFetchLike
  & DriverConsentFetchLike
  & DriverEventFetchLike
  & ProofMediaUploadFetchLike;

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
    driverEventService: createDriverEventsApiClient({
      accessToken: input.accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
    proofMediaUploadService: createProofMediaUploadApiClient({
      accessToken: input.accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
  };
}
