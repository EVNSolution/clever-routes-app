import type { DeliveryStartResult } from '../delivery/deliveryStart';
import type { DriverEventInput, DriverEventService } from '../events/driverEvents';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

export const CONTINUOUS_LOCATION_TASK_NAME = 'clever-driver-continuous-location';

export type BackgroundPermissionResult = 'denied' | 'granted';

export type ContinuousLocationStreamService = {
  getBackgroundAvailability(): Promise<boolean>;
  hasStartedLocationUpdates(taskName: string): Promise<boolean>;
  requestBackgroundPermission(): Promise<BackgroundPermissionResult>;
  startLocationUpdates(input: { routePlanId: string | null; taskName: string }): Promise<void>;
  stopLocationUpdates(taskName: string): Promise<void>;
};

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

export type ContinuousLocationBatchRecordResult = {
  kind: 'recorded';
  queuedCount?: number;
  recordedCount: number;
};

export type ContinuousLocationStopResult = {
  kind: 'stopped';
  taskName: string;
};

export async function startContinuousLocationUpdatesAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
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

  const permission = await input.streamService.requestBackgroundPermission();
  if (permission !== 'granted') {
    return {
      kind: 'blocked',
      message: 'Background location permission is required for continuous delivery tracking.',
      reason: 'background_permission_denied',
    };
  }

  const alreadyStarted = await input.streamService.hasStartedLocationUpdates(taskName);
  if (!alreadyStarted) {
    await input.streamService.startLocationUpdates({
      routePlanId: input.routePlanId,
      taskName,
    });
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
  locations: ContinuousLocationBatchItem[];
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string | null;
}): Promise<ContinuousLocationBatchRecordResult> {
  let queuedCount = 0;
  let recordedCount = 0;

  for (const [index, location] of input.locations.entries()) {
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
      if (input.offlineQueue === undefined) {
        throw error;
      }

      input.offlineQueue.enqueueDriverEvent(event);
      queuedCount += 1;
    }
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

function createContinuousLocationClientEventId(location: ContinuousLocationBatchItem, index: number): string {
  return `continuous-location-${location.occurredAt.toISOString()}-${index}`;
}
