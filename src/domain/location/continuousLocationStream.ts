import type { DeliveryStartResult } from '../delivery/deliveryStart';
import type { DriverAccessTokenStore } from '../driver/driverAccessTokenStore';
import type { DriverEventInput, DriverEventService } from '../events/driverEvents';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { isDriverRouteNotInProgressError } from '../../api/deliveryServer/driverApiError';

export const CONTINUOUS_LOCATION_TASK_NAME = 'clever-driver-continuous-location';

export type BackgroundPermissionResult = 'denied' | 'granted';

export type ContinuousLocationNotificationContent = {
  body: string;
  expandedBody?: string;
  title: string;
  url?: string;
};

export type ContinuousLocationStreamService = {
  ensureLocationUpdatesStarted?(input: {
    notification?: ContinuousLocationNotificationContent;
    routePlanId: string | null;
    taskName: string;
  }): Promise<{ alreadyStarted: boolean }>;
  getBackgroundAvailability(): Promise<boolean>;
  getBackgroundPermission(): Promise<BackgroundPermissionResult>;
  hasStartedLocationUpdates(taskName: string): Promise<boolean>;
  requestBackgroundPermission(): Promise<BackgroundPermissionResult>;
  startLocationUpdates(input: {
    notification?: ContinuousLocationNotificationContent;
    routePlanId: string | null;
    taskName: string;
  }): Promise<void>;
  stopLocationUpdates(taskName: string): Promise<void>;
  updateLocationNotification?(input: {
    notification: ContinuousLocationNotificationContent;
    taskName: string;
  }): Promise<void>;
};

export type ContinuousLocationPermissionResult =
  | { kind: 'granted' }
  | Extract<ContinuousLocationStreamStartResult, { kind: 'blocked' }>;

export type ContinuousLocationStreamStartResult =
  | {
      alreadyStarted: boolean;
      kind: 'streaming';
      message: string;
      routePlanId: string | null;
      taskName: string;
    }
  | {
      kind: 'blocked';
      message: string;
      reason: 'background_permission_denied' | 'background_unavailable' | 'delivery_not_active';
    };

export type ContinuousLocationBatchItem = {
  latitude: number;
  longitude: number;
  occurredAt: Date;
};

export type ContinuousLocationBatchRecordResult =
  | {
      kind: 'recorded';
      queuedCount?: number;
      recordedCount: number;
    }
  | {
      kind: 'route_not_in_progress';
      recordedCount: number;
    };

export type ContinuousLocationStopResult = {
  kind: 'stopped';
  taskName: string;
};

export type ContinuousLocationSessionCleanupResult = ContinuousLocationStopResult | {
  kind: 'unchanged';
  taskName: string;
};

export async function requestContinuousLocationBackgroundPermission(input: {
  streamService: ContinuousLocationStreamService;
}): Promise<ContinuousLocationPermissionResult> {
  try {
    if (!(await input.streamService.getBackgroundAvailability())) {
      return {
        kind: 'blocked',
        message: 'Background location is unavailable on this build or device.',
        reason: 'background_unavailable',
      };
    }

    const permission = await input.streamService.requestBackgroundPermission();
    if (permission !== 'granted') {
      return {
        kind: 'blocked',
        message: 'Choose Allow all the time for location, then start the session again.',
        reason: 'background_permission_denied',
      };
    }

    return { kind: 'granted' };
  } catch {
    return {
      kind: 'blocked',
      message: 'Background location permission could not be opened. Return to the app and try again.',
      reason: 'background_permission_denied',
    };
  }
}

export async function startContinuousLocationUpdatesAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  notification?: ContinuousLocationNotificationContent;
  routePlanId: string | null;
  streamService: ContinuousLocationStreamService;
  taskName?: string;
}): Promise<ContinuousLocationStreamStartResult> {
  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;

  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Continuous location updates start only after delivery_active.',
      reason: 'delivery_not_active',
    };
  }

  if (!(await input.streamService.getBackgroundAvailability())) {
    return {
      kind: 'blocked',
      message: 'Background location is unavailable on this build or device.',
      reason: 'background_unavailable',
    };
  }

  const permission = await input.streamService.getBackgroundPermission();
  if (permission !== 'granted') {
    return {
      kind: 'blocked',
      message: 'Background location permission is required for continuous delivery tracking.',
      reason: 'background_permission_denied',
    };
  }

  const locationUpdateInput = {
    ...(input.notification === undefined ? {} : { notification: input.notification }),
    routePlanId: input.routePlanId,
    taskName,
  };
  const alreadyStarted = input.streamService.ensureLocationUpdatesStarted === undefined
    ? await input.streamService.hasStartedLocationUpdates(taskName)
    : (await input.streamService.ensureLocationUpdatesStarted(locationUpdateInput)).alreadyStarted;
  if (!alreadyStarted && input.streamService.ensureLocationUpdatesStarted === undefined) {
    await input.streamService.startLocationUpdates(locationUpdateInput);
  }

  return {
    alreadyStarted,
    kind: 'streaming',
    message: 'Continuous location updates are active.',
    routePlanId: input.routePlanId,
    taskName,
  };
}

export async function recordContinuousLocationUpdateBatch(input: {
  driverEventService: DriverEventService;
  isSessionCurrent?: () => Promise<boolean>;
  locations: ContinuousLocationBatchItem[];
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string | null;
}): Promise<ContinuousLocationBatchRecordResult> {
  let queuedCount = 0;
  let recordedCount = 0;
  const queuedEvents: DriverEventInput[] = [];

  for (const [index, location] of input.locations.entries()) {
    if (input.isSessionCurrent !== undefined && !(await input.isSessionCurrent())) {
      break;
    }
    const event: DriverEventInput = {
      clientEventId: createContinuousLocationClientEventId(location, index),
      eventType: 'LOCATION_UPDATED',
      latitude: location.latitude,
      longitude: location.longitude,
      occurredAt: location.occurredAt,
      payload: { source: 'continuous-location-stream' },
      routePlanId: input.routePlanId,
    };

    try {
      await input.driverEventService.recordDriverEvent(event);
      recordedCount += 1;
    } catch (error) {
      if (isDriverRouteNotInProgressError(error)) {
        return { kind: 'route_not_in_progress', recordedCount };
      }
      if (input.offlineQueue === undefined) {
        throw error;
      }
      if (input.isSessionCurrent !== undefined && !(await input.isSessionCurrent())) {
        break;
      }

      queuedEvents.push(event);
    }
  }

  if (
    queuedEvents.length > 0
    && (input.isSessionCurrent === undefined || await input.isSessionCurrent())
  ) {
    input.offlineQueue?.enqueueDriverEvents(queuedEvents);
    queuedCount = queuedEvents.length;
  }

  return queuedCount > 0
    ? { kind: 'recorded', queuedCount, recordedCount }
    : { kind: 'recorded', recordedCount };
}

export async function stopContinuousLocationUpdates(input: {
  streamService: ContinuousLocationStreamService;
  taskName?: string;
}): Promise<ContinuousLocationStopResult> {
  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  await input.streamService.stopLocationUpdates(taskName);
  return { kind: 'stopped', taskName };
}

export async function clearAndStopContinuousLocationSession(input: {
  activeRouteSessionStore: Pick<DriverAccessTokenStore, 'clearActiveRouteSession'>;
  routePlanId?: string;
  streamService: ContinuousLocationStreamService;
  taskName?: string;
}): Promise<ContinuousLocationSessionCleanupResult> {
  let clearError: unknown;
  let cleared = false;
  try {
    cleared = await input.activeRouteSessionStore.clearActiveRouteSession(input.routePlanId);
  } catch (error) {
    clearError = error;
  }

  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  if (input.routePlanId !== undefined && !cleared && clearError === undefined) {
    return { kind: 'unchanged', taskName };
  }
  const result = await stopContinuousLocationUpdates({
    streamService: input.streamService,
    taskName,
  });
  if (clearError !== undefined) {
    throw clearError;
  }
  return result;
}

function createContinuousLocationClientEventId(location: ContinuousLocationBatchItem, index: number): string {
  return `continuous-location-${location.occurredAt.toISOString()}-${index}`;
}
