import type { DeliveryStartResult } from '../delivery/deliveryStart';
import {
  formatDriverApiErrorForDriver,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import type { DriverEventRecordResult, DriverEventService, DriverEventType } from '../events/driverEvents';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import type { ProofMediaReference } from '../proof/proofMediaUpload';
import type { ProofSignatureReference } from '../proof/proofSignatureCapture';

export type StopProofAction = 'delivered' | 'failed';
export type StopProofFailureReason =
  | 'ADMIN_ROUTE_ASSIGNMENT_ERROR'
  | 'CUSTOMER_UNAVAILABLE'
  | 'DAMAGED'
  | 'INACCESSIBLE'
  | 'OTHER';

export type StopProofEventInput = {
  action: StopProofAction;
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
  | {
    kind: 'queued';
    message: string;
    queueItemId: string;
    reason: 'record_failed';
    requiresRouteLookup?: true;
    requiresRouteReconciliation?: true;
  };

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
    const requiresRouteReconciliation = getDriverApiRequiresRouteReconciliation(error);
    if (requiresRouteReconciliation === true) {
      input.offlineQueue.blockRouteSubmissionsForReconciliation(input.input.routePlanId);
    }
    await input.offlineQueue.whenPersisted();
    return {
      kind: 'queued',
      message: `Stop proof event queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
      ...(requiresRouteReconciliation === undefined
        ? {}
        : { requiresRouteReconciliation: true as const }),
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
  const signatures = input.signatures ?? [];

  if (input.action === 'delivered') {
    return {
      ...(media.length === 0 ? {} : { media }),
      note: input.note,
      ...(signatures.length === 0 ? {} : { signatures }),
      source: 'clever-routes-app',
      type: 'DELIVERED_NOTE',
    };
  }

  return {
    ...(media.length === 0 ? {} : { media }),
    note: input.note,
    reason: input.reason ?? 'OTHER',
    ...(signatures.length === 0 ? {} : { signatures }),
    source: 'clever-routes-app',
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
