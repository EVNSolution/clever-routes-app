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
  type DriverOrderedEventContract,
  type DriverEventService,
  type FetchLike as DriverEventFetchLike,
} from '../../domain/events/driverEvents';
import { getDriverApiRecoveryReason } from './driverApiError';
import type { PersistedDriverAccess } from '../../domain/driver/driverAccessTokenStore';
import {
  createProofMediaUploadApiClient,
  type FetchLike as ProofMediaUploadFetchLike,
  type ProofMediaUploadService,
} from '../../domain/proof/proofMediaUpload';
import type { DriverAccessToken, RouteAccessLookupResult } from '../../domain/routeAccess/routeAccess';

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

export type DriverAccessRefresh = () => Promise<DriverAccessToken | null>;

export function createDriverApiClientsFromRouteAccess(input: {
  appVersion?: string;
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  refreshDriverAccess?: DriverAccessRefresh;
  routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>;
  versionCode?: number;
}): DriverApiClients {
  return createDriverApiClientsFromAccessToken({
    accessToken: input.routeAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    orderedEventContract: {
      appVersion: input.appVersion ?? 'unknown',
      assignmentGeneration: input.routeAccess.routeAccess.assignmentGeneration,
      driverContractVersion: input.routeAccess.routeAccess.driverContractVersion,
      expectedRouteVersionId: input.routeAccess.routeAccess.expectedRouteVersionId,
      versionCode: input.versionCode ?? 1,
    },
    refreshDriverAccess: input.refreshDriverAccess,
  });
}

export function createDriverApiClientsFromPersistedDriverAccess(input: {
  appVersion?: string;
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  persistedAccess: PersistedDriverAccess & { driverAccess: DriverAccessToken };
  refreshDriverAccess?: DriverAccessRefresh;
  versionCode?: number;
}): DriverApiClients {
  return createDriverApiClientsFromAccessToken({
    accessToken: input.persistedAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    ...(!hasDriverOrderedEventLineage(input.persistedAccess.routeAccess) ? {} : {
      orderedEventContract: {
        appVersion: input.appVersion ?? 'unknown',
        assignmentGeneration: input.persistedAccess.routeAccess.assignmentGeneration,
        driverContractVersion: input.persistedAccess.routeAccess.driverContractVersion,
        expectedRouteVersionId: input.persistedAccess.routeAccess.expectedRouteVersionId,
        versionCode: input.versionCode ?? 1,
      },
    }),
    refreshDriverAccess: input.refreshDriverAccess,
  });
}

function hasDriverOrderedEventLineage(value: PersistedDriverAccess['routeAccess']): value is NonNullable<PersistedDriverAccess['routeAccess']> {
  return value !== undefined
    && /^\d+$/u.test(value.assignmentGeneration)
    && value.driverContractVersion === 2
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.expectedRouteVersionId);
}

function createDriverApiClientsFromAccessToken(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  orderedEventContract?: DriverOrderedEventContract;
  refreshDriverAccess?: DriverAccessRefresh;
}): DriverApiClients {
  const buildClients = (accessToken: string) => ({
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
    driverEventService: createDriverEventsApiClient({
      accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
      orderedEventContract: input.orderedEventContract,
    }),
    proofMediaUploadService: createProofMediaUploadApiClient({
      accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    }),
  });

  if (input.refreshDriverAccess === undefined) {
    return buildClients(input.accessToken);
  }

  return withDriverAccessRefresh({
    buildClients,
    initialAccessToken: input.accessToken,
    refreshDriverAccess: input.refreshDriverAccess,
  });
}

function withDriverAccessRefresh(input: {
  buildClients(accessToken: string): DriverApiClients;
  initialAccessToken: string;
  refreshDriverAccess: DriverAccessRefresh;
}): DriverApiClients {
  let clients = input.buildClients(input.initialAccessToken);

  async function runWithRefresh<T>(call: (clients: DriverApiClients) => Promise<T>): Promise<T> {
    try {
      return await call(clients);
    } catch (error) {
      if (getDriverApiRecoveryReason(error) !== 'driver_access_expired') {
        throw error;
      }

      const refreshedAccess = await input.refreshDriverAccess();
      if (refreshedAccess === null) {
        throw error;
      }

      clients = input.buildClients(refreshedAccess.accessToken);
      return call(clients);
    }
  }

  return {
    assignedRouteService: {
      getAssignedRoute: (request) => runWithRefresh((client) => client.assignedRouteService.getAssignedRoute(request)),
    },
    driverConsentService: {
      recordDriverConsents: (request) => runWithRefresh((client) => client.driverConsentService.recordDriverConsents(request)),
    },
    driverEventService: {
      prepareDriverEvent: (request) => clients.driverEventService.prepareDriverEvent?.(request) ?? request,
      recordDriverEvent: (request) => runWithRefresh((client) => client.driverEventService.recordDriverEvent(request)),
    },
    proofMediaUploadService: {
      uploadProofMedia: (request) => runWithRefresh((client) => client.proofMediaUploadService.uploadProofMedia(request)),
    },
  };
}
