import type { DeliveryStartResult } from '../delivery/deliveryStart';
import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import {
  formatDriverApiErrorForDriver,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import {
  prepareDriverEventForPersistence,
  type DriverEventRecordResult,
  type DriverEventService,
  type DriverEventType,
} from '../events/driverEvents';
import { DeliveryProofUploadPendingError, getStopCompletionReconciliationReason, type OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { matchesStopCompletionEvent, readStopCompletionInput, type StopCompletionInput } from './stopCompletion';
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
  clientEventId?: string;
  completion?: StopCompletionInput;
  deliveryStopId: string;
  media?: ProofMediaReference[];
  localMedia?: { kind: 'photo' | 'signature'; uri: string }[];
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
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  input: StopProofEventInput;
  offlineQueue?: OfflineSubmissionQueue;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
}): Promise<StopProofEventResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Stop proof events are recorded only after delivery_active.',
      reason: 'delivery_not_active',
    };
  }

  if (input.input.completion !== undefined) {
    if (input.offlineQueue === undefined) throw new Error('Completion requires durable offline storage.');
    const existingReceipt = input.offlineQueue.getStopCompletion(input.input.routePlanId, input.input.deliveryStopId);
    if (existingReceipt !== null) {
      return { kind: 'recorded', status: 'recorded', duplicate: true, eventId: existingReceipt.eventId, completion: existingReceipt };
    }
    const pending = input.offlineQueue.listPending().find((item) => item.kind === 'driver_event'
      && item.event.routePlanId === input.input.routePlanId && item.event.deliveryStopId === input.input.deliveryStopId
      && (item.event.eventType === 'STOP_DELIVERED' || item.event.eventType === 'STOP_FAILED'));
    if (pending !== undefined) {
      return { kind: 'queued', message: pending.reconciliation === undefined
        ? 'Completion is saved and waiting for server confirmation. Do not collect Cash again.'
        : 'Completion needs office review. The original Cash amount is preserved.',
      queueItemId: pending.queueItemId, reason: 'record_failed',
      ...(pending.reconciliation === undefined ? {} : { requiresRouteReconciliation: true as const }) };
    }
    if (input.input.action !== 'delivered' || readStopCompletionInput(input.input.completion) === null) {
      throw new Error('Invalid stop completion input.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.input.clientEventId ?? '')) {
      throw new Error('Completion requires a new globally unique UUID.');
    }
  }
  const ownerAtStart = input.offlineQueue?.getAccountOwnerHash();
  const event = prepareDriverEventForPersistence(input.driverEventService, {
    clientEventId: input.input.clientEventId ?? createClientEventId(`stop-${input.input.action}`),
    ...(input.input.completion === undefined ? {} : { completion: JSON.parse(JSON.stringify(input.input.completion)) as StopCompletionInput }),
    deliveryStopId: input.input.deliveryStopId,
    eventType: getStopProofEventType(input.input.action),
    occurredAt: input.input.occurredAt ?? new Date(),
    payload: { proof: getStopProofPayload(input.input) },
    routePlanId: input.input.routePlanId,
  });
  if (event.completion !== undefined && (event.driverContractVersion !== 2
    || event.assignmentGeneration === undefined || event.expectedRouteVersionId === undefined)) {
    throw new Error('Completion requires the original assignment and publication identity.');
  }
  const queued = input.offlineQueue?.enqueueDriverEvent(event);
  const persistedEvent = queued?.event ?? event;

  if (input.offlineQueue !== undefined) {
    await input.offlineQueue.whenPersisted();
  }

  if (input.offlineQueue !== undefined && queued !== undefined && input.offlineQueue.getAccountOwnerHash() !== ownerAtStart) {
    return { kind: 'queued', message: 'Completion remains saved for the original account.', queueItemId: queued.queueItemId, reason: 'record_failed' };
  }

  let result: DriverEventRecordResult;
  try {
    result = await runBoundedAsyncOperation(
      (signal) => input.driverEventService.recordDriverEvent(persistedEvent, { signal }),
      {
        ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
        ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
        timeoutMs: input.attemptTimeoutMs ?? 15_000,
      },
    );
    if (persistedEvent.completion !== undefined && (result.completion === undefined
      || !matchesStopCompletionEvent(result.completion, persistedEvent))) {
      throw new Error('Server completion receipt is missing. The saved Cash amount requires confirmation.');
    }
  } catch (error) {
    if (input.offlineQueue === undefined || queued === undefined) {
      throw error;
    }

    if (input.offlineQueue.getAccountOwnerHash() !== ownerAtStart) {
      return { kind: 'queued', message: 'Completion remains saved for the original account.', queueItemId: queued.queueItemId, reason: 'record_failed' };
    }
    const completionReason = persistedEvent.completion === undefined ? undefined : getStopCompletionReconciliationReason(error);
    const requiresRouteReconciliation = completionReason === undefined ? getDriverApiRequiresRouteReconciliation(error) : true;
    if (persistedEvent.completion !== undefined && !(error instanceof DeliveryProofUploadPendingError)) input.offlineQueue.recordRetryFailure(queued.queueItemId, error);
    if (completionReason !== undefined) input.offlineQueue.quarantine(queued.queueItemId, completionReason);
    if (requiresRouteReconciliation === true && completionReason === undefined) {
      input.offlineQueue.blockRouteSubmissionsForReconciliation(input.input.routePlanId);
    }
    await input.offlineQueue.whenPersisted();
    return {
      kind: 'queued',
      message: completionReason === 'completion_input_invalid'
        ? 'Cash input was rejected. The original input is saved for review. Automatic retries stopped.'
        : completionReason !== undefined
          ? 'Completion conflicts with the server. The original Cash amount is saved for office review.'
          : `Stop proof event queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
      ...(requiresRouteReconciliation === undefined
        ? {}
        : { requiresRouteReconciliation: true as const }),
    };
  }

  if (input.offlineQueue !== undefined && queued !== undefined) {
    if (input.offlineQueue.getAccountOwnerHash() !== ownerAtStart) {
      return { kind: 'queued', message: 'Completion remains saved for the original account.', queueItemId: queued.queueItemId, reason: 'record_failed' };
    }
    input.offlineQueue.acknowledge(queued.queueItemId, result.completion);
    await input.offlineQueue.whenPersisted();
  }

  return { ...result, kind: 'recorded' };
}

function getStopProofEventType(action: StopProofAction): Extract<DriverEventType, 'STOP_DELIVERED' | 'STOP_FAILED'> {
  return action === 'delivered' ? 'STOP_DELIVERED' : 'STOP_FAILED';
}

function getStopProofPayload(input: StopProofEventInput): Record<string, unknown> {
  const media = [
    ...getProofMedia(input.photoUris ?? []),
    ...(input.media ?? []),
    ...(input.localMedia ?? []).map(media => ({ ...media, requiresUpload: true })),
  ];
  const signatures = input.signatures ?? [];
  const photoMediaId = input.media?.find(item => item.kind === 'photo')?.mediaId;
  const signatureMediaId = input.media?.find(item => item.kind === 'signature')?.mediaId;

  if (input.action === 'delivered') {
    return {
      ...(media.length === 0 ? {} : { media }),
      ...(photoMediaId === undefined ? {} : { photoMediaId }),
      ...(signatureMediaId === undefined ? {} : { signatureMediaId }),
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
