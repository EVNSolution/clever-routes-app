import type { DeliveryStartResult } from '../delivery/deliveryStart';
import type { DriverAccessTokenStore } from '../driver/driverAccessTokenStore';
import type { DriverEventInput, DriverEventService } from '../events/driverEvents';
import type { OfflineDriverEventQueueItem, OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { DriverApiHttpError, isDriverRouteNotInProgressError } from '../../api/deliveryServer/driverApiError';
import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';

export const CONTINUOUS_LOCATION_TASK_NAME = 'clever-routes-continuous-location';
/** A background batch must finish inside the OS job limit (15 seconds), so one live request may not wait longer. */
export const CONTINUOUS_LOCATION_LIVE_REQUEST_TIMEOUT_MS = 8_000;
/** Stored GPS points sent after a live batch got through, so a gap fills in without opening the app. */
export const CONTINUOUS_LOCATION_STORED_SEND_MAX_ITEMS = 25;
export const CONTINUOUS_LOCATION_STORED_SEND_BUDGET_MS = 5_000;

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
  stopLocationUpdatesIfCurrent?(taskName: string, isCurrent: () => Promise<boolean> | boolean): Promise<boolean>;
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
  accuracyMeters?: number;
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
  liveRequestTimeoutMs?: number;
  locations: ContinuousLocationBatchItem[];
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string | null;
}): Promise<ContinuousLocationBatchRecordResult> {
  let queuedCount = 0;
  let recordedCount = 0;
  // After a request that failed because of the network or the server, more live requests would only wait and fail
  // too. The rest of the batch is stored on the phone at once and sent later.
  let liveRequestsOpen = true;
  const queuedEvents: DriverEventInput[] = [];

  for (const [index, location] of input.locations.entries()) {
    if (input.isSessionCurrent !== undefined && !(await input.isSessionCurrent())) {
      break;
    }
    const event: DriverEventInput = {
      ...(location.accuracyMeters === undefined ? {} : { accuracyMeters: location.accuracyMeters }),
      clientEventId: createContinuousLocationClientEventId(location, index),
      eventType: 'LOCATION_UPDATED',
      latitude: location.latitude,
      longitude: location.longitude,
      occurredAt: location.occurredAt,
      payload: { source: 'continuous-location-stream' },
      routePlanId: input.routePlanId,
    };

    if (!liveRequestsOpen && input.offlineQueue !== undefined) {
      queuedEvents.push(event);
      continue;
    }

    try {
      await runBoundedAsyncOperation(
        (signal) => input.driverEventService.recordDriverEvent(event, { signal }),
        { timeoutMs: input.liveRequestTimeoutMs ?? CONTINUOUS_LOCATION_LIVE_REQUEST_TIMEOUT_MS },
      );
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
      if (!isRejectionOfOnePoint(error)) liveRequestsOpen = false;
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

/**
 * Sends the GPS points that were stored on the phone while the connection was bad, oldest first, after a live
 * request just got through. It is bounded by an item limit and a time budget (the OS ends a background job after
 * 15 seconds), stops at the first failure and leaves reconciliation of an ended route to the retry.
 */
export async function sendStoredContinuousLocations(input: {
  driverEventService: DriverEventService;
  isSessionCurrent?: () => Promise<boolean>;
  liveRequestTimeoutMs?: number;
  maxItems?: number;
  now?: () => number;
  offlineQueue: OfflineSubmissionQueue;
  routePlanId: string;
  timeBudgetMs?: number;
}): Promise<{ sentCount: number }> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const budgetMs = input.timeBudgetMs ?? CONTINUOUS_LOCATION_STORED_SEND_BUDGET_MS;
  const storedPoints = input.offlineQueue.listPending()
    .filter((item): item is OfflineDriverEventQueueItem => (
      item.kind === 'driver_event'
      && item.state === 'PENDING'
      && item.reconciliation === undefined
      && item.event.eventType === 'LOCATION_UPDATED'
      && item.event.routePlanId === input.routePlanId
    ))
    .slice(0, input.maxItems ?? CONTINUOUS_LOCATION_STORED_SEND_MAX_ITEMS);
  let sentCount = 0;

  for (const item of storedPoints) {
    if (now() - startedAt >= budgetMs) break;
    if (input.isSessionCurrent !== undefined && !(await input.isSessionCurrent())) break;
    try {
      await runBoundedAsyncOperation(
        (signal) => input.driverEventService.recordDriverEvent(item.event, { signal }),
        { timeoutMs: input.liveRequestTimeoutMs ?? CONTINUOUS_LOCATION_LIVE_REQUEST_TIMEOUT_MS },
      );
    } catch (error) {
      if (!isDriverRouteNotInProgressError(error)) input.offlineQueue.recordRetryFailure(item.queueItemId, error);
      break;
    }
    if (!input.offlineQueue.acknowledge(item.queueItemId)) break;
    sentCount += 1;
  }

  return { sentCount };
}

/** A 4xx answer that says nothing about the network or the session: only this point is refused. */
function isRejectionOfOnePoint(error: unknown): boolean {
  return error instanceof DriverApiHttpError
    && typeof error.status === 'number'
    && error.status >= 400
    && error.status < 500
    && ![401, 408, 409, 429].includes(error.status);
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
  assignmentGeneration?: string;
  isSessionLeaseCurrent?: () => Promise<boolean> | boolean;
  routePlanId?: string;
  sessionInstanceId?: string;
  streamService: ContinuousLocationStreamService;
  taskName?: string;
}): Promise<ContinuousLocationSessionCleanupResult> {
  let clearError: unknown;
  let cleared = false;
  try {
    if (input.isSessionLeaseCurrent !== undefined && !(await input.isSessionLeaseCurrent())) {
      return { kind: 'unchanged', taskName: input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME };
    }
    cleared = await input.activeRouteSessionStore.clearActiveRouteSession(
      input.routePlanId,
      input.sessionInstanceId,
      input.assignmentGeneration,
    );
  } catch (error) {
    clearError = error;
  }

  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  if (input.routePlanId !== undefined && !cleared && clearError === undefined) {
    return { kind: 'unchanged', taskName };
  }
  if (input.isSessionLeaseCurrent !== undefined) {
    let stopped: boolean;
    if (input.streamService.stopLocationUpdatesIfCurrent === undefined) {
      if (!(await input.isSessionLeaseCurrent())) return { kind: 'unchanged', taskName };
      await input.streamService.stopLocationUpdates(taskName);
      stopped = true;
    } else {
      stopped = await input.streamService.stopLocationUpdatesIfCurrent(taskName, input.isSessionLeaseCurrent);
    }
    if (!stopped) return { kind: 'unchanged', taskName };
    if (clearError !== undefined) throw clearError;
    return { kind: 'stopped', taskName };
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
