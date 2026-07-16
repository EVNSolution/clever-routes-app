import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  CONTINUOUS_LOCATION_TASK_NAME,
  type BackgroundPermissionResult,
  type ContinuousLocationBatchItem,
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

const driverAccessTokenStore = createExpoSecureDriverAccessTokenStore();
const runtimeConfig = readDriverRuntimeConfig({
  EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL,
});
const runtimeServices = createDriverRuntimeServices({ config: runtimeConfig });
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

async function startExpoLocationUpdates(taskName: string): Promise<void> {
  await Location.startLocationUpdatesAsync(taskName, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.OtherNavigation,
    deferredUpdatesDistance: 50,
    deferredUpdatesInterval: 30_000,
    distanceInterval: 50,
    foregroundService: {
      killServiceOnDestroy: false,
      notificationBody: 'Clever Driver is tracking active delivery location.',
      notificationTitle: 'Active delivery tracking',
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    timeInterval: 30_000,
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
    ensureLocationUpdatesStarted: ({ taskName }) => runLocationTaskOperation(async () => {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(taskName);
      if (!alreadyStarted) {
        await startExpoLocationUpdates(taskName);
      }
      return { alreadyStarted };
    }),
    getBackgroundAvailability: async () => {
      const [taskManagerAvailable, backgroundLocationAvailable] = await Promise.all([
        TaskManager.isAvailableAsync(),
        Location.isBackgroundLocationAvailableAsync(),
      ]);
      return taskManagerAvailable && backgroundLocationAvailable;
    },
    hasStartedLocationUpdates: async (taskName) => Location.hasStartedLocationUpdatesAsync(taskName),
    requestBackgroundPermission: async (): Promise<BackgroundPermissionResult> => {
      const permission = await Location.requestBackgroundPermissionsAsync();
      return permission.status === 'granted' ? 'granted' : 'denied';
    },
    startLocationUpdates: ({ taskName }) => runLocationTaskOperation(() => startExpoLocationUpdates(taskName)),
    stopLocationUpdates: async (taskName) => {
      await Promise.allSettled(Array.from(activeTaskExecutions));
      await runLocationTaskOperation(() => stopExpoLocationUpdates(taskName));
    },
  };
}
