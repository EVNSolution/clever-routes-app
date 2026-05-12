import type { DeliveryStartResult } from './deliveryStart';
import type { DriverEventRecordResult, DriverEventService, DriverEventType } from './driverEvents';

export type StopProofAction = 'delivered' | 'failed';
export type StopProofFailureReason = 'CUSTOMER_UNAVAILABLE' | 'DAMAGED' | 'INACCESSIBLE' | 'OTHER';

export type StopProofEventInput = {
  action: StopProofAction;
  deliveryStopId: string;
  note: string;
  occurredAt?: Date;
  photoUris?: string[];
  reason?: StopProofFailureReason;
  routePlanId: string;
};

export type StopProofEventResult =
  | (DriverEventRecordResult & { kind: 'recorded' })
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' };

export async function recordStopProofEventAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  input: StopProofEventInput;
}): Promise<StopProofEventResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Stop proof events are recorded only after delivery_active.',
      reason: 'delivery_not_active',
    };
  }

  const result = await input.driverEventService.recordDriverEvent({
    clientEventId: createClientEventId(`stop-${input.input.action}`),
    deliveryStopId: input.input.deliveryStopId,
    eventType: getStopProofEventType(input.input.action),
    occurredAt: input.input.occurredAt ?? new Date(),
    payload: { proof: getStopProofPayload(input.input) },
    routePlanId: input.input.routePlanId,
  });

  return { ...result, kind: 'recorded' };
}

function getStopProofEventType(action: StopProofAction): Extract<DriverEventType, 'STOP_DELIVERED' | 'STOP_FAILED'> {
  return action === 'delivered' ? 'STOP_DELIVERED' : 'STOP_FAILED';
}

function getStopProofPayload(input: StopProofEventInput): Record<string, unknown> {
  const media = getProofMedia(input.photoUris ?? []);

  if (input.action === 'delivered') {
    return {
      ...(media.length === 0 ? {} : { media }),
      note: input.note,
      source: 'driver-app-mvp',
      type: 'DELIVERED_NOTE',
    };
  }

  return {
    ...(media.length === 0 ? {} : { media }),
    note: input.note,
    reason: input.reason ?? 'OTHER',
    source: 'driver-app-mvp',
    type: 'FAILED_REASON',
  };
}

function getProofMedia(photoUris: string[]): { kind: 'photo'; uri: string }[] {
  return photoUris
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0)
    .map((uri) => ({ kind: 'photo', uri }));
}

function createClientEventId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
