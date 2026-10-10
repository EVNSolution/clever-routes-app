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
  sendStoredContinuousLocations,
  type ContinuousLocationBatchItem,
} from './continuousLocationStream';

type DriverEventServiceFactoryInput = {
  persistedAccess: PersistedDriverAccess & { driverAccess: DriverAccessToken };
  refreshDriverAccess: () => Promise<DriverAccessToken | null>;
};

export type ContinuousLocationTaskResult =
  | {
      kind: 'deactivated';
      reason: 'pre_start_ended' | 'route_not_in_progress' | 'route_revoked';
      routePlanId: string;
      sessionGeneration: string;
    }
  | { kind: 'ignored'; reason: 'completion_pending' | 'inactive_route' }
  | {
      kind: 'processed';
      queuedCount?: number;
      recordedCount: number;
      routePlanId: string;
      storedSentCount?: number;
    };

/** Tracking before Start ends on its own after a working day, even if the driver never presses Start. */
export const PRE_START_TRACKING_MAX_AGE_MS = 20 * 60 * 60 * 1000;

type ContinuousLocationTaskInput = {
  createDriverEventService(input: DriverEventServiceFactoryInput): DriverEventService;
  driverAccessTokenStore: Pick<
    DriverAccessTokenStore,
    | 'clearActiveRouteSession'
    | 'clearCachedRouteAccess'
    | 'clearPreStartTracking'
    | 'loadActiveDriverAccess'
    | 'markActiveRouteStarted'
    | 'saveFromInvitedRouteAccess'
    | 'saveRefreshedAccountAccess'
  >;
  driverAuthService: Pick<DriverAuthService, 'refreshSession'>;
  locations: ContinuousLocationBatchItem[];
  now?: () => number;
  offlineQueue: OfflineSubmissionQueue;
  routeAccessService: Pick<RouteAccessService, 'lookupRouteAccess'>;
};

export async function processContinuousLocationTaskBatch(input: ContinuousLocationTaskInput): Promise<ContinuousLocationTaskResult> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  if (
    (persistedAccess.kind !== 'active' && persistedAccess.kind !== 'refresh_required')
    || persistedAccess.driverAccess === undefined
  ) {
    return { kind: 'ignored', reason: 'inactive_route' };
  }
  if (persistedAccess.activeRouteSession === undefined) {
    return processPreStartLocationBatch(input, { ...persistedAccess, driverAccess: persistedAccess.driverAccess });
  }
  if (persistedAccess.routeAccess?.routePlanId !== persistedAccess.activeRouteSession.routePlanId) {
    return { kind: 'ignored', reason: 'inactive_route' };
  }

  const routePlanId = persistedAccess.activeRouteSession.routePlanId;
  if (persistedAccess.activeRouteSession.status === 'completion_pending') {
    return { kind: 'ignored', reason: 'completion_pending' };
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
        ...(persistedAccess.activeRouteSession.routeStartedLocation === undefined ? {} : {
          locationEvidence: {
            accuracyMeters: persistedAccess.activeRouteSession.routeStartedLocation.accuracyMeters,
            latitude: persistedAccess.activeRouteSession.routeStartedLocation.latitude,
            longitude: persistedAccess.activeRouteSession.routeStartedLocation.longitude,
            recordedAt: new Date(persistedAccess.activeRouteSession.routeStartedLocation.recordedAt),
          },
        }),
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
    if (await isPersistedActiveRouteSessionCompletionPending({
      driverAccessTokenStore: input.driverAccessTokenStore,
      routePlanId,
      sessionGeneration,
    })) {
      return { kind: 'ignored', reason: 'completion_pending' };
    }
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
  if (await isPersistedActiveRouteSessionCompletionPending({
    driverAccessTokenStore: input.driverAccessTokenStore,
    routePlanId,
    sessionGeneration,
  })) {
    return { kind: 'ignored', reason: 'completion_pending' };
  }
  // The live request just got through, so the connection is back: also send the points stored while it was not.
  const storedSent = routeStartReady && !routeRevoked && recorded.recordedCount > 0 && recorded.queuedCount === undefined
    ? await sendStoredContinuousLocations({
        driverEventService,
        isSessionCurrent: async () => (
          !routeRevoked
          && await isPersistedActiveRouteSessionCurrent({
            driverAccessTokenStore: input.driverAccessTokenStore,
            routePlanId,
            sessionGeneration,
          })
        ),
        offlineQueue: input.offlineQueue,
        routePlanId,
      })
    : { sentCount: 0 };
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
    ...(storedSent.sentCount === 0 ? {} : { storedSentCount: storedSent.sentCount }),
  };
}

/**
 * Tracking before Start: the driver has not pressed Start, but today's route is on the phone and
 * the background permission was granted earlier. Positions go to the same route; no route-start
 * event is sent, and the tracking ends when the route is started (the active session takes
 * over), released, revoked, or after PRE_START_TRACKING_MAX_AGE_MS.
 */
async function processPreStartLocationBatch(
  input: ContinuousLocationTaskInput,
  persistedAccess: PersistedDriverAccess & { driverAccess: DriverAccessToken },
): Promise<ContinuousLocationTaskResult> {
  const preStart = persistedAccess.preStartTracking;
  if (preStart === undefined || persistedAccess.routeAccess?.routePlanId !== preStart.routePlanId) {
    return { kind: 'ignored', reason: 'inactive_route' };
  }
  const routePlanId = preStart.routePlanId;
  const sessionGeneration = preStart.startedAt;
  const now = input.now ?? Date.now;
  if (now() - Date.parse(preStart.startedAt) > PRE_START_TRACKING_MAX_AGE_MS) {
    await input.driverAccessTokenStore.clearPreStartTracking(routePlanId);
    return { kind: 'deactivated', reason: 'pre_start_ended', routePlanId, sessionGeneration };
  }
  const isCurrent = async (): Promise<boolean> => {
    const latest = await input.driverAccessTokenStore.loadActiveDriverAccess();
    return (latest.kind === 'active' || latest.kind === 'refresh_required')
      && latest.activeRouteSession === undefined
      && latest.preStartTracking?.routePlanId === routePlanId
      && latest.preStartTracking.startedAt === sessionGeneration
      && latest.routeAccess?.routePlanId === routePlanId;
  };
  let routeRevoked = false;
  const driverEventService = input.createDriverEventService({
    persistedAccess: {
      accountAccess: persistedAccess.accountAccess,
      driverAccess: persistedAccess.driverAccess,
      driverProfile: persistedAccess.driverProfile,
      preStartTracking: preStart,
      routeAccess: persistedAccess.routeAccess,
    },
    refreshDriverAccess: async () => {
      const refreshResult = await refreshPersistedDriverAccess({
        driverAccessTokenStore: input.driverAccessTokenStore,
        driverAuthService: input.driverAuthService,
        isCurrent,
        routeAccessService: input.routeAccessService,
        routePlanId,
        sessionGeneration,
      });
      routeRevoked ||= refreshResult.kind === 'revoked';
      return refreshResult.kind === 'refreshed' ? refreshResult.driverAccess : null;
    },
  });
  const recorded = await recordContinuousLocationUpdateBatch({
    driverEventService,
    isSessionCurrent: async () => !routeRevoked && await isCurrent(),
    locations: input.locations,
    offlineQueue: input.offlineQueue,
    routePlanId,
  });
  if (recorded.kind === 'route_not_in_progress') {
    await input.driverAccessTokenStore.clearPreStartTracking(routePlanId);
    await input.offlineQueue.whenPersisted();
    return { kind: 'deactivated', reason: 'route_not_in_progress', routePlanId, sessionGeneration };
  }
  const storedSent = !routeRevoked && recorded.recordedCount > 0 && recorded.queuedCount === undefined
    ? await sendStoredContinuousLocations({
        driverEventService,
        isSessionCurrent: async () => !routeRevoked && await isCurrent(),
        offlineQueue: input.offlineQueue,
        routePlanId,
      })
    : { sentCount: 0 };
  await input.offlineQueue.whenPersisted();
  if (routeRevoked) {
    await input.driverAccessTokenStore.clearPreStartTracking(routePlanId);
    await input.driverAccessTokenStore.clearCachedRouteAccess(routePlanId);
    return { kind: 'deactivated', reason: 'route_revoked', routePlanId, sessionGeneration };
  }
  return {
    kind: 'processed',
    ...(recorded.queuedCount === undefined ? {} : { queuedCount: recorded.queuedCount }),
    recordedCount: recorded.recordedCount,
    routePlanId,
    ...(storedSent.sentCount === 0 ? {} : { storedSentCount: storedSent.sentCount }),
  };
}

async function isPersistedActiveRouteSessionCompletionPending(input: {
  driverAccessTokenStore: Pick<DriverAccessTokenStore, 'loadActiveDriverAccess'>;
  routePlanId: string;
  sessionGeneration: string;
}): Promise<boolean> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  if (
    (persistedAccess.kind !== 'active' && persistedAccess.kind !== 'refresh_required')
    || persistedAccess.activeRouteSession === undefined
  ) {
    return false;
  }

  const activeSessionGeneration = persistedAccess.activeRouteSession.startedAt
    ?? persistedAccess.activeRouteSession.updatedAt;
  return persistedAccess.activeRouteSession.routePlanId === input.routePlanId
    && activeSessionGeneration === input.sessionGeneration
    && persistedAccess.activeRouteSession.status === 'completion_pending';
}

async function refreshPersistedDriverAccess(input: {
  driverAccessTokenStore: Pick<
    DriverAccessTokenStore,
    'loadActiveDriverAccess' | 'saveFromInvitedRouteAccess' | 'saveRefreshedAccountAccess'
  >;
  driverAuthService: Pick<DriverAuthService, 'refreshSession'>;
  /** Tracking before Start has no active session; it brings its own currency check. */
  isCurrent?: () => Promise<boolean>;
  routeAccessService: Pick<RouteAccessService, 'lookupRouteAccess'>;
  routePlanId: string;
  sessionGeneration: string;
}): Promise<
  | { kind: 'inactive' }
  | { kind: 'refreshed'; driverAccess: DriverAccessToken }
  | { kind: 'revoked' }
> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  if (persistedAccess.kind !== 'active' && persistedAccess.kind !== 'refresh_required') {
    return { kind: 'inactive' };
  }
  if (input.isCurrent !== undefined) {
    if (!(await input.isCurrent())) return { kind: 'inactive' };
  } else if (
    persistedAccess.activeRouteSession?.routePlanId !== input.routePlanId
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
    await input.driverAccessTokenStore.saveRefreshedAccountAccess(accountAccess, {
      accessToken: persistedAccess.accountAccess.accessToken,
      phoneE164: persistedAccess.driverProfile.phoneE164,
      refreshToken: persistedAccess.accountAccess.refreshToken,
    });
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
    && persistedAccess.activeRouteSession.status === 'active'
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
