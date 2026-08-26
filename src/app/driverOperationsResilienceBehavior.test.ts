import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const pillModelSource = readFileSync(new URL('../ui/components/operationalPillModel.ts', import.meta.url), 'utf8');

describe('driver operations resilience runtime', () => {
  it('runs heartbeat independently without rendering unsolicited operational pills', () => {
    assert.match(source, /createDriverSyncHeartbeatScheduler\([\s\S]*hasActiveSession:[\s\S]*isForeground: \(\) => AppState\.currentState === 'active'[\s\S]*isOnline: \(\) => networkReachability === 'online'/u);
    assert.doesNotMatch(source, /<OperationalPills/u);
    assert.match(source, /createDriverSyncTakeoverApiClient[\s\S]*const handleDriverSyncTakeover[\s\S]*\.takeover\(/u);
    assert.match(source, /driverSyncHealth\?\.conflict === true[\s\S]*label="Use This Device"[\s\S]*handleDriverSyncTakeover/u);
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
    const clearIndex = source.indexOf('await clearAndStopActiveLocationSession(routePlanId, {', onResolvedIndex);
    assert.ok(receiptRestoreIndex > 0 && onResolvedIndex > receiptRestoreIndex);
    assert.ok(heartbeatIndex > onResolvedIndex && heartbeatIndex < clearIndex);
    assert.match(source.slice(onResolvedIndex, clearIndex), /resolution === 'acknowledged'/u);
    assert.match(source, /pendingImmediateDriverSyncHeartbeatRef\.current/u);
  });

  it('orders both online acknowledgement paths before active-session cleanup', () => {
    const replayAckIndex = source.indexOf('result.completionAcknowledgedRoutePlanIds?.includes(session.route.id)');
    const replayHeartbeatIndex = source.indexOf('await sendCompletionAcknowledgedHeartbeatBeforeCleanup({', replayAckIndex);
    const replayClearIndex = source.indexOf('await clearAndStopActiveLocationSession(session.route.id, {', replayAckIndex);
    assert.ok(replayAckIndex > 0 && replayHeartbeatIndex > replayAckIndex && replayHeartbeatIndex < replayClearIndex);

    const receiptAckIndex = source.indexOf("if (recovery === 'acknowledged')");
    const receiptHeartbeatIndex = source.indexOf('await sendCompletionAcknowledgedHeartbeatBeforeCleanup({', receiptAckIndex);
    const receiptClearIndex = source.indexOf('await clearAndStopActiveLocationSession(routePlanId, {', receiptAckIndex);
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

  it('binds ordinary retry and receipt recovery effects to the captured account epoch', () => {
    const ordinaryRetryIndex = source.indexOf('const retryOfflineSubmissionsForSessions = useCallback');
    const ordinarySignalIndex = source.indexOf('const lifecycleSignal = driverSyncLifecycleAbortControllerRef.current.signal;', ordinaryRetryIndex);
    const ordinaryOwnerIndex = source.indexOf('const accountOwnerHash = queue.getAccountOwnerHash();', ordinarySignalIndex);
    const ordinaryDomainGuardIndex = source.indexOf('isCurrent,', ordinaryOwnerIndex);
    const ordinaryCleanupGuardIndex = source.indexOf('if (!isCurrent()) return false;', ordinaryDomainGuardIndex);
    const ordinaryCleanupIndex = source.indexOf('await clearAndStopActiveLocationSession(session.route.id, {', ordinaryCleanupGuardIndex);
    assert.ok(ordinaryRetryIndex > 0 && ordinarySignalIndex > ordinaryRetryIndex);
    assert.ok(ordinaryOwnerIndex > ordinarySignalIndex && ordinaryDomainGuardIndex > ordinaryOwnerIndex);
    assert.ok(ordinaryCleanupGuardIndex > ordinaryDomainGuardIndex && ordinaryCleanupIndex > ordinaryCleanupGuardIndex);
    assert.match(source.slice(ordinaryRetryIndex, ordinaryCleanupIndex), /persistAccess: false, persistAccountAccess: false,/u);
    assert.match(source.slice(ordinaryRetryIndex, ordinaryCleanupIndex), /preserveMissingRoute: true, projectRuntimeState: false,/u);
    assert.match(source.slice(ordinaryRetryIndex, ordinaryCleanupIndex), /persistRefreshedAccess: false/u);

    const receiptRetryIndex = source.indexOf('const retryCompletionPendingReceipt = useCallback');
    const receiptEpochIndex = source.indexOf('const requestEpoch = driverSyncAccountEpochRef.current;', receiptRetryIndex);
    const receiptDomainGuardIndex = source.indexOf('isCurrent,', receiptEpochIndex);
    const receiptCleanupGuardIndex = source.indexOf('if (!isCurrent()) return false;', receiptDomainGuardIndex);
    const receiptCleanupIndex = source.indexOf('await clearAndStopActiveLocationSession(routePlanId, {', receiptCleanupGuardIndex);
    assert.ok(receiptRetryIndex > 0 && receiptEpochIndex > receiptRetryIndex);
    assert.ok(receiptDomainGuardIndex > receiptEpochIndex && receiptCleanupGuardIndex > receiptDomainGuardIndex);
    assert.ok(receiptCleanupIndex > receiptCleanupGuardIndex);
    assert.match(source.slice(receiptRetryIndex, receiptCleanupIndex), /persistRefreshedAccess: false/u);
    const cleanupHelperIndex = source.indexOf('const clearAndStopActiveLocationSession = useCallback');
    const durableLeaseIndex = source.indexOf('await driverAccessTokenStore.loadActiveDriverAccess();', cleanupHelperIndex);
    const cleanupDomainIndex = source.indexOf('clearAndStopContinuousLocationSession({', durableLeaseIndex);
    assert.ok(durableLeaseIndex > cleanupHelperIndex && cleanupDomainIndex > durableLeaseIndex);
    assert.match(source.slice(durableLeaseIndex, cleanupDomainIndex), /persisted\.routeAccess\.assignmentGeneration === lease\.assignmentGeneration/u);
    assert.match(source.slice(durableLeaseIndex, cleanupDomainIndex), /persistedSessionInstanceId === lease\.sessionInstanceId/u);
    assert.match(source.slice(cleanupHelperIndex, source.indexOf('const selectedPhoneCountry', cleanupHelperIndex)), /sessionInstanceId: lease\.sessionInstanceId/u);
  });

  it('does not invalidate durable route-end recovery when the active route epoch changes', () => {
    const routeEpochStart = source.indexOf('useEffect(() => {\n    if (driverSyncRouteEpochRef.current === activeDriverSyncRouteEpoch) return;');
    const routeEpochEnd = source.indexOf('\n  }, [activeDriverSyncRouteEpoch]);', routeEpochStart);
    const routeEpochSource = source.slice(routeEpochStart, routeEpochEnd);
    assert.ok(routeEpochStart > 0 && routeEpochEnd > routeEpochStart);
    assert.match(routeEpochSource, /driverSyncRouteAbortControllerRef\.current\.abort\(\)/u);
    assert.doesNotMatch(routeEpochSource, /driverSyncAccountEpochRef\.current \+= 1/u);

    const retryStart = source.indexOf('const retryOfflineSubmissionsForSessions = useCallback');
    const retryEnd = source.indexOf('\n  const usesSelectedRouteContext', retryStart);
    const retrySource = source.slice(retryStart, retryEnd);
    assert.match(retrySource, /const lifecycleSignal = driverSyncLifecycleAbortControllerRef\.current\.signal/u);
    assert.doesNotMatch(retrySource, /driverSyncRouteAbortControllerRef\.current\.signal/u);

    const receiptStart = source.indexOf('const retryCompletionPendingReceipt = useCallback');
    const receiptEnd = source.indexOf('\n  useEffect(() => {', receiptStart);
    const receiptSource = source.slice(receiptStart, receiptEnd);
    assert.match(receiptSource, /const lifecycleSignal = driverSyncLifecycleAbortControllerRef\.current\.signal/u);
    assert.doesNotMatch(receiptSource, /driverSyncRouteAbortControllerRef\.current\.signal/u);

    const finishStart = source.indexOf('async function finishRoute(');
    const finishEnd = source.indexOf('\n  async function handleManualFinishRoute', finishStart);
    assert.match(source.slice(finishStart, finishEnd), /driverSyncRouteAbortControllerRef\.current\.signal/u);
  });

  it('does not destroy cached completion identity when ACK-clear token refresh cannot find the ended route', () => {
    assert.match(source, /options\?\.preserveMissingRoute === true\) return null;/u);
    const completionRefreshCalls = source.match(/preserveMissingRoute: true/gu) ?? [];
    assert.ok(completionRefreshCalls.length >= 4);
    assert.ok((source.match(/persistAccess: false/gu) ?? []).length >= 6);
    assert.ok((source.match(/persistAccountAccess: false/gu) ?? []).length >= 6);
    assert.ok((source.match(/projectRuntimeState: false/gu) ?? []).length >= 6);
    assert.match(source, /isCurrent: \(\) => !signal\.aborted && isLoginAccountCurrent\(\)/u);
    assert.match(source, /isCurrent: \(\) => !signal\.aborted && isFinishCurrent\(\)/u);
  });

  it('prefers per-route session tokens and does not let one overwritten SecureStore route block another outbox route', () => {
    const flushIndex = source.indexOf('const flushCompletionClearOutbox');
    const sessionAccessIndex = source.indexOf('for (const session of routeSessions)', flushIndex);
    const persistedAccessIndex = source.indexOf("persistedAccess.kind === 'active'", sessionAccessIndex);
    const noOverwriteIndex = source.indexOf('!accessByAssignment.has(persistedKey)', persistedAccessIndex);
    const fairFlushIndex = source.indexOf('flushDriverCompletionClearOutboxEntries({', noOverwriteIndex);
    assert.ok(flushIndex > 0 && sessionAccessIndex > flushIndex);
    assert.ok(persistedAccessIndex > sessionAccessIndex && noOverwriteIndex > persistedAccessIndex);
    assert.ok(fairFlushIndex > noOverwriteIndex);
  });

  it('aborts lifecycle work before logout and prevents cleanup from relatching an immediate request', () => {
    const logoutIndex = source.indexOf('async function handleLogout()');
    const abortIndex = source.indexOf('driverSyncLifecycleAbortControllerRef.current.abort();', logoutIndex);
    const stopIndex = source.indexOf('driverSyncHeartbeatSchedulerRef.current?.stop();', logoutIndex);
    const clearRetryStopIndex = source.indexOf('completionClearRetrySchedulerRef.current?.stop();', logoutIndex);
    const clearLatchIndex = source.indexOf('pendingImmediateDriverSyncHeartbeatRef.current = false;', logoutIndex);
    assert.ok(abortIndex > logoutIndex && stopIndex > abortIndex);
    assert.ok(clearRetryStopIndex > stopIndex && clearLatchIndex > clearRetryStopIndex);
    assert.match(source, /scheduler\.stop\(\{ carryImmediate: true \}\)/u);
  });

  it('rearms account transport only after encrypted queue binding succeeds', () => {
    const loginIndex = source.indexOf('const handleLoginAndLoadRoutes = useCallback');
    const abortIndex = source.indexOf('driverSyncLifecycleAbortControllerRef.current.abort();', loginIndex);
    const bindIndex = source.indexOf('await bindExpoOfflineSubmissionQueueAccount(phoneE164);', abortIndex);
    const ownerBindIndex = source.indexOf(
      'driverSyncBoundAccountOwnerHashRef.current = accountOwnerHash;', bindIndex,
    );
    const rearmIndex = source.indexOf(
      'driverSyncLifecycleAbortControllerRef.current = new AbortController();', bindIndex,
    );
    assert.ok(loginIndex > 0 && abortIndex > loginIndex && bindIndex > abortIndex);
    assert.ok(ownerBindIndex > bindIndex && rearmIndex > ownerBindIndex);
    assert.match(source, /driverSyncBoundAccountOwnerHashRef\.current === accountOwnerHash/u);
  });

  it('aborts periodic and completion-clear transport when assignment generation changes', () => {
    const epochIndex = source.indexOf('const activeDriverSyncRouteEpoch =');
    const routeAbortIndex = source.indexOf('driverSyncRouteAbortControllerRef.current.abort();', epochIndex);
    const periodicStopIndex = source.indexOf('driverSyncHeartbeatSchedulerRef.current?.stop();', routeAbortIndex);
    const clearStopIndex = source.indexOf('completionClearRetrySchedulerRef.current?.stop();', periodicStopIndex);
    assert.ok(epochIndex > 0 && routeAbortIndex > epochIndex);
    assert.ok(periodicStopIndex > routeAbortIndex && clearStopIndex > periodicStopIndex);
    assert.match(source, /session\.routeAccess\.assignmentGeneration/u);
  });

  it('records native GPS accuracy rather than treating proximity as safe without metadata', () => {
    const platformSource = readFileSync(new URL('../platform/expo/location/expoContinuousLocationStreamService.ts', import.meta.url), 'utf8');
    assert.match(platformSource, /accuracyMeters: location\.coords\.accuracy/u);
  });
});
