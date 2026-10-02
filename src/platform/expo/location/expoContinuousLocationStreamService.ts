import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import {
  CONTINUOUS_LOCATION_TASK_NAME,
  type BackgroundPermissionResult,
  type ContinuousLocationBatchItem,
  type ContinuousLocationNotificationContent,
  type ContinuousLocationStreamService,
} from '../../../domain/location/continuousLocationStream';
import {
  processContinuousLocationTaskBatch,
  type ContinuousLocationTaskResult,
} from '../../../domain/location/continuousLocationTask';
import { createDriverApiClientsFromPersistedDriverAccess } from '../../../api/deliveryServer/driverApiClients';
import { createDriverRuntimeServices, readDriverRuntimeConfig } from '../../../app/config/driverRuntimeConfig';
import { observeOfflineQueuePersistence } from '../../../app/offlineQueuePersistence';
import { createExpoSecureDriverAccessTokenStore } from '../secureStore/expoSecureDriverAccessTokenStore';
import { readInstalledDriverAppVersion } from '../application/expoAppVersionService';
import {
  bindExpoOfflineSubmissionQueueAccount,
  getExpoOfflineSubmissionQueue,
} from '../storage/expoOfflineSubmissionQueueStorage';
import { emitCompletionAssistanceChange, recordExpoCompletionLocations, startCompletionAssistanceWork } from './expoCompletionAssistance';
import { createExpoCompletionAssistanceStore, getCompletionAccountOwnerHash } from '../storage/expoCompletionAssistanceStore';
import { synchronizeCompletionAssistance } from '../../../domain/completion/completionAssistanceSync';
import { notifyCompletionCandidates } from '../../../domain/completion/completionAssistanceNotifications';
import { showCompletionCandidateNotification } from '../notifications/expoCompletionAssistanceNotifications';
import {
  captureDriverDiagnosticEmitter,
  emitDriverDiagnosticObservation,
  type DriverDiagnosticEmitter,
} from '../../../domain/diagnostics/driverDiagnosticObservation';
import {
  startExpoDriverDiagnosticRuntime,
  updateExpoDriverDiagnosticQueue,
} from '../diagnostics/expoDriverDiagnosticRuntime';
import {
  observeLocationTaskCallback,
  observeLocationTaskResult,
  runObservedLocationOperation,
  startLocationTaskProcessingWatchdog,
  type LocationDiagnosticObservation,
} from './locationDiagnosticOrchestration';

export type ContinuousLocationTaskObserver = (
  locations: ContinuousLocationBatchItem[],
  result: ContinuousLocationTaskResult | null,
) => Promise<void> | void;

type ExpoLocationTaskData = {
  locations?: Location.LocationObject[];
};

type ExpoLocationNotificationModule = {
  updateLocationTaskNotificationAsync(
    taskName: string,
    notification: {
      notificationBigText?: string;
      notificationBody: string;
      notificationTitle: string;
      notificationUrl?: string;
    },
  ): Promise<boolean>;
};

const driverAccessTokenStore = createExpoSecureDriverAccessTokenStore();
const installedDriverAppVersion = readInstalledDriverAppVersion();
const runtimeConfig = readDriverRuntimeConfig({
  EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL,
  EXPO_PUBLIC_DRIVER_RUNTIME_MODE: process.env.EXPO_PUBLIC_DRIVER_RUNTIME_MODE,
});
const runtimeServices = createDriverRuntimeServices({ config: runtimeConfig });
const expoLocationNotificationModule = Platform.OS === 'android'
  ? requireNativeModule<ExpoLocationNotificationModule>('ExpoLocation')
  : null;
let continuousLocationTaskObserver: ContinuousLocationTaskObserver | null = null;
let locationTaskOperationQueue = Promise.resolve();

function emitLocationDiagnosticObservation(
  observation: LocationDiagnosticObservation,
  emit: DriverDiagnosticEmitter = emitDriverDiagnosticObservation,
): void {
  if (observation.type === 'LOCATION_TASK_CALLBACK') {
    emit({
      callbackAt: observation.callbackAt,
      ...(observation.collectedAt === undefined ? {} : { collectedAt: observation.collectedAt }),
      kind: 'STATE',
    });
    return;
  }
  if (observation.type === 'LOCATION_TASK_OPERATION') {
    if (observation.phase === 'ATTEMPT') {
      emit({
        kind: 'STATE',
        patch: observation.operation === 'STOP'
          ? { locationTaskExpected: false }
          : { locationTaskExpected: true },
      });
      return;
    }
    if (observation.phase === 'ERROR') {
      emit({
        blocker: {
          reasonCode: observation.operation === 'STOP'
            ? 'LOCATION_TASK_STOP_FAILED'
            : 'LOCATION_TASK_START_FAILED',
          stage: 'LOCATION',
        },
        kind: 'STATE',
        patch: { locationTask: 'ERROR' },
      });
      return;
    }
    emit({
      clearReasonCodes: [
        'LOCATION_TASK_ERROR',
        'LOCATION_TASK_NOT_STARTED',
        'LOCATION_TASK_START_FAILED',
        'LOCATION_TASK_STOP_FAILED',
      ],
      kind: 'STATE',
      patch: observation.operation === 'STOP'
        ? { locationTask: 'STOPPED', locationTaskExpected: false }
        : { locationTask: 'STARTED', locationTaskExpected: true },
    });
    return;
  }
  if (observation.type === 'LOCATION_TASK_EXPECTED_STOP') {
    emit({
      clearStage: 'PROCESSING',
      kind: 'STATE',
      patch: { locationTaskExpected: false },
    });
    return;
  }
  if (observation.type === 'LOCATION_TASK_CONTEXT_BLOCKED') {
    emit({
      clearStage: 'PROCESSING',
      blocker: {
        reasonCode: observation.reason === 'ROUTE_NOT_IN_PROGRESS'
          ? 'ROUTE_NOT_IN_PROGRESS'
          : 'ROUTE_ACCESS_REVOKED',
        routePlanId: observation.routePlanId,
        sessionGeneration: observation.sessionGeneration,
        stage: 'ROUTE',
      },
      kind: 'STATE',
      patch: { locationTaskExpected: false },
    });
    return;
  }
  if (observation.type === 'LOCATION_TASK_PROCESSING_TIMEOUT') {
    emit({
      blocker: { reasonCode: 'LOCATION_PIPELINE_TIMEOUT', stage: 'PROCESSING' },
      kind: 'STATE',
    });
    return;
  }
  emit({
    clearStage: 'PROCESSING',
    kind: 'STATE',
    patch: { locationTask: 'STARTED', locationTaskExpected: true },
  });
}

function captureLocationDiagnosticObserver(): (observation: LocationDiagnosticObservation) => void {
  const emit = captureDriverDiagnosticEmitter();
  return (observation) => emitLocationDiagnosticObservation(observation, emit);
}

export function registerContinuousLocationTaskObserver(observer: ContinuousLocationTaskObserver | null): void {
  continuousLocationTaskObserver = observer;
}

function runLocationTaskOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = locationTaskOperationQueue.catch(() => undefined).then(operation);
  locationTaskOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

const DEFAULT_ACTIVE_ROUTE_NOTIFICATION: ContinuousLocationNotificationContent = {
  body: 'Next stop details are available in CLEVER Routes.',
  title: 'Route in progress',
};

async function startExpoLocationUpdates(
  taskName: string,
  notification: ContinuousLocationNotificationContent = DEFAULT_ACTIVE_ROUTE_NOTIFICATION,
): Promise<void> {
  await Location.startLocationUpdatesAsync(taskName, {
    accuracy: Location.Accuracy.High,
    activityType: Location.ActivityType.OtherNavigation,
    deferredUpdatesDistance: 0,
    deferredUpdatesInterval: 10_000,
    distanceInterval: 0,
    foregroundService: {
      killServiceOnDestroy: false,
      notificationBody: notification.body,
      ...(notification.expandedBody === undefined ? {} : { notificationBigText: notification.expandedBody }),
      notificationTitle: notification.title,
      ...(notification.url === undefined ? {} : { notificationUrl: notification.url }),
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    timeInterval: 10_000,
  });
}

async function stopExpoLocationUpdates(
  taskName: string,
  observe = captureLocationDiagnosticObserver(),
): Promise<void> {
  await runObservedLocationOperation({
    execute: async () => {
      if (await Location.hasStartedLocationUpdatesAsync(taskName)) {
        await Location.stopLocationUpdatesAsync(taskName);
      }
    },
    observe,
    operation: 'STOP',
  });
}

async function stopContinuousLocationTaskIfInactive(
  observe = captureLocationDiagnosticObserver(),
): Promise<void> {
  await runLocationTaskOperation(async () => {
    const persistedAccess = await driverAccessTokenStore.loadActiveDriverAccess();
    const hasActiveRoute = (
      (persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required')
      && persistedAccess.activeRouteSession !== undefined
      && persistedAccess.activeRouteSession.status === 'active'
      && persistedAccess.routeAccess?.routePlanId === persistedAccess.activeRouteSession.routePlanId
    );
    if (!hasActiveRoute) {
      await stopExpoLocationUpdates(CONTINUOUS_LOCATION_TASK_NAME, observe);
    }
  });
}

async function executeContinuousLocationTask(input: {
  data: ExpoLocationTaskData;
  error: { message: string } | null;
}): Promise<void> {
  try {
    startExpoDriverDiagnosticRuntime();
  } catch {
    // Diagnostic startup must never block the native GPS task.
  }
  const emitDiagnostic = captureDriverDiagnosticEmitter();
  const observeDiagnostic = (observation: LocationDiagnosticObservation) => (
    emitLocationDiagnosticObservation(observation, emitDiagnostic)
  );
  const nativeLocations = input.data.locations ?? [];
  const validNativeLocations = nativeLocations.filter((location) => (
    Number.isFinite(location.timestamp)
    && Number.isFinite(location.coords.latitude)
    && Number.isFinite(location.coords.longitude)
    && Math.abs(location.coords.latitude) <= 90
    && Math.abs(location.coords.longitude) <= 180
  ));
  observeLocationTaskCallback({
    callbackAt: new Date(),
    locationTimestamps: validNativeLocations.map((location) => location.timestamp),
    observe: observeDiagnostic,
  });
  if (input.error !== null) {
    emitDiagnostic({
      blocker: { reasonCode: 'LOCATION_TASK_ERROR', stage: 'LOCATION' },
      kind: 'STATE',
      patch: { locationTask: 'ERROR' },
    });
    return;
  }

  const locations = (input.data.locations ?? []).map((location) => ({
    ...(location.coords.accuracy === null ? {} : { accuracyMeters: location.coords.accuracy }),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    occurredAt: new Date(location.timestamp),
  }));

  if (locations.length > 0) {
    let taskResult: ContinuousLocationTaskResult | null = null;
    const processingWatchdog = startLocationTaskProcessingWatchdog({
      observe: observeDiagnostic,
    });
    try {
      if (runtimeConfig.mode === 'live') {
        const persistedAccess = await driverAccessTokenStore.loadActiveDriverAccess();
        const offlineQueue = observeOfflineQueuePersistence(persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required'
          ? await bindExpoOfflineSubmissionQueueAccount(persistedAccess.driverProfile.phoneE164)
          : await getExpoOfflineSubmissionQueue());
        updateExpoDriverDiagnosticQueue(offlineQueue);
        let syncCompletionAfterGps: (() => Promise<void>) | null = null;
        if (persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required') {
          const isCompletionSessionCurrent = async () => {
            const latest = await driverAccessTokenStore.loadActiveDriverAccess();
            return (latest.kind === 'active' || latest.kind === 'refresh_required')
              && latest.driverProfile.phoneE164 === persistedAccess.driverProfile.phoneE164
              && latest.activeRouteSession?.status === 'active'
              && latest.activeRouteSession.startedAt === persistedAccess.activeRouteSession?.startedAt
              && latest.routeAccess?.routePlanId === persistedAccess.routeAccess?.routePlanId
              && latest.routeAccess?.assignmentGeneration === persistedAccess.routeAccess?.assignmentGeneration
              && latest.routeAccess?.expectedRouteVersionId === persistedAccess.routeAccess?.expectedRouteVersionId;
          };
          // Candidate evidence must survive a stalled raw-GPS network request.
          // A separate storage/network failure must not stop the existing GPS path.
          await recordExpoCompletionLocations({
            persistedAccess, locations, isCurrent: isCompletionSessionCurrent,
          }).catch(() => undefined);
          syncCompletionAfterGps = async () => {
            const work = startCompletionAssistanceWork();
            try {
              const store = await createExpoCompletionAssistanceStore();
              const accountOwnerHash = await getCompletionAccountOwnerHash(persistedAccess.driverProfile.phoneE164);
              const assistance = await store.read(accountOwnerHash);
              const needsSync = assistance.commands.length > 0 || (assistance.bufferedLocations?.length ?? 0) > 0;
              if (needsSync && await isCompletionSessionCurrent()) {
                // The raw-GPS path may just have refreshed the account token.
                const latest = await driverAccessTokenStore.loadActiveDriverAccess();
                if (latest.kind !== 'active' && latest.kind !== 'refresh_required') return;
                await synchronizeCompletionAssistance({
                  store, accountOwnerHash, baseUrl: runtimeConfig.deliveryServerBaseUrl,
                  accessToken: latest.accountAccess.accessToken,
                  signal: work.signal,
                  validateCurrent: isCompletionSessionCurrent,
                });
                await notifyCompletionCandidates({
                  store, accountOwnerHash, notify: (candidate) => showCompletionCandidateNotification(candidate, accountOwnerHash),
                  isCurrent: () => !work.signal.aborted, validateCurrent: isCompletionSessionCurrent,
                });
                emitCompletionAssistanceChange();
              }
            } catch {
              // The encrypted command remains pending for foreground/background retry.
            } finally { work.release(); }
          };
        }
        taskResult = await processContinuousLocationTaskBatch({
          createDriverEventService: ({ persistedAccess, refreshDriverAccess }) => (
            createDriverApiClientsFromPersistedDriverAccess({
              ...(installedDriverAppVersion === null ? {} : {
                appVersion: installedDriverAppVersion.versionName,
                versionCode: installedDriverAppVersion.versionCode,
              }),
              baseUrl: runtimeConfig.deliveryServerBaseUrl,
              persistedAccess,
              refreshDriverAccess,
            }).driverEventService
          ),
          driverAccessTokenStore,
          driverAuthService: runtimeServices.driverAuthService,
          locations,
          offlineQueue,
          routeAccessService: runtimeServices.routeAccessService,
        });
        updateExpoDriverDiagnosticQueue(offlineQueue);
        if (taskResult.kind === 'processed' && (taskResult.queuedCount ?? 0) > 0) {
          emitDiagnostic({ kind: 'STATE', persistedAt: new Date().toISOString() });
        }
        observeLocationTaskResult(taskResult, observeDiagnostic);
        if (taskResult.kind === 'deactivated' || taskResult.kind === 'ignored') {
          await stopContinuousLocationTaskIfInactive(observeDiagnostic);
        }
        processingWatchdog.complete();
        await syncCompletionAfterGps?.();
      }
    } catch (error) {
      emitDiagnostic({
        blocker: { reasonCode: 'LOCATION_PROCESSING_FAILED', stage: 'PROCESSING' },
        kind: 'STATE',
      });
      throw error;
    } finally {
      processingWatchdog.complete();
      await continuousLocationTaskObserver?.(locations, taskResult);
    }
  }
}

if (!TaskManager.isTaskDefined(CONTINUOUS_LOCATION_TASK_NAME)) {
  TaskManager.defineTask<ExpoLocationTaskData>(CONTINUOUS_LOCATION_TASK_NAME, ({ data, error }) => (
    executeContinuousLocationTask({ data, error })
  ));
}

export function createExpoContinuousLocationStreamService(): ContinuousLocationStreamService {
  return {
    ensureLocationUpdatesStarted: ({ notification, taskName }) => {
      const observe = captureLocationDiagnosticObserver();
      return runLocationTaskOperation(() => runObservedLocationOperation({
        execute: async () => {
          const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(taskName);
          await startExpoLocationUpdates(taskName, notification);
          return { alreadyStarted };
        },
        observe,
        operation: 'ENSURE',
      }));
    },
    getBackgroundAvailability: async () => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      try {
        const [taskManagerAvailable, backgroundLocationAvailable] = await Promise.all([
          TaskManager.isAvailableAsync(),
          Location.isBackgroundLocationAvailableAsync(),
        ]);
        const available = taskManagerAvailable && backgroundLocationAvailable;
        emitDiagnostic({
          ...(available ? {} : { blocker: { reasonCode: 'LOCATION_SERVICES_DISABLED', stage: 'LOCATION' as const } }),
          clearReasonCodes: available
            ? ['LOCATION_SERVICES_DISABLED', 'LOCATION_SERVICE_STATUS_FAILED']
            : ['LOCATION_SERVICE_STATUS_FAILED'],
          kind: 'STATE',
          patch: { locationService: available ? 'ENABLED' : 'DISABLED' },
        });
        return available;
      } catch (error) {
        emitDiagnostic({
          blocker: { reasonCode: 'LOCATION_SERVICE_STATUS_FAILED', stage: 'LOCATION' },
          kind: 'STATE',
          patch: { locationService: 'UNKNOWN' },
        });
        throw error;
      }
    },
    getBackgroundPermission: async (): Promise<BackgroundPermissionResult> => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      try {
        const permission = await Location.getBackgroundPermissionsAsync();
        emitDiagnostic({
          ...(permission.status === 'granted' ? {} : { blocker: { reasonCode: 'LOCATION_PERMISSION_DENIED', stage: 'LOCATION' as const } }),
          clearReasonCodes: permission.status === 'granted'
            ? ['LOCATION_PERMISSION_DENIED', 'LOCATION_PERMISSION_STATUS_FAILED']
            : ['LOCATION_PERMISSION_STATUS_FAILED'],
          kind: 'STATE',
          patch: { locationPermission: permission.status === 'granted' ? 'GRANTED_ALWAYS' : 'DENIED' },
        });
        return permission.status === 'granted' ? 'granted' : 'denied';
      } catch {
        emitDiagnostic({
          blocker: { reasonCode: 'LOCATION_PERMISSION_STATUS_FAILED', stage: 'LOCATION' },
          kind: 'STATE',
          patch: { locationPermission: 'UNKNOWN' },
        });
        return 'denied';
      }
    },
    hasStartedLocationUpdates: async (taskName) => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      try {
        const started = await Location.hasStartedLocationUpdatesAsync(taskName);
        emitDiagnostic({
          ...(started ? {
            clearReasonCodes: [
              'LOCATION_TASK_ERROR',
              'LOCATION_TASK_NOT_STARTED',
              'LOCATION_TASK_START_FAILED',
              'LOCATION_TASK_STOP_FAILED',
            ] as const,
          } : {}),
          kind: 'STATE',
          patch: { locationTask: started ? 'STARTED' : 'STOPPED' },
        });
        return started;
      } catch (error) {
        emitDiagnostic({
          blocker: { reasonCode: 'LOCATION_TASK_ERROR', stage: 'LOCATION' },
          kind: 'STATE',
          patch: { locationTask: 'ERROR' },
        });
        throw error;
      }
    },
    requestBackgroundPermission: async (): Promise<BackgroundPermissionResult> => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      try {
        const permission = await Location.requestBackgroundPermissionsAsync();
        emitDiagnostic({
          ...(permission.status === 'granted' ? {} : { blocker: { reasonCode: 'LOCATION_PERMISSION_DENIED', stage: 'LOCATION' as const } }),
          clearReasonCodes: permission.status === 'granted'
            ? ['LOCATION_PERMISSION_DENIED', 'LOCATION_PERMISSION_STATUS_FAILED']
            : ['LOCATION_PERMISSION_STATUS_FAILED'],
          kind: 'STATE',
          patch: { locationPermission: permission.status === 'granted' ? 'GRANTED_ALWAYS' : 'DENIED' },
        });
        return permission.status === 'granted' ? 'granted' : 'denied';
      } catch {
        emitDiagnostic({
          blocker: { reasonCode: 'LOCATION_PERMISSION_STATUS_FAILED', stage: 'LOCATION' },
          kind: 'STATE',
          patch: { locationPermission: 'UNKNOWN' },
        });
        return 'denied';
      }
    },
    startLocationUpdates: ({ notification, taskName }) => {
      const observe = captureLocationDiagnosticObserver();
      return runLocationTaskOperation(() => runObservedLocationOperation({
        execute: () => startExpoLocationUpdates(taskName, notification),
        observe,
        operation: 'START',
      }));
    },
    stopLocationUpdates: (taskName) => {
      const observe = captureLocationDiagnosticObserver();
      return runLocationTaskOperation(() => stopExpoLocationUpdates(taskName, observe));
    },
    stopLocationUpdatesIfCurrent: (taskName, isCurrent) => {
      const observe = captureLocationDiagnosticObserver();
      return runLocationTaskOperation(async () => {
        if (!(await isCurrent())) return false;
        await stopExpoLocationUpdates(taskName, observe);
        return true;
      });
    },
    updateLocationNotification: ({ notification, taskName }) => runLocationTaskOperation(async () => {
      if (
        expoLocationNotificationModule !== null
        && await Location.hasStartedLocationUpdatesAsync(taskName)
      ) {
        await expoLocationNotificationModule.updateLocationTaskNotificationAsync(taskName, {
          notificationBody: notification.body,
          ...(notification.expandedBody === undefined ? {} : { notificationBigText: notification.expandedBody }),
          notificationTitle: notification.title,
          ...(notification.url === undefined ? {} : { notificationUrl: notification.url }),
        });
      }
    }),
  };
}
