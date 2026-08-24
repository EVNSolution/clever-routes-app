import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const pillModelSource = readFileSync(new URL('../ui/components/operationalPillModel.ts', import.meta.url), 'utf8');

describe('driver operations resilience runtime', () => {
  it('runs heartbeat independently while online and foreground and surfaces lease state', () => {
    assert.match(source, /createDriverSyncHeartbeatScheduler\([\s\S]*hasActiveSession:[\s\S]*isForeground: \(\) => AppState\.currentState === 'active'[\s\S]*isOnline: \(\) => networkReachability === 'online'/u);
    assert.match(source, /createDriverSyncTakeoverApiClient[\s\S]*accountAccessToken:[\s\S]*onDriverSyncTakeover/u);
  });

  it('surfaces independent operational values including progress gap and keeps completion pending visible', () => {
    assert.match(pillModelSource, /alert:[\s\S]*device:[\s\S]*gap:[\s\S]*gps:[\s\S]*route:[\s\S]*server:[\s\S]*sync:/u);
    assert.match(pillModelSource, /hasDurablePendingRouteEnd \|\| input\.completionQueued[\s\S]*'Completion pending'/u);
    assert.match(source, /buildDriverOperationalPillValues\(\{[\s\S]*currentStopSequence: currentStop\?\.sequence \?\? null,[\s\S]*routeProgress/u);
  });

  it('recovers a durable completion receipt before deciding whether to clear restored monitoring', () => {
    const receiptRecoveryIndex = source.indexOf('await restoreCompletionPendingBeforeRouteHydration({');
    const hydrationIndex = source.indexOf('await submitAccountRouteAccess(accountAccess)', receiptRecoveryIndex);
    const retryIndex = source.indexOf('await retryOfflineSubmissionsForSessions([pendingSession])');
    const pendingProjectionIndex = source.indexOf('const loadedSessionsWithPendingEnds', retryIndex);
    const removalIndex = source.indexOf('const activeRouteWasRemoved', pendingProjectionIndex);
    assert.ok(receiptRecoveryIndex > 0 && receiptRecoveryIndex < hydrationIndex);
    assert.ok(retryIndex > 0 && retryIndex < pendingProjectionIndex && pendingProjectionIndex < removalIndex);
    assert.match(source, /setDurableCompletionPendingRoutePlanId[\s\S]*pendingRouteEnd\?\.kind === 'driver_event'/u);
    assert.match(source, /Route completion is still pending server confirmation. Reduced monitoring remains active/u);
    assert.match(source, /activeRouteSession\.status === 'completion_pending' \|\| session\.pendingRouteEnd === undefined/u);
    assert.match(source, /completionResolvedDuringRestore \? null : persistedActiveRouteSession/u);
  });

  it('projects completion heartbeat state only from durable queue evidence and emits transition heartbeats', () => {
    assert.match(source, /projectDriverSyncQueueState\(telemetryQueue, activeRoutePlanId\)/u);
    assert.match(source, /\.\.\.queueProjection/u);
    assert.doesNotMatch(source, /finishPending: routeSession === undefined/u);
    assert.match(source, /requestImmediateDriverSyncHeartbeat/u);
  });

  it('sends cold-restart APPLIED acknowledgement telemetry before clearing the active session', () => {
    const receiptRestoreIndex = source.indexOf('await restoreCompletionPendingBeforeRouteHydration({');
    const onResolvedIndex = source.indexOf('onResolved: async (routePlanId, resolution)', receiptRestoreIndex);
    const heartbeatIndex = source.indexOf('await sendCompletionAcknowledgedHeartbeatBeforeCleanup({', onResolvedIndex);
    const clearIndex = source.indexOf('await clearAndStopActiveLocationSession(routePlanId);', onResolvedIndex);
    assert.ok(receiptRestoreIndex > 0 && onResolvedIndex > receiptRestoreIndex);
    assert.ok(heartbeatIndex > onResolvedIndex && heartbeatIndex < clearIndex);
    assert.match(source.slice(onResolvedIndex, clearIndex), /resolution === 'acknowledged'/u);
    assert.match(source, /pendingImmediateDriverSyncHeartbeatRef\.current/u);
  });

  it('orders both online acknowledgement paths before active-session cleanup', () => {
    const replayAckIndex = source.indexOf('result.completionAcknowledgedRoutePlanIds?.includes(session.route.id)');
    const replayHeartbeatIndex = source.indexOf('await sendCompletionAcknowledgedHeartbeatBeforeCleanup({', replayAckIndex);
    const replayClearIndex = source.indexOf('await clearAndStopActiveLocationSession(session.route.id);', replayAckIndex);
    assert.ok(replayAckIndex > 0 && replayHeartbeatIndex > replayAckIndex && replayHeartbeatIndex < replayClearIndex);

    const receiptAckIndex = source.indexOf("if (recovery === 'acknowledged')");
    const receiptHeartbeatIndex = source.indexOf('await sendCompletionAcknowledgedHeartbeatBeforeCleanup({', receiptAckIndex);
    const receiptClearIndex = source.indexOf('await clearAndStopActiveLocationSession(routePlanId);', receiptAckIndex);
    assert.ok(receiptAckIndex > 0 && receiptHeartbeatIndex > receiptAckIndex && receiptHeartbeatIndex < receiptClearIndex);
  });

  it('invalidates account-scoped sync health before logout side effects', () => {
    const logoutIndex = source.indexOf('async function handleLogout()');
    const epochIndex = source.indexOf('driverSyncAccountEpochRef.current += 1;', logoutIndex);
    const clearHealthIndex = source.indexOf('setDriverSyncHealth(null);', logoutIndex);
    const locationCleanupIndex = source.indexOf('await clearAndStopActiveLocationSession();', logoutIndex);
    assert.ok(logoutIndex > 0 && epochIndex > logoutIndex);
    assert.ok(clearHealthIndex > epochIndex && clearHealthIndex < locationCleanupIndex);
  });

  it('does not destroy cached completion identity when ACK-clear token refresh cannot find the ended route', () => {
    assert.match(source, /options\?\.preserveMissingRoute === true\) return null;/u);
    const completionRefreshCalls = source.match(
      /refreshRouteAccessLookupForSubmission\([^)]*, \{ preserveMissingRoute: true \}\)/gu,
    ) ?? [];
    assert.ok(completionRefreshCalls.length >= 4);
  });

  it('records native GPS accuracy rather than treating proximity as safe without metadata', () => {
    const platformSource = readFileSync(new URL('../platform/expo/location/expoContinuousLocationStreamService.ts', import.meta.url), 'utf8');
    assert.match(platformSource, /accuracyMeters: location\.coords\.accuracy/u);
  });
});
