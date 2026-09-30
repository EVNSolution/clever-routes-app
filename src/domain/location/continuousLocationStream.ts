import type { DeliveryStartResult } from '../delivery/deliveryStart';
import type { DriverAccessTokenStore } from '../driver/driverAccessTokenStore';
import type { DriverEventInput, DriverEventService } from '../events/driverEvents';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { retryOfflineSubmissions } from '../offline/offlineSubmissionQueue';
import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import { isDriverRouteNotInProgressError } from '../../api/deliveryServer/driverApiError';

export const CONTINUOUS_LOCATION_TASK_NAME = 'clever-routes-continuous-location';

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
  metadata?: {
    altitudeMeters?: number;
    headingDegrees?: number;
    mocked?: boolean;
    speedMetersPerSecond?: number;
  };
};

export type ContinuousLocationBatchRecordResult =
  | {
      kind: 'recorded';
      droppedCount?: number;
      queuedCount?: number;
      recordedCount: number;
      routeStartedAcknowledged?: true;
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
  attemptTimeoutMs?: number;
  driverEventService: DriverEventService;
  hashObservationIdentity?: (identity: string) => Promise<string>;
  isSessionCurrent?: () => Promise<boolean>;
  locations: ContinuousLocationBatchItem[];
  nativeBatchDeliveredAt?: Date;
  now?: () => Date;
  offlineQueue?: OfflineSubmissionQueue;
  orderedEventAccessIdentity?: Parameters<typeof retryOfflineSubmissions>[0]['orderedEventAccessIdentity'];
  precedingEvents?: DriverEventInput[];
  provenance?: { appVersion?: string; platform?: string; versionCode?: number };
  routePlanId: string | null;
  sessionContext?: { assignmentGeneration?: string; sessionGeneration: string };
}): Promise<ContinuousLocationBatchRecordResult> {
  const isCurrent = async () => input.isSessionCurrent === undefined || await input.isSessionCurrent();
  if (!(await isCurrent())) return { kind: 'recorded', recordedCount: 0 };
  const events: DriverEventInput[] = [];
  let droppedCount = 0;
  for (const location of input.locations) {
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90
      || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
      || !Number.isFinite(location.occurredAt.getTime())) {
      droppedCount += 1;
      continue;
    }
    const identity = JSON.stringify([
      input.routePlanId, input.sessionContext ?? null, location.occurredAt.toISOString(),
      location.latitude, location.longitude, location.accuracyMeters ?? null, location.metadata ?? null,
    ]);
    const clientEventId = input.hashObservationIdentity === undefined
      ? `continuous-location-${location.occurredAt.getTime().toString(36)}-${Math.random().toString(36).slice(2)}`
      : `continuous-location-v2-${await input.hashObservationIdentity(identity)}`;
    events.push({
      ...(location.accuracyMeters === undefined ? {} : { accuracyMeters: location.accuracyMeters }),
      ...(input.provenance?.appVersion === undefined ? {} : { appVersion: input.provenance.appVersion }),
      ...(input.provenance?.versionCode === undefined ? {} : { versionCode: input.provenance.versionCode }),
      clientEventId,
      eventType: 'LOCATION_UPDATED',
      latitude: location.latitude,
      longitude: location.longitude,
      occurredAt: location.occurredAt,
      payload: {
        source: 'continuous-location-stream',
        ...(input.nativeBatchDeliveredAt === undefined ? {} : { nativeBatchDeliveredAt: input.nativeBatchDeliveredAt.toISOString() }),
        ...(input.sessionContext === undefined ? {} : { locationContext: input.sessionContext }),
        ...(location.metadata === undefined && input.provenance?.platform === undefined ? {} : {
          locationEvidence: { ...location.metadata, ...(input.provenance?.platform === undefined ? {} : { platform: input.provenance.platform }) },
        }),
      },
      routePlanId: input.routePlanId,
    });
  }
  if (!(await isCurrent())) return { kind: 'recorded', recordedCount: 0 };
  const queue = input.offlineQueue;
  if (queue === undefined) {
    let recordedCount = 0;
    for (const event of events) {
      if (!(await isCurrent())) break;
      await runBoundedAsyncOperation((signal) => input.driverEventService.recordDriverEvent(event, { signal }), {
        timeoutMs: input.attemptTimeoutMs ?? 15_000,
      });
      recordedCount += 1;
    }
    return { kind: 'recorded', recordedCount, ...(droppedCount === 0 ? {} : { droppedCount }) };
  }
  // One capture mutation, verified in encrypted storage before any HTTP request.
  // A concurrent foreground drain can proceed while later callbacks capture.
  const items = queue.enqueueDriverEvents([...(input.precedingEvents ?? []), ...events]);
  await queue.whenPersisted();
  if (!(await isCurrent())) return { kind: 'recorded', recordedCount: 0 };
  let routeNotInProgress = false;
  await retryOfflineSubmissions({
    attemptTimeoutMs: input.attemptTimeoutMs,
    driverEventService: {
      recordDriverEvent: async (event, options) => {
        try { return await input.driverEventService.recordDriverEvent(event, options); }
        catch (error) { routeNotInProgress ||= isDriverRouteNotInProgressError(error); throw error; }
      },
    },
    driverEventTypes: ['ROUTE_STARTED', 'LOCATION_UPDATED'],
    now: input.now,
    orderedEventAccessIdentity: input.orderedEventAccessIdentity,
    proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('GPS drain cannot upload proof.'); } },
    queue,
    ...(input.routePlanId === null ? {} : { routePlanId: input.routePlanId }),
    ...(input.sessionContext?.assignmentGeneration === undefined || input.routePlanId === null ? {} : {
      locationAssignmentGeneration: input.sessionContext.assignmentGeneration,
    }),
    validateCurrent: isCurrent,
  });
  const locationItems = items.filter((item) => item.event.eventType === 'LOCATION_UPDATED');
  const recordedCount = locationItems.filter((item) => item.state === 'ACKNOWLEDGED').length;
  if (routeNotInProgress) return { kind: 'route_not_in_progress', recordedCount };
  const queuedCount = locationItems.filter((item) => item.state === 'PENDING').length;
  const result = {
    ...(droppedCount === 0 ? {} : { droppedCount }),
    ...(items.some((item) => item.event.eventType === 'ROUTE_STARTED' && item.state === 'ACKNOWLEDGED') ? { routeStartedAcknowledged: true as const } : {}),
  };
  return queuedCount > 0
    ? { kind: 'recorded', queuedCount, recordedCount, ...result }
    : { kind: 'recorded', recordedCount, ...result };
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
