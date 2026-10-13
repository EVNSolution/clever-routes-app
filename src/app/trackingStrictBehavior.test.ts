import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = readFileSync(join(here, 'AppRoot.tsx'), 'utf8');
const stream = readFileSync(join(here, '..', 'platform', 'expo', 'location', 'expoContinuousLocationStreamService.ts'), 'utf8');

describe('tracking stays on after Start until the driver finishes', () => {
  it('lets the native task keep the service when the server ended or revoked the route', () => {
    assert.match(stream, /decideServiceAfterTaskResult\(\{[\s\S]*serverEndedAt: serverEndedTrackingAt/u);
    assert.match(stream, /keepDecision\.action === 'stop_if_inactive'[\s\S]*stopContinuousLocationTaskIfInactive/u);
    assert.match(stream, /The office ended this route\. Open CLEVER Routes and confirm to stop tracking\./u);
    assert.match(stream, /serverEndedTrackingAt = null;\s*if \(await Location\.hasStartedLocationUpdatesAsync\(taskName\)\)/u);
  });

  it('stops tracking only after the driver confirms a server-ended route', () => {
    const observer = appRoot.slice(appRoot.indexOf('registerContinuousLocationTaskObserver(async (locations, taskResult) => {'));
    assert.match(observer, /taskResult\.reason !== 'pre_start_ended'[\s\S]*showOperationalDialog\([\s\S]*cancelable: false/u);
    assert.match(observer, /text: 'Confirm'[\s\S]*onPress[\s\S]*stopLocationUpdates\(CONTINUOUS_LOCATION_TASK_NAME\)/u);
    assert.doesNotMatch(observer.slice(0, observer.indexOf('syncOfflineQueueState(offlineSubmissionQueue);')), /Live location tracking stopped/u);
  });

  it('restarts a stopped location task of an active route and posts its notification again', () => {
    const watchdog = appRoot.slice(appRoot.indexOf('const trackingWatchdogRunningRef'));
    assert.match(watchdog, /routeStatus !== 'active' \|\| deliveryStartResult\?\.kind !== 'delivery_active'/u);
    assert.match(watchdog, /hasStartedLocationUpdates\(CONTINUOUS_LOCATION_TASK_NAME\)/u);
    assert.match(watchdog, /startContinuousLocationUpdatesAfterDeliveryStart\(\{[\s\S]*deliveryStart,/u);
    assert.match(watchdog, /updateLocationNotification\?\.\(/u);
    assert.match(watchdog, /emitDriverDiagnosticObservation\(\{[\s\S]*reasonCode: 'LOCATION_TASK_NOT_STARTED'[\s\S]*stage: 'LOCATION'[\s\S]*startContinuousLocationUpdatesAfterDeliveryStart/u);
    assert.match(watchdog, /AppState\.addEventListener\('change'[\s\S]*state === 'active'/u);
    assert.match(watchdog, /TRACKING_WATCHDOG_INTERVAL_MS/u);
    assert.match(appRoot, /const TRACKING_WATCHDOG_INTERVAL_MS = 60_000/u);
  });

  it('shows the battery guidance once on Android after Start', () => {
    const guidance = appRoot.slice(appRoot.indexOf('batteryGuidanceStore.isShown()'));
    assert.match(guidance, /Platform\.OS !== 'android'|Platform\.OS === 'android'/u);
    assert.match(guidance, /markShown\(\)/u);
    assert.match(guidance, /Linking\.openSettings\(\)/u);
    assert.match(appRoot, /getBatteryGuidanceCopy\(selectedDriverLocale\)/u);
  });
});
