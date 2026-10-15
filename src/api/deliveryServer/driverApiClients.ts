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
import { observeDriverDiagnosticOperation } from '../../domain/diagnostics/driverDiagnosticObservation';
import {
  createLiveRouteChangeApiClient,
  type LiveRouteChangeFetchLike,
  type LiveRouteChangeService,
} from '../../domain/route/liveRouteChange';

export type DriverApiClients = {
  assignedRouteService: AssignedRouteService;
  driverConsentService: DriverConsentService;
  driverEventService: DriverEventService;
  liveRouteChangeService: LiveRouteChangeService;
  proofMediaUploadService: ProofMediaUploadService;
};

export type DriverApiClientsFetchLike = AssignedRouteFetchLike
  & DriverConsentFetchLike
  & DriverEventFetchLike
  & LiveRouteChangeFetchLike
  & ProofMediaUploadFetchLike;

export type DriverAccessRefresh = (signal?: AbortSignal) => Promise<DriverAccessToken | null>;

/**
 * The driver access token lives 15 minutes. A request made in its last two minutes refreshes it
 * first, so the server sees no expired token and the runtime diagnostics record no 401 blocker.
 */
export const DRIVER_ACCESS_REFRESH_AHEAD_MS = 2 * 60_000;

export function createDriverApiClientsFromRouteAccess(input: {
  appVersion?: string;
  deliveryProofCapability?: 'delivery-proof-v1';
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  now?: () => number;
  refreshDriverAccess?: DriverAccessRefresh;
  routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>;
  versionCode?: number;
}): DriverApiClients {
  return createDriverApiClientsFromAccessToken({
    accessExpiresAt: input.routeAccess.driverAccess.expiresAt,
    accessToken: input.routeAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    now: input.now,
    orderedEventContract: {
      ...(input.deliveryProofCapability === undefined ? {} : { deliveryProofCapability: input.deliveryProofCapability }),
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
  deliveryProofCapability?: 'delivery-proof-v1';
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  now?: () => number;
  persistedAccess: PersistedDriverAccess & { driverAccess: DriverAccessToken };
  refreshDriverAccess?: DriverAccessRefresh;
  versionCode?: number;
}): DriverApiClients {
  return createDriverApiClientsFromAccessToken({
    accessExpiresAt: input.persistedAccess.driverAccess.expiresAt,
    accessToken: input.persistedAccess.driverAccess.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    now: input.now,
    ...(!hasDriverOrderedEventLineage(input.persistedAccess.routeAccess) ? {} : {
      orderedEventContract: {
        ...(input.deliveryProofCapability === undefined ? {} : { deliveryProofCapability: input.deliveryProofCapability }),
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
  accessExpiresAt?: string;
  accessToken: string;
  baseUrl: string;
  fetchImpl?: DriverApiClientsFetchLike;
  now?: () => number;
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
    liveRouteChangeService: createLiveRouteChangeApiClient({
      accessToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
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
    initialAccessExpiresAt: input.accessExpiresAt,
    initialAccessToken: input.accessToken,
    now: input.now,
    refreshDriverAccess: input.refreshDriverAccess,
  });
}

function withDriverAccessRefresh(input: {
  buildClients(accessToken: string): DriverApiClients;
  initialAccessExpiresAt?: string;
  initialAccessToken: string;
  now?: () => number;
  refreshDriverAccess: DriverAccessRefresh;
}): DriverApiClients {
  const now = input.now ?? Date.now;
  let clients = input.buildClients(input.initialAccessToken);
  let accessExpiresAtMs = Date.parse(input.initialAccessExpiresAt ?? '');
  let refreshAhead: Promise<void> | null = null;

  function adoptRefreshedAccess(refreshedAccess: DriverAccessToken): void {
    clients = input.buildClients(refreshedAccess.accessToken);
    accessExpiresAtMs = Date.parse(refreshedAccess.expiresAt);
  }

  /** One refresh serves every request that arrives while it runs; a failure leaves the current token in place. */
  function refreshAccessAhead(signal?: AbortSignal): Promise<void> {
    if (refreshAhead === null) {
      refreshAhead = (async () => {
        try {
          const refreshedAccess = await observeDriverDiagnosticOperation(
            { operation: 'AUTH_REFRESH' },
            () => input.refreshDriverAccess(signal),
          );
          if (refreshedAccess !== null && signal?.aborted !== true) adoptRefreshedAccess(refreshedAccess);
        } catch {
          // The request still goes out with the current token; a 401 takes the normal refresh path below.
        } finally {
          refreshAhead = null;
        }
      })();
    }
    return refreshAhead;
  }

  async function runWithRefresh<T>(
    call: (clients: DriverApiClients) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (Number.isFinite(accessExpiresAtMs) && accessExpiresAtMs - now() <= DRIVER_ACCESS_REFRESH_AHEAD_MS) {
      await refreshAccessAhead(signal);
    }
    try {
      return await call(clients);
    } catch (error) {
      if (getDriverApiRecoveryReason(error) !== 'driver_access_expired') {
        throw error;
      }

      const refreshedAccess = await observeDriverDiagnosticOperation(
        { operation: 'AUTH_REFRESH' },
        () => input.refreshDriverAccess(signal),
      );
      if (signal?.aborted === true || refreshedAccess === null) {
        throw error;
      }

      adoptRefreshedAccess(refreshedAccess);
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
      recordDriverEvent: (request, options) => runWithRefresh(
        (client) => client.driverEventService.recordDriverEvent(request, options),
        options?.signal,
      ),
    },
    liveRouteChangeService: {
      getLiveRouteChange: (request, options) => runWithRefresh(
        (client) => client.liveRouteChangeService.getLiveRouteChange(request, options),
        options?.signal,
      ),
      acknowledgeLiveRouteChange: (request, options) => runWithRefresh(
        (client) => client.liveRouteChangeService.acknowledgeLiveRouteChange(request, options),
        options?.signal,
      ),
    },
    proofMediaUploadService: {
      uploadProofMedia: (request, options) => runWithRefresh(
        (client) => client.proofMediaUploadService.uploadProofMedia(request, options),
        options?.signal,
      ),
    },
  };
}
