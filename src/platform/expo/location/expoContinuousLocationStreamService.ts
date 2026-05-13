import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  CONTINUOUS_LOCATION_TASK_NAME,
  type BackgroundPermissionResult,
  type ContinuousLocationBatchItem,
  type ContinuousLocationStreamService,
} from '../../../domain/location/continuousLocationStream';

export type ContinuousLocationTaskHandler = (locations: ContinuousLocationBatchItem[]) => Promise<void> | void;

type ExpoLocationTaskData = {
  locations?: Location.LocationObject[];
};

let continuousLocationTaskHandler: ContinuousLocationTaskHandler | null = null;

export function registerContinuousLocationTaskHandler(handler: ContinuousLocationTaskHandler | null): void {
  continuousLocationTaskHandler = handler;
}

if (!TaskManager.isTaskDefined(CONTINUOUS_LOCATION_TASK_NAME)) {
  TaskManager.defineTask<ExpoLocationTaskData>(CONTINUOUS_LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error !== null || continuousLocationTaskHandler === null) {
      return;
    }

    const locations = (data.locations ?? []).map((location) => ({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      occurredAt: new Date(location.timestamp),
    }));

    if (locations.length > 0) {
      await continuousLocationTaskHandler(locations);
    }
  });
}

export function createExpoContinuousLocationStreamService(): ContinuousLocationStreamService {
  return {
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
    startLocationUpdates: async ({ taskName }) => {
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
    },
    stopLocationUpdates: async (taskName) => {
      if (await Location.hasStartedLocationUpdatesAsync(taskName)) {
        await Location.stopLocationUpdatesAsync(taskName);
      }
    },
  };
}
