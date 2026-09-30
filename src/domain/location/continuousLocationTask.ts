import type {
  DriverAccessTokenStore,
  PersistedDriverAccess,
} from '../driver/driverAccessTokenStore';
import type { DriverAuthService } from '../driverAuth/driverAuth';
import {
  createRouteStartedDriverEvent,
  prepareDriverEventForPersistence,
  type DriverEventInput,
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
  | { kind: 'ignored'; reason: 'completion_pending' | 'inactive_route' }
  | {
      kind: 'processed';
      droppedCount?: number;
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
  hashObservationIdentity?: (identity: string) => Promise<string>;
  locations: ContinuousLocationBatchItem[];
  nativeBatchDeliveredAt?: Date;
  offlineQueue: OfflineSubmissionQueue;
  provenance?: { appVersion?: string; platform?: string; versionCode?: number };
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
    return { kind: 'ignored', reason: 'completion_pending' };
  }
  const sessionGeneration = persistedAccess.activeRouteSession.startedAt
    ?? persistedAccess.activeRouteSession.updatedAt;
  const accountPhoneE164 = persistedAccess.driverProfile.phoneE164;
  const assignmentGeneration = persistedAccess.routeAccess?.assignmentGeneration;
  const isSessionCurrent = async () => !routeRevoked && await isPersistedActiveRouteSessionCurrent({
    driverAccessTokenStore: input.driverAccessTokenStore, routePlanId, sessionGeneration,
    accountPhoneE164, assignmentGeneration,
  });
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
        accountPhoneE164,
        assignmentGeneration,
      });
      routeRevoked ||= refreshResult.kind === 'revoked';
      return refreshResult.kind === 'refreshed' ? refreshResult.driverAccess : null;
    },
  });
  const precedingEvents: DriverEventInput[] = [];
  if (persistedAccess.activeRouteSession.routeStartedRecordedAt === undefined) {
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
    precedingEvents.push(routeStartedEvent);
  }
  const recorded = await recordContinuousLocationUpdateBatch({
    driverEventService,
    hashObservationIdentity: input.hashObservationIdentity,
    isSessionCurrent,
    locations: input.locations,
    nativeBatchDeliveredAt: input.nativeBatchDeliveredAt,
    offlineQueue: input.offlineQueue,
    // Live services prepare the ordered contract. Plain mock/legacy services
    // have no preparer; keep their existing compatibility path.
    ...(driverEventService.prepareDriverEvent === undefined ? {} : {
      orderedEventAccessIdentity: persistedAccess.routeAccess,
    }),
    precedingEvents,
    provenance: input.provenance,
    routePlanId,
    sessionContext: { assignmentGeneration, sessionGeneration },
  });
  if (recorded.kind === 'recorded' && recorded.routeStartedAcknowledged === true && await isSessionCurrent()) {
    await input.driverAccessTokenStore.markActiveRouteStarted(routePlanId, sessionGeneration);
  }

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
  await input.offlineQueue.whenPersisted();

  if (routeRevoked) {
    const cleared = await input.driverAccessTokenStore.clearActiveRouteSession(routePlanId, sessionGeneration);
    if (cleared) {
      input.offlineQueue.blockRouteSubmissionsForReconciliation(routePlanId);
      await input.offlineQueue.whenPersisted();
      await input.driverAccessTokenStore.clearCachedRouteAccess(routePlanId);
      return { kind: 'deactivated', reason: 'route_revoked', routePlanId, sessionGeneration };
    }
  }

  return {
    kind: 'processed',
    ...(recorded.kind !== 'recorded' || recorded.droppedCount === undefined ? {} : { droppedCount: recorded.droppedCount }),
    ...(recorded.queuedCount === undefined ? {} : { queuedCount: recorded.queuedCount }),
    recordedCount: recorded.recordedCount,
    routePlanId,
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
  routeAccessService: Pick<RouteAccessService, 'lookupRouteAccess'>;
  routePlanId: string;
  sessionGeneration: string;
  accountPhoneE164: string;
  assignmentGeneration?: string;
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
    || persistedAccess.driverProfile.phoneE164 !== input.accountPhoneE164
    || persistedAccess.routeAccess?.assignmentGeneration !== input.assignmentGeneration
  ) {
    return { kind: 'inactive' };
  }

  let accountAccess = persistedAccess.accountAccess;
  if (persistedAccess.kind === 'refresh_required') {
    const refreshed = await input.driverAuthService.refreshSession({
      refreshToken: persistedAccess.accountAccess.refreshToken,
    });
    accountAccess = refreshed.accountAccess;
    if (!(await isPersistedActiveRouteSessionCurrent(input))) return { kind: 'inactive' };
    await input.driverAccessTokenStore.saveRefreshedAccountAccess(accountAccess);
  }

  const lookup = await input.routeAccessService.lookupRouteAccess({
    accountAccessToken: accountAccess.accessToken,
    routeContext: persistedAccess.routeAccess?.routeContext ?? null,
  });
  const route = findRouteAccessChoice(lookup, input.routePlanId);
  if (!(await isPersistedActiveRouteSessionCurrent(input))) return { kind: 'inactive' };
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
  accountPhoneE164?: string;
  assignmentGeneration?: string;
}): Promise<boolean> {
  const persistedAccess = await input.driverAccessTokenStore.loadActiveDriverAccess();
  return (
    (persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required')
    && persistedAccess.activeRouteSession?.routePlanId === input.routePlanId
    && persistedAccess.activeRouteSession.status === 'active'
    && (persistedAccess.activeRouteSession.startedAt ?? persistedAccess.activeRouteSession.updatedAt) === input.sessionGeneration
    && persistedAccess.routeAccess?.routePlanId === input.routePlanId
    && (input.accountPhoneE164 === undefined || persistedAccess.driverProfile.phoneE164 === input.accountPhoneE164)
    && (input.assignmentGeneration === undefined || persistedAccess.routeAccess.assignmentGeneration === input.assignmentGeneration)
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
