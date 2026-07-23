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
      'function handleOpenRoutePreview(',
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
    assert.equal((source.match(/registerForStopArrivalNotifications\(\)/gu) ?? []).length, 1);
  });

  it('refreshes background permission on My Routes and after returning from system settings', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const settingsHandler = getFunctionSource(
      source,
      'const handleOpenBackgroundLocationSettings = useCallback(',
      'const clearAndStopActiveLocationSession = useCallback(',
    );
    const appStateSource = getFunctionSource(
      source,
      "AppState.addEventListener('change'",
      'return () => subscription.remove()',
    );

    assert.match(settingsHandler, /requestForegroundPermission\(\)/u);
    assert.match(settingsHandler, /foregroundPermission\.status !== 'granted'[\s\S]*Linking\.openSettings\(\)/u);
    assert.match(settingsHandler, /requestContinuousLocationBackgroundPermission/u);
    assert.match(settingsHandler, /await refreshBackgroundLocationPermission\(\)/u);
    assert.match(appStateSource, /state === 'active'[\s\S]*refreshBackgroundLocationPermission/u);
    assert.match(source, /isDriverRestoreComplete && screen === 'mainTabs'[\s\S]*refreshBackgroundLocationPermission/u);
  });

  it('reconciles native tracking when restoring an active route', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const loadSource = getFunctionSource(
      source,
      'const handleLoginAndLoadRoutes = useCallback(',
      'const handleRefreshRoutes = useCallback(',
    );

    assert.match(loadSource, /if \(restoredActiveSession !== null\)[\s\S]*startContinuousLocationUpdatesAfterDeliveryStart/u);
    assert.match(loadSource, /continuousResult\.kind === 'blocked'[\s\S]*clearAndStopActiveLocationSession/u);
    assert.match(loadSource, /if \(activeRouteWasRemoved\) \{[\s\S]*clearAndStopActiveLocationSession/u);
    assert.doesNotMatch(loadSource, /if \(selectedRouteWasRemoved \|\| activeRouteWasRemoved\)/u);
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

  it('marks the route inactive before waiting for native stop and route completion', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const finishSource = getFunctionSource(
      source,
      'async function finishRoute(',
      'async function handleManualFinishRoute(',
    );

    const clearIndex = finishSource.indexOf('clearActiveRouteSession(route.id)');
    const finishIndex = finishSource.indexOf('finishDeliveryAfterActive');

    assert.ok(clearIndex < finishIndex);
    assert.match(finishSource, /catch \(error\) \{[\s\S]*clearAndStopActiveLocationSession\(route\.id\)/u);
    assert.match(source, /const isStartDisabled = isStartingRoute \|\| isFinishingRoute \|\| activeRoutePlanId !== null/u);
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
    assert.match(recoverySource, /await retryOfflineSubmissionsForSessions\(routeSessions\)/u);
    assert.match(source, /requiresRouteReconciliation/u);
    assert.match(source, /setRouteRecoveryRefreshReason\('route_not_in_progress'\)/u);
    assert.match(source, /Route ended or released on server/u);
    assert.doesNotMatch(recoverySource, /setInterval|setTimeout/u);
  });

  it('does not overwrite the active route token while retrying another route', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const refreshSource = getFunctionSource(
      source,
      'const refreshRouteAccessLookupForSubmission = useCallback(',
      'const refreshDriverAccessForSubmission = useCallback(',
    );

    assert.match(refreshSource, /clearCachedRouteAccess\(routePlanId\)/u);
    assert.match(refreshSource, /await driverAccessTokenStore\.saveFromInvitedRouteAccess/u);
    assert.match(source, /activeRoutePlanId !== null && activeRoutePlanId !== routeSession\.route\.id/u);
    assert.match(source, /visibleRouteSessions\.map\(\(session\) =>/u);
    assert.doesNotMatch(source, /Previous Route|Next Route/u);
  });
});
