import type {
  DriverAccessTokenStore,
  PersistedDriverAccess,
} from '../driver/driverAccessTokenStore';
import type { DriverAuthService } from '../driverAuth/driverAuth';
import {
  createRouteStartedDriverEvent,
  prepareDriverEventForPersistence,
  type DriverEventService,
} from '../events/driverEvents';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import type {
  DriverAccessToken,
  RouteAccessLookupResult,
  RouteAccessRouteChoice,
  RouteAccessService,
} from '../routeAccess/routeAccess';
import {
  recordContinuousLocationUpdateBatch,
  type ContinuousLocationBatchItem,
} from './continuousLocationStream';

type DriverEventServiceFactoryInput = {
  persistedAccess: PersistedDriverAccess & { driverAccess: DriverAccessToken };
  refreshDriverAccess: () => Promise<DriverAccessToken | null>;
};

export type ContinuousLocationTaskResult =
  | {
      kind: 'deactivated';
      reason: 'route_not_in_progress' | 'route_revoked';
      routePlanId: string;
      sessionGeneration: string;
    }
  | { kind: 'ignored'; reason: 'inactive_route' }
  | {
      kind: 'processed';
      queuedCount?: number;
      recordedCount: number;
      routePlanId: string;
    };

export async function processContinuousLocationTaskBatch(input: {
  createDriverEventService(input: DriverEventServiceFactoryInput): DriverEventService;
  driverAccessTokenStore: Pick<
    DriverAccessTokenStore,
    | 'clearActiveRouteSession'
    | 'clearCachedRouteAccess'
    | 'loadActiveDriverAccess'
    | 'markActiveRouteStarted'
    | 'saveFromInvitedRouteAccess'
    | 'saveRefreshedAccountAccess'
  >;
  driverAuthService: Pick<DriverAuthService, 'refreshSession'>;
  locations: ContinuousLocationBatchItem[];
  offlineQueue: OfflineSubmissionQueue;
  routeAccessService: Pick<RouteAccessService, 'lookupRouteAccess'>;
}): Promise<ContinuousLocationTaskResult> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  if (
    (persistedAccess.kind !== 'active' && persistedAccess.kind !== 'refresh_required')
    || persistedAccess.activeRouteSession === undefined
    || persistedAccess.driverAccess === undefined
    || persistedAccess.routeAccess?.routePlanId !== persistedAccess.activeRouteSession.routePlanId
  ) {
    return { kind: 'ignored', reason: 'inactive_route' };
  }

  const routePlanId = persistedAccess.activeRouteSession.routePlanId;
  if (persistedAccess.activeRouteSession.status === 'completion_pending') {
    return { kind: 'processed', recordedCount: 0, routePlanId };
  }
  const sessionGeneration = persistedAccess.activeRouteSession.startedAt
    ?? persistedAccess.activeRouteSession.updatedAt;
  let routeRevoked = false;
  const driverEventService = input.createDriverEventService({
    persistedAccess: {
      accountAccess: persistedAccess.accountAccess,
      activeRouteSession: persistedAccess.activeRouteSession,
      driverAccess: persistedAccess.driverAccess,
      driverProfile: persistedAccess.driverProfile,
      routeAccess: persistedAccess.routeAccess,
    },
    refreshDriverAccess: async () => {
      const refreshResult = await refreshPersistedDriverAccess({
        driverAccessTokenStore: input.driverAccessTokenStore,
        driverAuthService: input.driverAuthService,
        routeAccessService: input.routeAccessService,
        routePlanId,
        sessionGeneration,
      });
      routeRevoked ||= refreshResult.kind === 'revoked';
      return refreshResult.kind === 'refreshed' ? refreshResult.driverAccess : null;
    },
  });
  let routeStartReady = persistedAccess.activeRouteSession.routeStartedRecordedAt !== undefined;
  if (!routeStartReady) {
    const routeStartedEvent = prepareDriverEventForPersistence(
      driverEventService,
      createRouteStartedDriverEvent({
        occurredAt: new Date(sessionGeneration),
        routePlanId,
      }),
    );
    try {
      await driverEventService.recordDriverEvent(routeStartedEvent);
      routeStartReady = await input.driverAccessTokenStore.markActiveRouteStarted(routePlanId, sessionGeneration);
    } catch {
      if (
        !routeRevoked
        && await isPersistedActiveRouteSessionCurrent({
          driverAccessTokenStore: input.driverAccessTokenStore,
          routePlanId,
          sessionGeneration,
        })
      ) {
        input.offlineQueue.enqueueDriverEvent(routeStartedEvent);
      }
    }
  }
  const recorded = await recordContinuousLocationUpdateBatch({
    driverEventService: routeStartReady
      ? driverEventService
      : {
          recordDriverEvent: async () => {
            throw new Error('Route start is pending durable retry.');
          },
        },
    isSessionCurrent: async () => (
      !routeRevoked
      && await isPersistedActiveRouteSessionCurrent({
        driverAccessTokenStore: input.driverAccessTokenStore,
        routePlanId,
        sessionGeneration,
      })
    ),
    locations: input.locations,
    offlineQueue: input.offlineQueue,
    routePlanId,
  });

  if (recorded.kind === 'route_not_in_progress') {
    const cleared = await input.driverAccessTokenStore.clearActiveRouteSession(routePlanId, sessionGeneration);
    if (cleared) {
      input.offlineQueue.blockRouteSubmissionsForReconciliation(routePlanId);
      await input.offlineQueue.whenPersisted();
      return {
        kind: 'deactivated',
        reason: 'route_not_in_progress',
        routePlanId,
        sessionGeneration,
      };
    }

    return {
      kind: 'processed',
      recordedCount: recorded.recordedCount,
      routePlanId,
    };
  }
  await input.offlineQueue.whenPersisted();

  if (routeRevoked) {
    const cleared = await input.driverAccessTokenStore.clearActiveRouteSession(routePlanId, sessionGeneration);
    if (cleared) {
      await input.driverAccessTokenStore.clearCachedRouteAccess(routePlanId);
      return { kind: 'deactivated', reason: 'route_revoked', routePlanId, sessionGeneration };
    }
  }

  return {
    kind: 'processed',
    ...(recorded.queuedCount === undefined ? {} : { queuedCount: recorded.queuedCount }),
    recordedCount: recorded.recordedCount,
    routePlanId,
  };
}

async function refreshPersistedDriverAccess(input: {
  driverAccessTokenStore: Pick<
    DriverAccessTokenStore,
    'loadActiveDriverAccess' | 'saveFromInvitedRouteAccess' | 'saveRefreshedAccountAccess'
  >;
  driverAuthService: Pick<DriverAuthService, 'refreshSession'>;
  routeAccessService: Pick<RouteAccessService, 'lookupRouteAccess'>;
  routePlanId: string;
  sessionGeneration: string;
}): Promise<
  | { kind: 'inactive' }
  | { kind: 'refreshed'; driverAccess: DriverAccessToken }
  | { kind: 'revoked' }
> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  if (
    (persistedAccess.kind !== 'active' && persistedAccess.kind !== 'refresh_required')
    || persistedAccess.activeRouteSession?.routePlanId !== input.routePlanId
    || (persistedAccess.activeRouteSession.startedAt ?? persistedAccess.activeRouteSession.updatedAt) !== input.sessionGeneration
  ) {
    return { kind: 'inactive' };
  }

  let accountAccess = persistedAccess.accountAccess;
  if (persistedAccess.kind === 'refresh_required') {
    const refreshed = await input.driverAuthService.refreshSession({
      refreshToken: persistedAccess.accountAccess.refreshToken,
    });
    accountAccess = refreshed.accountAccess;
    await input.driverAccessTokenStore.saveRefreshedAccountAccess(accountAccess);
  }

  const lookup = await input.routeAccessService.lookupRouteAccess({
    accountAccessToken: accountAccess.accessToken,
    routeContext: persistedAccess.routeAccess?.routeContext ?? null,
  });
  const route = findRouteAccessChoice(lookup, input.routePlanId);
  if (route === null) {
    return { kind: 'revoked' };
  }

  const saved = await input.driverAccessTokenStore.saveFromInvitedRouteAccess({
    status: 'INVITED',
    companyGuidance: route.companyGuidance,
    driverAccess: route.driverAccess,
    routeAccess: route.routeAccess,
  });
  return saved
    ? { driverAccess: route.driverAccess, kind: 'refreshed' }
    : { kind: 'inactive' };
}

async function isPersistedActiveRouteSessionCurrent(input: {
  driverAccessTokenStore: Pick<DriverAccessTokenStore, 'loadActiveDriverAccess'>;
  routePlanId: string;
  sessionGeneration: string;
}): Promise<boolean> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  return (
    (persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required')
    && persistedAccess.activeRouteSession?.routePlanId === input.routePlanId
    && (persistedAccess.activeRouteSession.startedAt ?? persistedAccess.activeRouteSession.updatedAt) === input.sessionGeneration
    && persistedAccess.routeAccess?.routePlanId === input.routePlanId
  );
}

function findRouteAccessChoice(
  lookup: RouteAccessLookupResult,
  routePlanId: string,
): RouteAccessRouteChoice | null {
  if (lookup.status === 'ROUTES_FOUND') {
    return lookup.routes.find((route) => route.routeAccess.routePlanId === routePlanId) ?? null;
  }
  if (lookup.status !== 'INVITED' || lookup.routeAccess.routePlanId !== routePlanId) {
    return null;
  }
  return {
    companyGuidance: lookup.companyGuidance,
    driverAccess: lookup.driverAccess,
    routeAccess: lookup.routeAccess,
  };
}
