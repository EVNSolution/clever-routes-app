import type { DeliveryStartResult } from './deliveryStart';
import type { DriverEventRecordResult, DriverEventService } from './driverEvents';

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
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' };

export async function recordForegroundLocationUpdateAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  locationService: ForegroundLocationSnapshotService;
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
  const result = await input.driverEventService.recordDriverEvent({
    clientEventId: createClientEventId('location-updated'),
    eventType: 'LOCATION_UPDATED',
    latitude: location.latitude,
    longitude: location.longitude,
    occurredAt: location.recordedAt,
    routePlanId: input.routePlanId,
  });

  return { ...result, kind: 'recorded' };
}

function createClientEventId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
