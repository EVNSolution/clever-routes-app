import type { DeliveryStartResult } from './deliveryStart';
import { formatDriverApiErrorForDriver, getDriverApiRequiresRouteLookup } from './driverApiError';
import type { DriverEventInput, DriverEventRecordResult, DriverEventService } from './driverEvents';
import type { OfflineSubmissionQueue } from './offlineSubmissionQueue';

export type ForegroundLocationSnapshot = {
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

export type ForegroundLocationSnapshotService = {
  getCurrentForegroundLocation(): Promise<ForegroundLocationSnapshot>;
};

export type ForegroundLocationUpdateResult =
  | (DriverEventRecordResult & { kind: 'recorded' })
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' }
  | { kind: 'queued'; message: string; queueItemId: string; reason: 'record_failed'; requiresRouteLookup?: true };

export async function recordForegroundLocationUpdateAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  locationService: ForegroundLocationSnapshotService;
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string | null;
}): Promise<ForegroundLocationUpdateResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      reason: 'delivery_not_active',
      message: 'Foreground location updates are recorded only after delivery_active.',
    };
  }

  const location = await input.locationService.getCurrentForegroundLocation();
  const event: DriverEventInput = {
    clientEventId: createClientEventId('location-updated'),
    eventType: 'LOCATION_UPDATED',
    latitude: location.latitude,
    longitude: location.longitude,
    occurredAt: location.recordedAt,
    routePlanId: input.routePlanId,
  };

  try {
    const result = await input.driverEventService.recordDriverEvent(event);

    return { ...result, kind: 'recorded' };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const queued = input.offlineQueue.enqueueDriverEvent(event);
    return {
      kind: 'queued',
      message: `Foreground location event queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
    };
  }
}

function createClientEventId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
