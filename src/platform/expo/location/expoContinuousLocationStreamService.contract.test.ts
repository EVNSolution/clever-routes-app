import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const locationServicePath = join(currentDirectory, 'expoContinuousLocationStreamService.ts');
const foregroundLocationSnapshotServicePath = join(currentDirectory, 'expoForegroundLocationSnapshotService.ts');
const locationTypesPath = join(currentDirectory, '..', '..', '..', '..', 'node_modules', 'expo-location', 'src', 'Location.types.ts');
const locationTaskServicePath = join(currentDirectory, '..', '..', '..', '..', 'node_modules', 'expo-location', 'android', 'src', 'main', 'java', 'expo', 'modules', 'location', 'services', 'LocationTaskService.kt');
const locationArgumentsPath = join(currentDirectory, '..', '..', '..', '..', 'node_modules', 'expo-location', 'android', 'src', 'main', 'java', 'expo', 'modules', 'location', 'records', 'LocationArguments.kt');
const locationModuleConfigPath = join(currentDirectory, '..', '..', '..', '..', 'node_modules', 'expo-location', 'expo-module.config.json');
const patchScriptPath = join(currentDirectory, '..', '..', '..', '..', 'scripts', 'patch-expo-location-notification.mjs');
const mainActivityPath = join(currentDirectory, '..', '..', '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'evnsolution', 'clever', 'routes', 'MainActivity.kt');
const compactActionLayoutPath = join(currentDirectory, '..', '..', '..', '..', 'android', 'app', 'src', 'main', 'res', 'layout', 'clever_route_notification_actions.xml');
const resourceKeepPath = join(currentDirectory, '..', '..', '..', '..', 'android', 'app', 'src', 'main', 'res', 'raw', 'keep.xml');
const queueStoragePath = join(currentDirectory, '..', 'storage', 'expoOfflineSubmissionQueueStorage.ts');
const secureStorePath = join(currentDirectory, '..', 'secureStore', 'expoSecureDriverAccessTokenStore.ts');
const stopArrivalNotificationServicePath = join(currentDirectory, '..', 'notifications', 'expoStopArrivalNotificationService.ts');
const appRootPath = join(currentDirectory, '..', '..', '..', 'app', 'AppRoot.tsx');

describe('Expo continuous location wiring', () => {
  it('binds the global TaskManager executor to persisted task processing', () => {
    const source = readFileSync(locationServicePath, 'utf8');

    assert.match(source, /processContinuousLocationTaskBatch/u);
    assert.match(source, /getExpoOfflineSubmissionQueue/u);
    assert.match(source, /stopContinuousLocationTaskIfInactive/u);
    assert.match(source, /activeTaskExecutions/u);
    assert.match(source, /ensureLocationUpdatesStarted/u);
    assert.doesNotMatch(source, /let continuousLocationTaskHandler/u);
    assert.doesNotMatch(source, /registerContinuousLocationTaskHandler/u);
  });

  it('requests ten-second high-accuracy updates without a movement threshold', () => {
    const source = readFileSync(locationServicePath, 'utf8');

    assert.match(source, /accuracy: Location\.Accuracy\.High/u);
    assert.match(source, /deferredUpdatesDistance: 0/u);
    assert.match(source, /deferredUpdatesInterval: 10_000/u);
    assert.match(source, /distanceInterval: 0/u);
    assert.match(source, /timeInterval: 10_000/u);
    assert.match(source, /Location\.getBackgroundPermissionsAsync\(\)/u);
    assert.match(source, /Location\.requestBackgroundPermissionsAsync\(\)/u);
    assert.match(source, /catch \{[\s\S]*return 'denied'/u);
    assert.match(source, /const alreadyStarted = await Location\.hasStartedLocationUpdatesAsync\(taskName\);[\s\S]*await startExpoLocationUpdates\(taskName, notification\);[\s\S]*return \{ alreadyStarted \}/u);
    assert.match(source, /notificationBody: notification\.body/u);
    assert.match(source, /notificationTitle: notification\.title/u);
    assert.match(source, /updateLocationTaskNotificationAsync/u);
    const notificationUpdateStart = source.indexOf('updateLocationNotification:');
    const notificationUpdateSource = source.slice(
      notificationUpdateStart,
      source.indexOf('\n    }),', notificationUpdateStart),
    );
    assert.doesNotMatch(notificationUpdateSource, /startExpoLocationUpdates/u);
    assert.doesNotMatch(notificationUpdateSource, /The active Android location notification service was not found/u);
    assert.doesNotMatch(source, /Active delivery tracking|tracking active delivery location/u);
  });

  it('bounds the arrival-time foreground GPS snapshot to five seconds', () => {
    const source = readFileSync(foregroundLocationSnapshotServicePath, 'utf8');

    assert.match(source, /FOREGROUND_LOCATION_SNAPSHOT_TIMEOUT_MS = 5_000/u);
    assert.match(source, /Promise\.race/u);
    assert.match(source, /clearTimeout\(timeoutId\)/u);
  });

  it('patches Expo Location with expanded text and a stop-details content intent', () => {
    const argumentsSource = readFileSync(locationArgumentsPath, 'utf8');
    const compactActionLayoutSource = readFileSync(compactActionLayoutPath, 'utf8');
    const moduleConfigSource = readFileSync(locationModuleConfigPath, 'utf8');
    const mainActivitySource = readFileSync(mainActivityPath, 'utf8');
    const patchSource = readFileSync(patchScriptPath, 'utf8');
    const resourceKeepSource = readFileSync(resourceKeepPath, 'utf8');
    const serviceSource = readFileSync(locationTaskServicePath, 'utf8');
    const stopArrivalNotificationSource = readFileSync(stopArrivalNotificationServicePath, 'utf8');
    const typesSource = readFileSync(locationTypesPath, 'utf8');

    assert.match(typesSource, /notificationBigText\?: string/u);
    assert.match(typesSource, /notificationUrl\?: string/u);
    assert.match(argumentsSource, /@Field var notificationBigText: String\? = null/u);
    assert.match(argumentsSource, /@Field var notificationUrl: String\? = null/u);
    assert.match(serviceSource, /Notification\.BigTextStyle\(\)\.bigText\(emphasizeNotificationLabels\(it\)\)/u);
    assert.match(serviceSource, /StyleSpan\(Typeface\.BOLD\)/u);
    assert.match(serviceSource, /val firstLineEnd = text\.indexOf\('\\n'\)/u);
    assert.match(serviceSource, /listOf\("Status", "Total", "Customer note", "Items"\)/u);
    assert.match(serviceSource, /it\.action = Intent\.ACTION_VIEW/u);
    assert.match(serviceSource, /it\.data = Uri\.parse\(url\)/u);
    assert.match(serviceSource, /it\.addCategory\(Intent\.CATEGORY_BROWSABLE\)/u);
    assert.match(serviceSource, /val requestCode = notificationUrl\?\.hashCode\(\) \?: 0/u);
    assert.match(serviceSource, /getQueryParameter\("showStopActions"\) == "true"/u);
    assert.match(serviceSource, /appendQueryParameter\("action", action\)/u);
    assert.match(serviceSource, /builder\.addAction\(0, title, actionIntent\)/u);
    assert.match(serviceSource, /addStopAction\("Add Proof", "add_proof"\)/u);
    assert.match(serviceSource, /addStopAction\("Next Stop", "next_stop"\)/u);
    assert.match(serviceSource, /RemoteViews\(mParentContext\.packageName, compactLayoutId\)/u);
    assert.match(serviceSource, /builder\.setCustomContentView\(compactView\)/u);
    assert.match(serviceSource, /Configuration\.UI_MODE_NIGHT_MASK/u);
    assert.match(serviceSource, /compactView\.setTextColor\(addProofViewId, compactTextColor\)/u);
    assert.match(serviceSource, /compactView\.setTextColor\(nextStopViewId, compactTextColor\)/u);
    assert.match(compactActionLayoutSource, /<LinearLayout[^>]*android:layout_height="40dp"/u);
    assert.match(compactActionLayoutSource, /android:id="@\+id\/notification_add_proof"[\s\S]*android:singleLine="true"/u);
    assert.match(compactActionLayoutSource, /android:id="@\+id\/notification_next_stop"[\s\S]*android:singleLine="true"/u);
    assert.match(resourceKeepSource, /tools:keep="@layout\/clever_route_notification_actions"/u);
    assert.match(serviceSource, /fun updateNotification\(taskName: String, serviceOptions: Bundle\): Boolean/u);
    assert.match(serviceSource, /sActiveServices\[taskName\]\?\.updateForeground/u);
    assert.match(serviceSource, /\.setOngoing\(true\)/u);
    assert.match(serviceSource, /\.setOnlyAlertOnce\(true\)/u);
    assert.match(serviceSource, /\.setVisibility\(Notification\.VISIBILITY_PRIVATE\)/u);
    assert.match(serviceSource, /\.setPublicVersion\(publicNotification\)/u);
    assert.match(serviceSource, /\.setContentTitle\("CLEVER Routes"\)/u);
    assert.match(serviceSource, /\.setContentText\("Active route in progress"\)/u);
    assert.match(serviceSource, /channel\.lockscreenVisibility = Notification\.VISIBILITY_PRIVATE/u);
    assert.match(patchSource, /updateLocationTaskNotificationAsync/u);
    assert.match(patchSource, /\.setOngoing\(true\)/u);
    assert.match(patchSource, /\.setContentTitle\("CLEVER Routes"\)/u);
    assert.match(patchSource, /\.setVisibility\(Notification\.VISIBILITY_PRIVATE\)/u);
    assert.match(patchSource, /addStopAction\("Add Proof", "add_proof"\)/u);
    assert.match(patchSource, /addStopAction\("Next Stop", "next_stop"\)/u);
    assert.match(patchSource, /builder\.setCustomContentView\(compactView\)/u);
    assert.match(stopArrivalNotificationSource, /lockscreenVisibility: Notifications\.AndroidNotificationVisibility\.PRIVATE/u);
    assert.match(stopArrivalNotificationSource, /const STOP_ARRIVAL_CHANNEL_ID = 'stop-arrivals-v2'/u);
    assert.match(stopArrivalNotificationSource, /importance: Notifications\.AndroidImportance\.MAX/u);
    assert.match(stopArrivalNotificationSource, /sound: true/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /sound: 'default'/u);
    assert.match(stopArrivalNotificationSource, /enableVibrate: true/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /Notifications\.setNotificationCategoryAsync/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /buttonTitle: 'Add Proof'/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /buttonTitle: 'Next Stop'/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /categoryIdentifier/u);
    assert.match(stopArrivalNotificationSource, /channelId: STOP_ARRIVAL_CHANNEL_ID/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /handledStopArrivalResponseIds/u);
    assert.doesNotMatch(stopArrivalNotificationSource, /parseStopArrivalNotificationResponse/u);
    assert.doesNotMatch(moduleConfigSource, /"publication"/u);
    assert.match(mainActivitySource, /override fun onNewIntent\(intent: Intent\)/u);
    assert.match(mainActivitySource, /setIntent\(intent\)/u);
    assert.match(patchSource, /Unsupported expo-location source/u);
  });

  it('shares one lazy persistent queue between AppRoot and the background task', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const locationSource = readFileSync(locationServicePath, 'utf8');
    const storageSource = readFileSync(queueStoragePath, 'utf8');
    const secureStoreSource = readFileSync(secureStorePath, 'utf8');

    assert.match(appSource, /getExpoOfflineSubmissionQueue/u);
    assert.match(locationSource, /getExpoOfflineSubmissionQueue/u);
    assert.match(storageSource, /offlineSubmissionQueuePromise/u);
    assert.match(secureStoreSource, /driverAccessTokenStore \?\?=/u);
  });
});
