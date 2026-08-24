import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('notification action behavior', () => {
  it('waits for active-route restoration before handling a cold-start arrival action', () => {
    const actionSource = appRootSource.slice(
      appRootSource.indexOf('const handleStopArrivalNotificationPress'),
      appRootSource.indexOf('useEffect(() => {\n    let isMounted = true;', appRootSource.indexOf('const handleStopArrivalNotificationPress')),
    );
    assert.match(actionSource, /!isInitialRouteRestoreComplete \|\| routeSyncState !== 'ready'/u);

    const routeLoadSource = appRootSource.slice(
      appRootSource.indexOf('const handleLoginAndLoadRoutes'),
      appRootSource.indexOf('const handleRefreshRoutes'),
    );
    const restoreFinallySource = routeLoadSource.slice(routeLoadSource.lastIndexOf('finally {'));
    assert.match(restoreFinallySource, /syncOfflineQueueState\(currentQueue\)/u);
    assert.ok(
      restoreFinallySource.indexOf('setIsLoggingIn(false)')
        < restoreFinallySource.indexOf('setIsInitialRouteRestoreComplete(true)'),
    );
  });

  it('does not route near-stop popup taps through the foreground action handler', () => {
    assert.doesNotMatch(appRootSource, /addStopArrivalResponseListener/u);
    assert.doesNotMatch(appRootSource, /getLastStopArrivalResponse/u);
  });

  it('does not refresh or route notification targets before the full route restore is ready', () => {
    const targetEffectSource = appRootSource.slice(
      appRootSource.indexOf('pendingActiveRouteNotificationTarget === null'),
      appRootSource.indexOf('const submitStopArrivalForRouteStop'),
    );
    const appStateSource = appRootSource.slice(
      appRootSource.indexOf("AppState.addEventListener('change'", appRootSource.indexOf('const previousActiveRoutePlanIdRef')),
      appRootSource.indexOf('return () => subscription.remove()', appRootSource.indexOf("AppState.addEventListener('change'", appRootSource.indexOf('const previousActiveRoutePlanIdRef'))),
    );

    assert.match(targetEffectSource, /!isInitialRouteRestoreComplete/u);
    assert.match(targetEffectSource, /routeSyncState !== 'ready'/u);
    assert.match(appStateSource, /isInitialRouteRestoreComplete/u);
  });

  it('does not let a background route refresh replace an opened notification action screen', () => {
    const routeLoadSource = appRootSource.slice(
      appRootSource.indexOf('const handleLoginAndLoadRoutes'),
      appRootSource.indexOf('const handleRefreshRoutes'),
    );
    const restoredSessionSource = routeLoadSource.slice(
      routeLoadSource.indexOf('if (restoredActiveSession !== null)'),
      routeLoadSource.indexOf('if (AppState.currentState', routeLoadSource.indexOf('if (restoredActiveSession !== null)')),
    );

    assert.match(
      restoredSessionSource,
      /if \(shouldNavigateOnSuccess\) \{\s+setScreen\('mainTabs'\);\s+\}/u,
    );
  });

  it('does not present successful routine refresh as a session restore error', () => {
    assert.doesNotMatch(appRootSource, /Active route session restored\./u);
  });

  it('routes foreground-service action links into the arrival action handler', () => {
    const linkSource = appRootSource.slice(
      appRootSource.indexOf('const handleUrl = (url: string | null)'),
      appRootSource.indexOf('void Linking.getInitialURL()', appRootSource.indexOf('const handleUrl = (url: string | null)')),
    );

    assert.match(linkSource, /target\.action !== undefined/u);
    assert.match(linkSource, /setPendingStopArrivalNotification/u);
    assert.match(linkSource, /type: STOP_ARRIVAL_NOTIFICATION_TYPE/u);
    assert.match(linkSource, /setPendingStopArrivalNotification\(\(current\) => current \?\? response\)/u);
    assert.match(linkSource, /isRecordingArrivalRef\.current/u);
  });

  it('keeps foreground actions independent from near-stop popup state', () => {
    const foregroundNotificationBuildCount = appRootSource.match(/buildActiveRouteForegroundNotification\(\{/gu)?.length ?? 0;
    const notifiedStopInputCount = appRootSource.match(
      /notifiedStopIds: notifiedStopArrivalIdsRef\.current/gu,
    )?.length ?? 0;

    assert.equal(foregroundNotificationBuildCount, 5);
    assert.equal(notifiedStopInputCount, 0);
    assert.doesNotMatch(appRootSource, /showStopActions:/u);
  });

  it('runs Next Stop through the durable completion path before opening navigation', () => {
    assert.match(appRootSource, /action === 'next_stop'/u);
    assert.match(appRootSource, /setPendingStopArrivalCompletion\(\{[\s\S]*deliveryStopId: stop\.deliveryStopId,[\s\S]*routePlanId: routeSession\.route\.id/u);
    assert.match(appRootSource, /handleTerminalStop\(currentStop, 'delivered', \{ openNextNavigation: true \}\)/u);
    assert.match(appRootSource, /completedStopIds: nextCompletedStopIds,[\s\S]*navigationStepIndex: nextNavigationStepIndex/u);
    assert.match(appRootSource, /activeRouteSession\?\.completedStopIds/u);

    const completionSource = appRootSource.slice(
      appRootSource.indexOf('async function handleTerminalStop'),
      appRootSource.indexOf('completeStopFromNotificationRef.current = async'),
    );
    const saveIndex = completionSource.indexOf('saveActiveRouteSession');
    const notificationIndex = completionSource.indexOf('updateLocationNotification');
    const navigationIndex = completionSource.indexOf('await handleOpenNavigationForStop(nextStop)');

    assert.ok(saveIndex >= 0);
    assert.ok(notificationIndex > saveIndex);
    assert.ok(navigationIndex > notificationIndex);
  });

  it('runs Arrive, Add Proof, and Next Stop through one GPS-backed arrival executor', () => {
    const arrivalStart = appRootSource.indexOf('const recordStopArrival = useCallback(');
    const arrivalEnd = appRootSource.indexOf('\n\n  const handleStopArrivalNotificationPress', arrivalStart);
    const arrivalSource = appRootSource.slice(arrivalStart, arrivalEnd);
    const handlerStart = arrivalEnd;
    const handlerEnd = appRootSource.indexOf('\n\n  useEffect(() => {', handlerStart);
    const handlerSource = appRootSource.slice(handlerStart, handlerEnd);

    assert.notEqual(arrivalStart, -1);
    assert.notEqual(arrivalEnd, -1);
    assert.match(arrivalSource, /isRecordingArrivalRef\.current = true/u);
    assert.match(arrivalSource, /foregroundLocationSnapshotService\.getCurrentForegroundLocation\(\)/u);
    assert.match(arrivalSource, /getStopArrivalProximityEvidence\(\{/u);
    assert.match(arrivalSource, /submitStopArrivalForRouteStop\(routeSession, stop, arrivalEvidence\)/u);
    assert.match(arrivalSource, /action === 'next_stop'/u);
    assert.match(arrivalSource, /setScreen\('arrivalCheck'\)/u);
    assert.match(handlerSource, /recordStopArrival\(stop, 'routeSession', requestScreen, action, routeSession\)/u);
    assert.doesNotMatch(handlerSource, /submitStopArrivalForRouteStop/u);
    assert.match(appRootSource, /await recordStopArrival\(currentStop, 'routeSession'\)/u);
  });

  it('renders truthful Near, Far, and unavailable proof distance states', () => {
    const arrivalCheckSource = appRootSource.slice(
      appRootSource.indexOf('function ArrivalCheckScreen('),
      appRootSource.indexOf('\n\nfunction CompletedDeliveriesScreen('),
    );

    assert.match(arrivalCheckSource, /Arrival distance unavailable/u);
    assert.match(arrivalCheckSource, /You’re near the destination/u);
    assert.match(arrivalCheckSource, /You’re far from the destination/u);
    assert.match(arrivalCheckSource, /distanceMeters: proximity\.distanceMeters/u);
  });

  it('defers route-update refresh and navigation while proof work is protected', () => {
    const routeNotificationEffect = appRootSource.slice(
      appRootSource.indexOf('const receiveRouteNotification'),
      appRootSource.indexOf('const retryPendingSubmissionsAfterNetworkRecovery'),
    );

    assert.match(routeNotificationEffect, /refreshRequired: true/u);
    assert.match(routeNotificationEffect, /\|\| isNavigationInterruptionProtected/u);
    assert.match(routeNotificationEffect, /pendingDriverRouteNotification\.refreshRequired/u);
  });
});
