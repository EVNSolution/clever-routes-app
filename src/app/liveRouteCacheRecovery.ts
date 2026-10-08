import type { PersistedActiveRouteSession, PersistedDriverAccess } from '../domain/driver/driverAccessTokenStore';
import type { AssignedRoute } from '../domain/route/assignedRoute';
import type { LiveRouteChangeState, LiveRouteChangeStore } from '../domain/route/liveRouteChangeStore';
import { RouteAccessTransportError, type RouteAccessRouteChoice, type RouteAccessSubmissionResult } from '../domain/routeAccess/routeAccess';
import { DriverApiHttpError } from '../api/deliveryServer/driverApiError';
import { supportsLiveRouteChanges } from './liveRouteChangeController';

export type CachedLiveRouteSession = RouteAccessRouteChoice & { route: AssignedRoute };
export type LiveRouteLoadStage = 'LR01' | 'LR02' | 'LR03' | 'LR04' | 'LR05' | 'LR06';

export type CachedLiveRouteValidation = {
  accountOwnerHash: string;
  assignmentGeneration: string;
  routePlanId: string;
};

export function canRefreshCachedLiveRoute(input: {
  cached: CachedLiveRouteValidation | null;
  accountOwnerHash: string | null;
  activeRoutePlanId: string | null;
  routeAccess: Pick<RouteAccessRouteChoice['routeAccess'], 'routePlanId' | 'assignmentGeneration'> | null;
  isForeground: boolean;
  isOnline: boolean;
  hasPendingRouteEnd?: boolean;
}): boolean {
  return input.cached !== null && input.isForeground && input.isOnline
    && input.accountOwnerHash === input.cached.accountOwnerHash
    && (input.activeRoutePlanId === input.cached.routePlanId || input.activeRoutePlanId === null && input.hasPendingRouteEnd === true)
    && input.routeAccess?.routePlanId === input.cached.routePlanId
    && input.routeAccess.assignmentGeneration === input.cached.assignmentGeneration;
}

export function getLiveRouteLoadDiagnostic(stage: LiveRouteLoadStage, error: unknown) {
  if (error instanceof DriverApiHttpError) return { code: stage, category: 'HTTP_FAILURE', httpStatus: error.status };
  if (isReleasedNativeObjectError(error)) return { code: stage, category: 'NATIVE_SHARED_OBJECT', nativeErrorCode: 'ERR_USING_RELEASED_SHARED_OBJECT' };
  return { code: stage, category: isOfflineLookupFailure(error) ? 'NETWORK_FAILURE' : 'OTHER_FAILURE' };
}

export type LiveRouteAccessRecoveryInput = {
  accountOwnerHash: string;
  activeRouteSession: PersistedActiveRouteSession | null;
  createStore(): Promise<LiveRouteChangeStore>;
  isCurrent(): boolean;
  lookup(): Promise<RouteAccessSubmissionResult>;
  persistedAccess?: Pick<PersistedDriverAccess, 'driverAccess' | 'routeAccess'>;
  observeRecovery?(diagnostic: LiveRouteRecoveryDiagnostic): void;
};

export type LiveRouteRecoveryDiagnostic = {
  code: 'SKIPPED_PERSISTED_SCOPE' | 'SKIPPED_STALE_SCOPE' | 'CACHE_READ_FAILED' | 'CACHED_SNAPSHOT_UNAVAILABLE' | 'RESTORED_CACHED_ROUTE';
  activeStatus?: 'active' | 'completion_pending' | 'missing';
  hasDriverAccess?: boolean;
  hasRouteAccess?: boolean;
  routeMatches?: boolean;
  hasState?: boolean;
  hasAppliedRoute?: boolean;
  hasAppliedVersion?: boolean;
  generationMatches?: boolean;
  shopSupported?: boolean;
  nativeErrorCode?: 'ERR_USING_RELEASED_SHARED_OBJECT';
};

export type LiveRouteAccessRecovery = {
  cached: { session: CachedLiveRouteSession; state: LiveRouteChangeState } | null;
  lookupResult: RouteAccessSubmissionResult;
};

export async function loadRouteAccessWithLiveCacheRecovery(input: LiveRouteAccessRecoveryInput): Promise<LiveRouteAccessRecovery> {
  try {
    const lookupResult = await input.lookup();
    if (!input.isCurrent()) throw new Error('Driver account changed during route refresh.');
    return { cached: null, lookupResult };
  } catch (error) {
    const active = input.activeRouteSession;
    const access = input.persistedAccess;
    if (!isOfflineLookupFailure(error)) throw error;
    const observe = input.observeRecovery ?? (diagnostic => console.warn('[live-route-recovery]', diagnostic));
    if (!input.isCurrent()) { observe({ code: 'SKIPPED_STALE_SCOPE' }); throw error; }
    if (active?.status !== 'active'
      || access?.driverAccess === undefined || access.routeAccess === undefined
      || active.routePlanId !== access.routeAccess.routePlanId) {
      observe({ code: 'SKIPPED_PERSISTED_SCOPE', activeStatus: active?.status ?? 'missing',
        hasDriverAccess: access?.driverAccess !== undefined, hasRouteAccess: access?.routeAccess !== undefined,
        routeMatches: active != null && access?.routeAccess !== undefined && active.routePlanId === access.routeAccess.routePlanId });
      throw error;
    }
    let state: LiveRouteChangeState | null;
    try {
      const store = await input.createStore();
      if (!input.isCurrent()) throw error;
      state = await store.read(input.accountOwnerHash, active.routePlanId, access.routeAccess.assignmentGeneration);
    } catch (cacheError) {
      // Keep a malformed or unavailable cache intact and preserve the original connection failure.
      observe(!input.isCurrent() ? { code: 'SKIPPED_STALE_SCOPE' } : {
        code: 'CACHE_READ_FAILED', ...(isReleasedNativeObjectError(cacheError)
          ? { nativeErrorCode: 'ERR_USING_RELEASED_SHARED_OBJECT' as const } : {}),
      });
      throw error;
    }
    if (!input.isCurrent()) { observe({ code: 'SKIPPED_STALE_SCOPE' }); throw error; }
    if (state?.appliedRoute == null || state.appliedPublicationVersionId === null
      || state.routePlanId !== active.routePlanId || state.assignmentGeneration !== access.routeAccess.assignmentGeneration
      || !supportsLiveRouteChanges(state.appliedRoute.shopDomain)) {
      observe({ code: 'CACHED_SNAPSHOT_UNAVAILABLE', hasState: state !== null, hasAppliedRoute: state?.appliedRoute != null,
        hasAppliedVersion: state?.appliedPublicationVersionId != null, routeMatches: state?.routePlanId === active.routePlanId,
        generationMatches: state?.assignmentGeneration === access.routeAccess.assignmentGeneration,
        shopSupported: state?.appliedRoute != null && supportsLiveRouteChanges(state.appliedRoute.shopDomain) });
      throw error;
    }
    const route = state.appliedRoute;
    const session: CachedLiveRouteSession = {
      route,
      driverAccess: access.driverAccess,
      routeAccess: { ...access.routeAccess, expectedRouteVersionId: state.appliedPublicationVersionId },
      companyGuidance: {
        companyDisplayName: route.shopDomain, deliveryDate: route.deliveryDate, driverInstructions: [],
        executionStatus: 'IN_PROGRESS', operatorSupportContact: null, pickupGuidance: null,
        routeName: route.name, shopDomain: route.shopDomain, timezone: route.timezone,
      },
    };
    observe({ code: 'RESTORED_CACHED_ROUTE' });
    return { cached: { session, state }, lookupResult: {
      kind: 'company_guidance', flowState: 'company_context_confirmed', nextState: 'consent_required',
      companyGuidance: session.companyGuidance, driverAccess: session.driverAccess, routeAccess: session.routeAccess,
    } };
  }
}

function isReleasedNativeObjectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_USING_RELEASED_SHARED_OBJECT';
}

function isOfflineLookupFailure(error: unknown): boolean {
  return error instanceof RouteAccessTransportError;
}

export function shouldHydrateLiveRouteInputs(input: {
  previousActiveRoutePlanId: string | null;
  replacedAssignment: boolean;
  restoredRoutePlanId: string;
  resetProgress: boolean;
}): boolean {
  return input.resetProgress || input.replacedAssignment || input.previousActiveRoutePlanId !== input.restoredRoutePlanId;
}
