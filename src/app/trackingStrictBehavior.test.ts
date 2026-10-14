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

  it('stops the service quietly when the app is open and a server-ended route is reported', () => {
    const observer = appRoot.slice(appRoot.indexOf('registerContinuousLocationTaskObserver(async (locations, taskResult) => {'));
    const ended = observer.slice(0, observer.indexOf('syncOfflineQueueState(offlineSubmissionQueue);'));
    assert.match(ended, /taskResult\.reason !== 'pre_start_ended'[\s\S]*stopLocationUpdates\(CONTINUOUS_LOCATION_TASK_NAME\)/u);
    assert.doesNotMatch(ended, /showOperationalDialog|Confirm/u);
    assert.doesNotMatch(ended, /Live location tracking stopped/u);
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

  it('blocks Start while battery optimization is on and opens the battery settings at once', () => {
    const start = appRoot.slice(appRoot.indexOf('function handleStartRoute(routeId?: string) {'), appRoot.indexOf('function startRouteAfterBatteryCheck('));
    assert.match(start, /readBatteryOptimizationEnabled\(\)[\s\S]*shouldBlockStartForBattery\(\{ optimizationEnabled, platform: Platform\.OS \}\)/u);
    assert.match(start, /setMessage\(getBatteryGateCopy\(selectedDriverLocale\)\.message\);\s*await openBatteryOptimizationSettings\(\);\s*return;/u);
    assert.match(start, /startRouteAfterBatteryCheck\(routeId\)/u);
  });

  it('shows the battery line in Settings only while optimization is on, and no popup', () => {
    assert.match(appRoot, /batteryOptimizationEnabled === true \? \([\s\S]*onPress=\{onOpenBatterySettings\}/u);
    assert.doesNotMatch(appRoot, /batteryGuidanceStore|getBatteryGuidanceCopy|getBatterySettingsCopy|Keep tracking on/u);
  });
});
