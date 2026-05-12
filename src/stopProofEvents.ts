import type { DeliveryStartResult } from './deliveryStart';
import type { DriverEventRecordResult, DriverEventService, DriverEventType } from './driverEvents';
import type { OfflineSubmissionQueue } from './offlineSubmissionQueue';
import type { ProofBarcodeReference } from './proofBarcodeCapture';
import type { ProofMediaReference } from './proofMediaUpload';
import type { ProofSignatureReference } from './proofSignatureCapture';

export type StopProofAction = 'delivered' | 'failed';
export type StopProofFailureReason = 'CUSTOMER_UNAVAILABLE' | 'DAMAGED' | 'INACCESSIBLE' | 'OTHER';

export type StopProofEventInput = {
  action: StopProofAction;
  barcodes?: ProofBarcodeReference[];
  deliveryStopId: string;
  media?: ProofMediaReference[];
  note: string;
  occurredAt?: Date;
  photoUris?: string[];
  reason?: StopProofFailureReason;
  routePlanId: string;
  signatures?: ProofSignatureReference[];
};

export type StopProofEventResult =
  | (DriverEventRecordResult & { kind: 'recorded' })
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' }
  | { kind: 'queued'; message: string; queueItemId: string; reason: 'record_failed' };

export async function recordStopProofEventAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  input: StopProofEventInput;
  offlineQueue?: OfflineSubmissionQueue;
}): Promise<StopProofEventResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Stop proof events are recorded only after delivery_active.',
      reason: 'delivery_not_active',
    };
  }

  const event = {
    clientEventId: createClientEventId(`stop-${input.input.action}`),
    deliveryStopId: input.input.deliveryStopId,
    eventType: getStopProofEventType(input.input.action),
    occurredAt: input.input.occurredAt ?? new Date(),
    payload: { proof: getStopProofPayload(input.input) },
    routePlanId: input.input.routePlanId,
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
      message: `Stop proof event queued for retry: ${error instanceof Error ? error.message : 'unknown error'}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
    };
  }
}

function getStopProofEventType(action: StopProofAction): Extract<DriverEventType, 'STOP_DELIVERED' | 'STOP_FAILED'> {
  return action === 'delivered' ? 'STOP_DELIVERED' : 'STOP_FAILED';
}

function getStopProofPayload(input: StopProofEventInput): Record<string, unknown> {
  const media = [
    ...getProofMedia(input.photoUris ?? []),
    ...(input.media ?? []),
  ];
  const barcodes = input.barcodes ?? [];
  const signatures = input.signatures ?? [];

  if (input.action === 'delivered') {
    return {
      ...(barcodes.length === 0 ? {} : { barcodes }),
      ...(media.length === 0 ? {} : { media }),
      note: input.note,
      ...(signatures.length === 0 ? {} : { signatures }),
      source: 'driver-app-mvp',
      type: 'DELIVERED_NOTE',
    };
  }

  return {
    ...(barcodes.length === 0 ? {} : { barcodes }),
    ...(media.length === 0 ? {} : { media }),
    note: input.note,
    reason: input.reason ?? 'OTHER',
    ...(signatures.length === 0 ? {} : { signatures }),
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
