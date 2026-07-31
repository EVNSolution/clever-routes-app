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
import { createExpoSecureDriverAccessTokenStore } from '../secureStore/expoSecureDriverAccessTokenStore';
import { getExpoOfflineSubmissionQueue } from '../storage/expoOfflineSubmissionQueueStorage';

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
const runtimeConfig = readDriverRuntimeConfig({
  EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL,
  EXPO_PUBLIC_DRIVER_RUNTIME_MODE: process.env.EXPO_PUBLIC_DRIVER_RUNTIME_MODE,
});
const runtimeServices = createDriverRuntimeServices({ config: runtimeConfig });
const expoLocationNotificationModule = Platform.OS === 'android'
  ? requireNativeModule<ExpoLocationNotificationModule>('ExpoLocation')
  : null;
const activeTaskExecutions = new Set<Promise<void>>();
let continuousLocationTaskObserver: ContinuousLocationTaskObserver | null = null;
let locationTaskOperationQueue = Promise.resolve();

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

async function stopExpoLocationUpdates(taskName: string): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(taskName)) {
    await Location.stopLocationUpdatesAsync(taskName);
  }
}

async function stopContinuousLocationTaskIfInactive(): Promise<void> {
  await runLocationTaskOperation(async () => {
    const persistedAccess = await driverAccessTokenStore.loadActiveDriverAccess();
    const hasActiveRoute = (
      (persistedAccess.kind === 'active' || persistedAccess.kind === 'refresh_required')
      && persistedAccess.activeRouteSession !== undefined
      && persistedAccess.routeAccess?.routePlanId === persistedAccess.activeRouteSession.routePlanId
    );
    if (!hasActiveRoute) {
      await stopExpoLocationUpdates(CONTINUOUS_LOCATION_TASK_NAME);
    }
  });
}

async function executeContinuousLocationTask(input: {
  data: ExpoLocationTaskData;
  error: { message: string } | null;
}): Promise<void> {
  if (input.error !== null) {
    return;
  }

  const locations = (input.data.locations ?? []).map((location) => ({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    occurredAt: new Date(location.timestamp),
  }));

  if (locations.length > 0) {
    let taskResult: ContinuousLocationTaskResult | null = null;
    try {
      if (runtimeConfig.mode === 'live') {
        taskResult = await processContinuousLocationTaskBatch({
          createDriverEventService: ({ persistedAccess, refreshDriverAccess }) => (
            createDriverApiClientsFromPersistedDriverAccess({
              baseUrl: runtimeConfig.deliveryServerBaseUrl,
              persistedAccess,
              refreshDriverAccess,
            }).driverEventService
          ),
          driverAccessTokenStore,
          driverAuthService: runtimeServices.driverAuthService,
          locations,
          offlineQueue: await getExpoOfflineSubmissionQueue(),
          routeAccessService: runtimeServices.routeAccessService,
        });
        if (taskResult.kind === 'deactivated' || taskResult.kind === 'ignored') {
          await stopContinuousLocationTaskIfInactive();
        }
      }
    } finally {
      await continuousLocationTaskObserver?.(locations, taskResult);
    }
  }
}

if (!TaskManager.isTaskDefined(CONTINUOUS_LOCATION_TASK_NAME)) {
  TaskManager.defineTask<ExpoLocationTaskData>(CONTINUOUS_LOCATION_TASK_NAME, ({ data, error }) => {
    const execution = executeContinuousLocationTask({ data, error });
    activeTaskExecutions.add(execution);
    return execution.finally(() => {
      activeTaskExecutions.delete(execution);
    });
  });
}

export function createExpoContinuousLocationStreamService(): ContinuousLocationStreamService {
  return {
    ensureLocationUpdatesStarted: ({ notification, taskName }) => runLocationTaskOperation(async () => {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(taskName);
      await startExpoLocationUpdates(taskName, notification);
      return { alreadyStarted };
    }),
    getBackgroundAvailability: async () => {
      const [taskManagerAvailable, backgroundLocationAvailable] = await Promise.all([
        TaskManager.isAvailableAsync(),
        Location.isBackgroundLocationAvailableAsync(),
      ]);
      return taskManagerAvailable && backgroundLocationAvailable;
    },
    getBackgroundPermission: async (): Promise<BackgroundPermissionResult> => {
      try {
        const permission = await Location.getBackgroundPermissionsAsync();
        return permission.status === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },
    hasStartedLocationUpdates: async (taskName) => Location.hasStartedLocationUpdatesAsync(taskName),
    requestBackgroundPermission: async (): Promise<BackgroundPermissionResult> => {
      try {
        const permission = await Location.requestBackgroundPermissionsAsync();
        return permission.status === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },
    startLocationUpdates: ({ notification, taskName }) => runLocationTaskOperation(() => startExpoLocationUpdates(taskName, notification)),
    stopLocationUpdates: async (taskName) => {
      await Promise.allSettled(Array.from(activeTaskExecutions));
      await runLocationTaskOperation(() => stopExpoLocationUpdates(taskName));
    },
    updateLocationNotification: ({ notification, taskName }) => runLocationTaskOperation(async () => {
      if (
        expoLocationNotificationModule !== null
        && await Location.hasStartedLocationUpdatesAsync(taskName)
      ) {
        const updated = await expoLocationNotificationModule.updateLocationTaskNotificationAsync(taskName, {
          notificationBody: notification.body,
          ...(notification.expandedBody === undefined ? {} : { notificationBigText: notification.expandedBody }),
          notificationTitle: notification.title,
          ...(notification.url === undefined ? {} : { notificationUrl: notification.url }),
        });
        if (!updated) {
          throw new Error('The active Android location notification service was not found.');
        }
      }
    }),
  };
}
