import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('driver operations resilience runtime', () => {
  it('runs heartbeat independently while online and foreground and surfaces lease state', () => {
    assert.match(source, /createDriverSyncHeartbeatScheduler\([\s\S]*hasActiveSession:[\s\S]*isForeground: \(\) => AppState\.currentState === 'active'[\s\S]*isOnline: \(\) => networkReachability === 'online'/u);
    assert.match(source, /createDriverSyncTakeoverApiClient[\s\S]*accountAccessToken:[\s\S]*onDriverSyncTakeover/u);
  });

  it('surfaces six independent operational values and keeps completion pending visible', () => {
    assert.match(source, /alert:[\s\S]*device:[\s\S]*gps:[\s\S]*route:[\s\S]*server:[\s\S]*sync:/u);
    assert.match(source, /hasDurablePendingRouteEnd \|\| input\.deliveryFinishResult\?\.kind === 'queued'[\s\S]*'Completion pending'/u);
    assert.match(source, /formatGpsOperationalPill\(input\.gpsOperationalState\)/u);
  });

  it('recovers a durable completion receipt before deciding whether to clear restored monitoring', () => {
    const receiptRecoveryIndex = source.indexOf('await recoverPendingRouteEndReceipt({');
    const targetedClearIndex = source.indexOf('await clearAndStopActiveLocationSession(persistedActiveRouteSession.routePlanId)', receiptRecoveryIndex);
    const retryIndex = source.indexOf('await retryOfflineSubmissionsForSessions([pendingSession])');
    const pendingProjectionIndex = source.indexOf('const loadedSessionsWithPendingEnds', retryIndex);
    const removalIndex = source.indexOf('const activeRouteWasRemoved', pendingProjectionIndex);
    assert.ok(receiptRecoveryIndex > 0 && receiptRecoveryIndex < targetedClearIndex);
    assert.ok(retryIndex > 0 && retryIndex < pendingProjectionIndex && pendingProjectionIndex < removalIndex);
    assert.match(source, /setDurableCompletionPendingRoutePlanId[\s\S]*pendingRouteEnd\?\.kind === 'driver_event'/u);
    assert.match(source, /Route completion is still pending server confirmation. Reduced monitoring remains active/u);
    assert.match(source, /activeRouteSession\.status === 'completion_pending' \|\| session\.pendingRouteEnd === undefined/u);
    assert.match(source, /completionResolvedDuringRestore \? null : persistedActiveRouteSession/u);
  });

  it('records native GPS accuracy rather than treating proximity as safe without metadata', () => {
    const platformSource = readFileSync(new URL('../platform/expo/location/expoContinuousLocationStreamService.ts', import.meta.url), 'utf8');
    assert.match(platformSource, /accuracyMeters: location\.coords\.accuracy/u);
  });
});
