import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getFunctionSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('background location lifecycle wiring', () => {
  it('persists the active route before starting native tracking and recording route start', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const startSource = getFunctionSource(
      source,
      'async function startRouteSessionAfterConfirmed(',
      'function handleOpenRouteSession(',
    );

    const persistIndex = startSource.indexOf('saveActiveRouteSession');
    const foregroundPermissionIndex = startSource.indexOf('startDeliveryWithForegroundPermission');
    const notificationPermissionIndex = startSource.indexOf('registerForStopArrivalNotifications');
    const backgroundPermissionIndex = startSource.indexOf('requestContinuousLocationBackgroundPermission');
    const trackingIndex = startSource.indexOf('startContinuousLocationUpdatesAfterDeliveryStart');
    const routeStartedIndex = startSource.indexOf('recordRouteStartedAfterDeliveryStart');

    assert.ok(foregroundPermissionIndex < notificationPermissionIndex);
    assert.ok(notificationPermissionIndex < backgroundPermissionIndex);
    assert.ok(backgroundPermissionIndex < persistIndex);
    assert.ok(persistIndex < trackingIndex);
    assert.ok(trackingIndex < routeStartedIndex);
    assert.match(startSource, /startedAt: routeStartedAt\.toISOString\(\)/u);
    assert.match(startSource, /markActiveRouteStarted/u);
    assert.equal((startSource.match(/registerForStopArrivalNotifications\(\)/gu) ?? []).length, 1);
  });

  it('refreshes background permission on My Routes and after returning from system settings', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const permissionHandler = getFunctionSource(
      source,
      'const requestBackgroundLocationPermissionAfterDisclosure = useCallback(',
      'const handleOpenBackgroundLocationSettings = useCallback(',
    );
    const appStateSource = getFunctionSource(
      source,
      "AppState.addEventListener('change'",
      'return () => subscription.remove()',
    );

    assert.match(permissionHandler, /requestForegroundPermission\(\)/u);
    assert.match(permissionHandler, /foregroundPermission\.status !== 'granted'[\s\S]*Linking\.openSettings\(\)/u);
    assert.match(permissionHandler, /requestContinuousLocationBackgroundPermission/u);
    assert.match(permissionHandler, /await refreshBackgroundLocationPermission\(\)/u);
    assert.match(
      permissionHandler,
      /result\.reason === 'background_permission_denied'[\s\S]*await Linking\.openSettings\(\)/u,
    );
    assert.match(appStateSource, /state === 'active'[\s\S]*refreshBackgroundLocationPermission/u);
    assert.match(appStateSource, /state === 'active'[\s\S]*!isStartingRoute[\s\S]*screen === 'mainTabs'[\s\S]*handleRefreshRoutes/u);
    assert.match(source, /isDriverRestoreComplete && screen === 'mainTabs'[\s\S]*refreshBackgroundLocationPermission/u);
  });

  it('shows the Play background-location disclosure immediately before the OS permission request', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const permissionFlow = getFunctionSource(
      source,
      'const requestBackgroundLocationPermissionAfterDisclosure = useCallback(',
      'const clearAndStopActiveLocationSession = useCallback(',
    );

    assert.match(
      permissionFlow,
      /CLEVER Routes collects precise location data to update delivery progress during an active route, even when the app is closed or not in use\./u,
    );
    assert.match(permissionFlow, /text: 'Privacy Policy'/u);
    assert.match(permissionFlow, /Linking\.openURL\(ROUTES_APP_PRIVACY_URL\)/u);
    assert.doesNotMatch(permissionFlow, /live route progress and arrival records/u);
    assert.match(permissionFlow, /text: 'Not Now'/u);
    assert.match(permissionFlow, /text: 'Continue'/u);
    assert.match(permissionFlow, /onPress: requestBackgroundLocationPermissionAfterDisclosure/u);
    assert.match(
      permissionFlow,
      /requestBackgroundLocationPermissionAfterDisclosure[\s\S]*requestContinuousLocationBackgroundPermission/u,
    );
  });

  it('preserves the server-active route while native tracking restoration is deferred or blocked', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const loadSource = getFunctionSource(
      source,
      'const handleLoginAndLoadRoutes = useCallback(',
      'const handleRefreshRoutes = useCallback(',
    );
    const restoreSource = getFunctionSource(
      loadSource,
      'if (restoredActiveSession !== null) {',
      '\n      if (shouldNavigateOnSuccess) {',
    );

    assert.match(restoreSource, /setActiveRoutePlanId\(restoredActiveSession\.route\.id\)/u);
    assert.match(restoreSource, /AppState\.currentState !== 'active'[\s\S]*return/u);
    assert.match(restoreSource, /startContinuousLocationUpdatesAfterDeliveryStart/u);
    assert.match(restoreSource, /continuousResult\.kind === 'blocked'[\s\S]*server route remains active/u);
    assert.match(restoreSource, /catch \(error\)[\s\S]*server route remains active/u);
    assert.doesNotMatch(restoreSource, /clearAndStopActiveLocationSession/u);
    assert.doesNotMatch(restoreSource, /setDeliveryStartResult\(null\)/u);
    assert.match(loadSource, /if \(activeRouteWasRemoved\) \{[\s\S]*clearAndStopActiveLocationSession/u);
    assert.doesNotMatch(loadSource, /if \(selectedRouteWasRemoved \|\| activeRouteWasRemoved\)/u);
  });

  it('does not delete a persisted active route from a partial server refresh', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const loadSource = getFunctionSource(
      source,
      'const handleLoginAndLoadRoutes = useCallback(',
      'const handleRefreshRoutes = useCallback(',
    );

    const unresolvedIndex = loadSource.indexOf('const activeRouteLoadIsUnresolved');
    const removedIndex = loadSource.indexOf('const activeRouteWasRemoved');
    const clearRemovedIndex = loadSource.indexOf('if (activeRouteWasRemoved)');

    assert.ok(unresolvedIndex < removedIndex);
    assert.ok(removedIndex < clearRemovedIndex);
    assert.match(
      loadSource,
      /activeRouteLoadIsUnresolved = effectivePersistedActiveRouteSession !== null[\s\S]*restoredActiveSession === null[\s\S]*routeLoadFailed/u,
    );
    assert.match(
      loadSource,
      /if \(activeRouteLoadIsUnresolved\) \{[\s\S]*server state was kept[\s\S]*return/u,
    );
  });

  it('uses one terminal cleanup path for logout, assignment loss, and expired auth', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const noRouteSource = getFunctionSource(
      source,
      'const openVerifiedNoAssignedRoute = useCallback(',
      'const handleLoginAndLoadRoutes = useCallback(',
    );
    const logoutSource = getFunctionSource(
      source,
      'async function handleLogout()',
      'const handleAppBack = useCallback(',
    );

    assert.match(noRouteSource, /await clearAndStopActiveLocationSession\(\)/u);
    assert.match(logoutSource, /await clearAndStopActiveLocationSession\(\)/u);
    assert.match(source, /failure\.kind === 'server_401'[\s\S]*await clearAndStopActiveLocationSession\(\)/u);
  });

  it('delegates the active-session guard to the durable route finish flow', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const finishSource = getFunctionSource(
      source,
      'async function finishRoute(',
      'async function handleManualFinishRoute(',
    );

    assert.match(finishSource, /deactivateActiveRouteSession: async \(completion\) => \{[\s\S]*markActiveRouteCompletionPending/u);
    assert.match(finishSource, /finishResult\.kind === 'recorded'[\s\S]*clearActiveRouteSession\(route\.id\)/u);
    assert.match(finishSource, /finishResult\.monitoringMode === 'stopped'/u);
    assert.doesNotMatch(finishSource, /catch \(error\) \{[\s\S]*clearAndStopActiveLocationSession\(route\.id\)/u);
    assert.match(source, /const isStartDisabled = isStartingRoute \|\| isFinishingRoute \|\| isSwitchingRoute/u);
    assert.doesNotMatch(source, /const isStartDisabled = [^\n]*activeRoutePlanId !== null/u);
  });

  it('shares the durable queue and retries each route with its own access token', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const retrySource = getFunctionSource(
      source,
      'const retryOfflineSubmissionsForSessions = useCallback(',
      'const selectedRouteSession =',
    );

    assert.match(retrySource, /getExpoOfflineSubmissionQueue\(\)/u);
    assert.match(retrySource, /for \(const session of sessions\)/u);
    assert.match(retrySource, /routePlanId: session\.route\.id/u);
  });

  it('retries pending route submissions after confirmed network recovery', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const recoverySource = getFunctionSource(
      source,
      'const retryPendingSubmissionsAfterNetworkRecovery = useCallback(',
      'useEffect(() => {\n    const previous = previousRouteSyncNetworkRef.current;',
    );

    assert.match(source, /Network\.useNetworkState\(\)/u);
    assert.match(source, /shouldRetryOfflineSubmissionsAfterNetworkChange\(\{/u);
    assert.match(recoverySource, /return retryOfflineSubmissionsForSessions\(routeSessions\)/u);
    assert.match(source, /AppState\.addEventListener\('change', \(state\) => scheduler\.notifyConditionsChanged\(\{[\s\S]*immediate: state === 'active',[\s\S]*\}\)\)/u);
    assert.match(source, /requiresRouteReconciliation/u);
    assert.match(source, /setRouteRecoveryRefreshReason\('route_not_in_progress'\)/u);
    assert.match(source, /Route ended or released on server/u);
    assert.doesNotMatch(recoverySource, /setInterval|setTimeout/u);
  });

  it('does not overwrite the active route token while retrying another route', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const refreshSource = getFunctionSource(
      source,
      'const refreshRouteAccessTupleForSubmission = useCallback(',
      'const refreshRouteAccessLookupForSubmission = useCallback(',
    );

    assert.match(refreshSource, /clearCachedRouteAccess\(routePlanId\)/u);
    assert.match(refreshSource, /await driverAccessTokenStore\.saveFromInvitedRouteAccess/u);
    assert.match(source, /activeRoutePlanId !== null && activeRoutePlanId !== routeSession\.route\.id/u);
    assert.match(source, /visibleRouteSessions\.map\(\(session, routeIndex\) =>/u);
    assert.doesNotMatch(source, /Previous Route|Next Route/u);
  });

  it('surfaces storage degradation, gates mutations and replay, and retries verified recovery only under safe conditions', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const retrySource = getFunctionSource(
      source,
      'const retryOfflineSubmissionsForSessions = useCallback(',
      'const selectedRouteSession =',
    );
    const recoverySource = getFunctionSource(
      source,
      'const recoverOfflineEvidenceStorage = useCallback(',
      'useEffect(() => {\n    const previous = previousRouteSyncNetworkRef.current;',
    );

    assert.match(source, /setOfflineStorageState\(queue\.storageState\(\)\)/u);
    assert.match(source, /const waitForOfflineQueuePersistence = useCallback\([\s\S]*persistOfflineQueueAndSyncState\(queue, syncOfflineQueueState\)/u);
    assert.match(retrySource, /queue\.storageState\(\) === 'STORAGE_DEGRADED'[\s\S]*return false/u);
    assert.match(retrySource, /await waitForOfflineQueuePersistence\(queue\)/u);
    assert.match(recoverySource, /await queue\.recoverStorage\(\)[\s\S]*syncOfflineQueueState\(queue\)/u);
    assert.match(source, /offlineStorageState !== 'STORAGE_DEGRADED'/u);
    assert.match(source, /isForeground: \(\) => AppState\.currentState === 'active'/u);
    assert.match(source, /isOnline: \(\) => networkReachability === 'online'/u);
    assert.match(source, /retry: recoverOfflineEvidenceStorage/u);
    assert.match(source, /hasPendingSubmissions: \(\) => offlineStorageState === 'STORAGE_DEGRADED'/u);
    assert.match(source, /finally \{[\s\S]*syncOfflineQueueState\(queueForStateSync\)/u);
    assert.match(source, /Retry Storage/u);
    assert.match(source, /Delivery updates are read-only until encrypted storage is safely persisted/u);
    assert.match(source, /if \(blockMutationWhileStorageDegraded\(\)\) return/u);
    assert.match(source, /offlineStorageState === 'STORAGE_DEGRADED'[\s\S]*disabled=\{isStartDisabled\}/u);
  });
});
