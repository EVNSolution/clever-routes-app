import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as recovery from './liveRouteCacheRecovery';
import type { ContinuousLocationStreamService } from '../domain/location/continuousLocationStream';

const idleStream: ContinuousLocationStreamService = {
  getBackgroundAvailability: async () => true,
  getBackgroundPermission: async () => 'granted',
  requestBackgroundPermission: async () => 'granted',
  hasStartedLocationUpdates: async () => false,
  startLocationUpdates: async () => undefined,
  stopLocationUpdates: async () => undefined,
};

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

function reconnectEffect(): string {
  const start = source.lastIndexOf('useEffect(() => {', source.indexOf('const previous = previousRouteSyncNetworkRef.current;'));
  const end = source.indexOf('\n\n  useEffect', start);
  return source.slice(start, end);
}

function cachedTrackingBranch(): string {
  const restore = source.indexOf('await loadRouteAccessWithLiveCacheRecovery({');
  const start = source.indexOf('if (recovered.cached !== null) {', restore);
  const bodyStart = source.indexOf('{', start);
  let depth = 1;
  let end = bodyStart + 1;
  while (depth > 0) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
    end += 1;
  }
  return source.slice(start, end);
}

function runtimeCallback(name: string, context: Record<string, unknown>): (...args: unknown[]) => Promise<unknown> {
  const start = source.indexOf('async (', source.indexOf(`const ${name} = useCallback`));
  const bodyStart = source.indexOf('=> {', start) + 3;
  let depth = 1;
  let end = bodyStart + 1;
  while (depth > 0) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
    end += 1;
  }
  const compiled = transpileModule(`const callback = ${source.slice(start, end)}; callback;`, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  return runInNewContext(compiled.outputText, context) as (...args: unknown[]) => Promise<unknown>;
}

describe('reviewed cached route recovery boundaries', () => {
  it('keeps cached polling deferred after capture finishes on arrivalCheck, then refreshes once after Back', async () => {
    let refreshCount = 0;
    const cached = { accountOwnerHash: 'owner', assignmentGeneration: '2', routePlanId: 'route' };
    const context = {
      runtimeConfig: { mode: 'live' }, isInitialRouteRestoreComplete: true,
      isLoggingIn: false, isRefreshingRoutes: false, isStartingRoute: false,
      isCapturingPhoto: false, isPhotoActionSheetVisible: false, isCompletingStop: false, isRecordingArrival: false, isFinishingRoute: false,
      networkReachability: 'online', activeRoutePlanId: 'route', routeStartRecoveryState: 'idle',
      liveRoutePollRunningRef: { current: false }, liveRouteApplyRunningRef: { current: false },
      driverSyncBoundAccountOwnerHashRef: { current: 'owner' }, driverSyncAccountEpochRef: { current: 1 },
      cachedLiveRouteValidationRef: { current: cached as typeof cached | null }, lastCachedLiveRouteRefreshAtRef: { current: 0 },
      screenRef: { current: 'arrivalCheck' }, routeRefreshUiProtectedRef: { current: true },
      isNavigationInterruptionProtected: true,
      liveRouteSessionsRef: { current: [{ route: { id: 'route' }, routeAccess: { routePlanId: 'route', assignmentGeneration: '2' } }] },
      AppState: { currentState: 'active' }, ...recovery,
      isRouteRefreshUiAllowed: () => !context.routeRefreshUiProtectedRef.current,
      handleRefreshRoutes: async () => { refreshCount += 1; context.cachedLiveRouteValidationRef.current = null; return true; },
      createExpoLiveRouteChangeStore: async () => ({}), shouldCheckLiveRouteChange: () => false,
    };
    const poll = runtimeCallback('pollLiveRouteChanges', context);
    await poll();
    assert.equal(refreshCount, 0, 'finished capture remains protected while arrivalCheck is open');
    context.screenRef.current = 'routeSession'; context.routeRefreshUiProtectedRef.current = false;
    context.isNavigationInterruptionProtected = false;
    await poll();
    assert.equal(refreshCount, 1);
    context.liveRouteSessionsRef.current = [];
    await poll();
    assert.equal(refreshCount, 1);
  });

  for (const protectedAt of ['entry', 'saved access', 'account access']) {
    it(`rejects a stale refresh callback when UI protection changes at ${protectedAt}`, async () => {
      let protectedUi = protectedAt === 'entry';
      let hydrationCount = 0;
      let releaseCount = 0;
      const context = {
        verifiedDriverPhoneE164: '+15195550101', isRefreshingRoutes: false, isLoggingIn: false,
        isRouteRefreshUiAllowed: () => !protectedUi,
        routeProgressRefreshGuardRef: { current: { beginRefresh: () => () => { releaseCount += 1; } } },
        setMessage: () => undefined, setIsRefreshingRoutes: () => undefined,
        driverAccessTokenStore: { loadActiveDriverAccess: async () => { if (protectedAt === 'saved access') protectedUi = true; return { kind: 'active' }; } },
        getActiveAccountAccess: async () => { if (protectedAt === 'account access') protectedUi = true; return {}; },
        handleLoginAndLoadRoutes: async () => { hydrationCount += 1; },
        pendingRouteSyncReconnectRef: { current: false }, cachedLiveRouteValidationRef: { current: {} },
      };
      const refresh = runtimeCallback('handleRefreshRoutes', context);
      assert.equal(await refresh(), false);
      assert.equal(hydrationCount, 0);
      assert.equal(releaseCount, protectedAt === 'entry' ? 0 : 1);
    });
  }

  it('does not project an in-flight lookup after protected UI opens and still releases login state', async () => {
    let protectedUi = false;
    let loggingIn = false;
    let routeSyncState = 'error';
    let projected = 0;
    let releaseLookup!: () => void;
    let signalLookup!: () => void;
    const lookupStarted = new Promise<void>(resolve => { signalLookup = resolve; });
    const lookupWait = new Promise<void>(resolve => { releaseLookup = resolve; });
    const queue = { getAccountOwnerHash: () => 'owner' };
    const context = {
      driverSyncBoundAccountOwnerHashRef: { current: 'owner' },
      driverSyncLifecycleAbortControllerRef: { current: new AbortController() }, driverSyncRouteAbortControllerRef: { current: new AbortController() },
      driverSyncHeartbeatSchedulerRef: { current: null }, completionClearRetrySchedulerRef: { current: null }, driverSyncAccountEpochRef: { current: 1 },
      setDriverSyncHealth: () => undefined, setIsLoggingIn: (value: boolean) => { loggingIn = value; },
      routeSyncState, setRouteSyncState: (value: string) => { routeSyncState = value; }, setRouteRecoveryCode: () => undefined,
      setMessage: () => undefined, setVerifiedDriverPhoneE164: () => undefined,
      bindExpoOfflineSubmissionQueueAccount: async () => queue, liveRouteOwnerRef: { current: 'owner' },
      setOfflineSubmissionQueue: () => undefined, syncOfflineQueueState: () => undefined,
      offlineSubmissionQueue: queue, setIsInitialRouteRestoreComplete: () => undefined,
      createExpoLiveRouteChangeStore: () => undefined,
      loadRouteAccessWithLiveCacheRecovery: async () => { signalLookup(); await lookupWait; return { cached: null, lookupResult: { kind: 'denied', status: 'NOT_FOUND' } }; },
      isRouteRefreshUiAllowed: () => !protectedUi,
      setSubmission: () => { projected += 1; }, formatRouteAccessProblem: () => 'unused', setScreen: () => undefined,
      driverAccessTokenStore: { clearCachedRouteAccess: async () => undefined },
      pendingRouteSyncReconnectRef: { current: false }, AbortController,
    };
    const load = runtimeCallback('handleLoginAndLoadRoutes', context);
    const pending = load({}, '+15195550101', { resetProgress: false, navigateOnSuccess: false, isUiHydrationAllowed: context.isRouteRefreshUiAllowed });
    await lookupStarted;
    protectedUi = true; releaseLookup();
    assert.equal(await pending, false);
    assert.equal(projected, 0);
    assert.equal(loggingIn, false, 'UI interruption must not leave login or refresh stuck');
    assert.equal(routeSyncState, 'error', 'interrupted hydration must not remain loading');
    assert.equal(context.pendingRouteSyncReconnectRef.current, true);
  });

  it('returns rejected hydration through the common refresh and releases its progress guard', async () => {
    let refreshing = false;
    let releaseCount = 0;
    const refresh = runtimeCallback('handleRefreshRoutes', {
      verifiedDriverPhoneE164: '+15195550101', isRefreshingRoutes: false, isLoggingIn: false,
      isRouteRefreshUiAllowed: () => true,
      routeProgressRefreshGuardRef: { current: { beginRefresh: () => () => { releaseCount += 1; } } },
      setMessage: () => undefined, setIsRefreshingRoutes: (value: boolean) => { refreshing = value; },
      driverAccessTokenStore: { loadActiveDriverAccess: async () => ({ kind: 'active' }) },
      getActiveAccountAccess: async () => ({}), handleLoginAndLoadRoutes: async () => false,
    });
    assert.equal(await refresh(), false);
    assert.equal(refreshing, false);
    assert.equal(releaseCount, 1);
  });

  it('does not hydrate photo inputs when protection opens during the saved active-session read', async () => {
    let protectedUi = false;
    let photoHydration = 0;
    const active = { routePlanId: 'route', startedAt: 'original-session', navigationStepIndex: 2 };
    const start = source.indexOf('if (effectivePersistedActiveRouteSession !== null) {', source.indexOf("routeLoadStage = 'LR05';"));
    const end = source.indexOf('if (hasDurablePickupEvidence && activeRouteSession !== null)', start);
    const compiled = transpileModule(`(async () => { let activeRouteSession = null; ${source.slice(start, end)} })();`, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    });
    await runInNewContext(compiled.outputText, {
      effectivePersistedActiveRouteSession: active,
      driverAccessTokenStore: { loadActiveDriverAccess: async () => { protectedUi = true; return { kind: 'active', activeRouteSession: active }; } },
      isLoginAccountCurrent: () => !protectedUi,
      restoredActiveSession: { route: { id: 'route', stops: [], etaSnapshot: {} }, routeAccess: { assignmentGeneration: '2' }, companyGuidance: {} },
      liveRouteStateKey: () => 'key', liveRouteStatesRef: { current: { key: { appliedRoute: {}, uiDraft: { currentStopId: null, proofPhotoResults: {} } } } },
      liveRouteBasesRef: { current: {} }, getLiveRouteRecoveryProgress: () => ({ completedStopIds: [], navigationStepIndex: 2 }),
      setServerConfirmedStopIds: () => undefined, queue: {}, getPickupCompletionQueueState: () => 'none',
      resolveRouteStartRefreshRecovery: () => 'idle', COMPANY_STEP_INDEX: 0, setRouteStartRecoveryState: () => undefined,
      shouldHydrateLiveRouteInputs: () => true, shouldResetProgress: false, replacedAssignment: false, activeRoutePlanId: 'route',
      liveRouteInputRef: { current: {} }, getActiveRouteStepAfterRefresh: () => 2, clampRouteNavigationStepIndex: () => 2,
      setProofDrafts: () => undefined, setProofPhotoResults: () => { photoHydration += 1; }, setProofMediaResults: () => undefined,
      setSelectedStopDetailsId: () => undefined, setCompletedStopIds: () => undefined,
    });
    assert.equal(photoHydration, 0, 'a late session read must not reset an open proof form');
  });

  for (const protectedAction of ['camera', 'photo selection', 'capture processing']) {
    it(`defers reconnect hydration during ${protectedAction}, then refreshes once`, async () => {
      let refreshCount = 0;
      const context = {
        useEffect: (effect: () => void) => effect(),
        previousRouteSyncNetworkRef: { current: 'offline' },
        pendingRouteSyncReconnectRef: { current: false },
        driverSyncAccountEpochRef: { current: 1 },
        isDriverRestoreComplete: true,
        routeSyncState: 'error',
        verifiedDriverPhoneE164: '+15195550101',
        networkReachability: 'online',
        screen: protectedAction === 'camera' ? 'proofCamera' : 'mainTabs',
        isPhotoActionSheetVisible: protectedAction === 'photo selection',
        isCapturingPhoto: protectedAction === 'capture processing',
        isCompletingStop: false, isRecordingArrival: false, isStartingRoute: false, isFinishingRoute: false, isApplyingLiveRoute: false,
        isLoggingIn: false,
        isRefreshingRoutes: false,
        routeProgressGuardIdleRevision: 0,
        handleRefreshRoutes: async () => { refreshCount += 1; return true; },
      };
      const protection = source.slice(source.indexOf('const isNavigationInterruptionProtected ='), source.indexOf(';', source.indexOf('const isNavigationInterruptionProtected =')) + 1);
      const render = () => runInNewContext(`(() => { ${protection} ${reconnectEffect()} })()`, context);
      render();
      await Promise.resolve();
      assert.equal(refreshCount, 0, 'route lookup/hydration must wait until the protected action closes');
      context.screen = 'mainTabs'; context.isPhotoActionSheetVisible = false; context.isCapturingPhoto = false;
      render();
      await Promise.resolve();
      assert.equal(refreshCount, 1, 'the online transition must remain pending while the action is open');
      render();
      await Promise.resolve();
      assert.equal(refreshCount, 1, 'an unrelated rerender must not repeat the reconnect refresh');
    });
  }

  it('actually pauses a running cached GPS task without clearing its active session or queued evidence', async () => {
    let running = true;
    let stopCount = 0;
    const active = { routePlanId: 'route', status: 'active', startedAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', navigationStepIndex: 2 };
    const cachedSession = { route: { id: 'route' }, routeAccess: { routePlanId: 'route', assignmentGeneration: '2', driverContractVersion: 2 } };
    const pendingGps = [{ clientEventId: 'original-gps', assignmentGeneration: '2' }];
    const context = {
      cachedActiveSession: cachedSession,
      restoredActiveSession: cachedSession,
      persistedActiveRouteSession: active,
      cachedLiveRouteValidationRef: { current: null },
      accountOwnerHash: 'owner',
      recovered: { cached: { session: cachedSession, state: {} } },
      publishLiveRouteState: () => undefined,
      liveRouteBasesRef: { current: {} },
      liveRouteStateKey: () => 'route:2',
      isLoginAccountCurrent: () => true,
      CONTINUOUS_LOCATION_TASK_NAME: 'clever-routes-continuous-location',
      driverAccessTokenStore: { loadActiveDriverAccess: async () => ({ kind: 'active', routeAccess: cachedSession.routeAccess, activeRouteSession: active }) },
      continuousLocationStreamService: {
        hasStartedLocationUpdates: async () => running,
        stopLocationUpdatesIfCurrent: async (_task: string, isCurrent: () => Promise<boolean>) => {
          if (!(await isCurrent())) return false;
          stopCount += 1; running = false; return true;
        },
      },
      ...recovery,
      setContinuousLocationResult: () => undefined,
      setMessage: () => undefined,
    };
    await runInNewContext(`(async () => { ${cachedTrackingBranch()} })()`, context);
    assert.equal(stopCount, 1, 'cached fallback must stop the native task, not only its screen state');
    assert.equal(running, false);
    assert.equal(active.status, 'active');
    assert.deepEqual(pendingGps, [{ clientEventId: 'original-gps', assignmentGeneration: '2' }]);
  });

  for (const changed of ['owner', 'route', 'assignment', 'session', 'completion'] as const) {
    it(`does not stop a task whose ${changed} changed before the serialized native operation`, async () => {
      let stopCount = 0;
      const active = { routePlanId: 'route', status: 'active' as const, startedAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', navigationStepIndex: 2 };
      const session = { route: { id: 'route' }, routeAccess: { routePlanId: 'route', assignmentGeneration: '2', driverContractVersion: 2 } } as recovery.CachedLiveRouteSession;
      const persisted = { kind: 'active' as const, routeAccess: session.routeAccess, activeRouteSession: { ...active } };
      if (changed === 'route') persisted.activeRouteSession.routePlanId = 'other-route';
      if (changed === 'assignment') persisted.routeAccess = { ...session.routeAccess, assignmentGeneration: '3' };
      if (changed === 'session') persisted.activeRouteSession.startedAt = '2026-10-08T01:00:00Z';
      if (changed === 'completion') Object.assign(persisted.activeRouteSession, { status: 'completion_pending' });
      const result = await recovery.pauseCachedLiveRouteTracking({
        activeRouteSession: active, session, isCurrent: () => changed !== 'owner',
        driverAccessTokenStore: { loadActiveDriverAccess: async () => persisted as Awaited<ReturnType<import('../domain/driver/driverAccessTokenStore').DriverAccessTokenStore['loadActiveDriverAccess']>> },
        streamService: {
          ...idleStream,
          stopLocationUpdatesIfCurrent: async (_task, isCurrent) => {
            if (!(await isCurrent())) return false;
            stopCount += 1; return true;
          },
        },
      });
      assert.equal(stopCount, 0);
      assert.equal(result.kind, 'unchanged');
    });
  }

  it('keeps a failed native stop unresolved without clearing the durable active session', async () => {
    const active = { routePlanId: 'route', status: 'active' as const, startedAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', navigationStepIndex: 2 };
    const session = { route: { id: 'route' }, routeAccess: { routePlanId: 'route', assignmentGeneration: '2', driverContractVersion: 2 } } as recovery.CachedLiveRouteSession;
    const persisted = { kind: 'active' as const, routeAccess: session.routeAccess, activeRouteSession: active };
    await assert.rejects(recovery.pauseCachedLiveRouteTracking({
      activeRouteSession: active, session, isCurrent: () => true,
      driverAccessTokenStore: { loadActiveDriverAccess: async () => persisted as Awaited<ReturnType<import('../domain/driver/driverAccessTokenStore').DriverAccessTokenStore['loadActiveDriverAccess']>> },
      streamService: {
        ...idleStream,
        stopLocationUpdatesIfCurrent: async () => true,
        hasStartedLocationUpdates: async () => true,
      },
    }), /could not be paused/u);
    assert.equal(active.status, 'active');
  });
});
