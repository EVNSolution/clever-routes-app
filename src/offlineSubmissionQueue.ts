import type { DriverEventInput, DriverEventService } from './driverEvents';
import type { ProofMediaUploadRequest, ProofMediaUploadService } from './proofMediaUpload';

export type OfflineDriverEventQueueItem = {
  attempts: number;
  enqueuedAt: string;
  event: DriverEventInput;
  kind: 'driver_event';
  lastError?: string;
  queueItemId: string;
};

export type OfflineProofMediaQueueItem = {
  attempts: number;
  enqueuedAt: string;
  kind: 'proof_media';
  lastError?: string;
  queueItemId: string;
  request: ProofMediaUploadRequest;
};

export type OfflineSubmissionQueueItem = OfflineDriverEventQueueItem | OfflineProofMediaQueueItem;

export type OfflineSubmissionQueue = {
  discard(queueItemId: string): boolean;
  enqueueDriverEvent(event: DriverEventInput): OfflineDriverEventQueueItem;
  enqueueProofMediaUpload(request: ProofMediaUploadRequest): OfflineProofMediaQueueItem;
  listPending(): OfflineSubmissionQueueItem[];
};

export type OfflineSubmissionRetryResult = {
  failed: number;
  retried: number;
  succeeded: number;
};

export function createInMemoryOfflineSubmissionQueue(input?: {
  now?: () => Date;
}): OfflineSubmissionQueue {
  const items = new Map<string, OfflineSubmissionQueueItem>();
  const now = input?.now ?? (() => new Date());

  return {
    discard: (queueItemId) => items.delete(queueItemId),
    enqueueDriverEvent: (event) => {
      const queueItemId = getDriverEventQueueItemId(event);
      const existing = items.get(queueItemId);
      if (existing?.kind === 'driver_event') {
        return existing;
      }

      const item: OfflineDriverEventQueueItem = {
        attempts: 0,
        enqueuedAt: now().toISOString(),
        event,
        kind: 'driver_event',
        queueItemId,
      };
      items.set(queueItemId, item);
      return item;
    },
    enqueueProofMediaUpload: (request) => {
      const queueItemId = getProofMediaQueueItemId(request);
      const existing = items.get(queueItemId);
      if (existing?.kind === 'proof_media') {
        return existing;
      }

      const item: OfflineProofMediaQueueItem = {
        attempts: 0,
        enqueuedAt: now().toISOString(),
        kind: 'proof_media',
        queueItemId,
        request,
      };
      items.set(queueItemId, item);
      return item;
    },
    listPending: () => Array.from(items.values()),
  };
}

export async function retryOfflineSubmissions(input: {
  driverEventService: DriverEventService;
  proofMediaUploadService: ProofMediaUploadService;
  queue: OfflineSubmissionQueue;
}): Promise<OfflineSubmissionRetryResult> {
  let failed = 0;
  let succeeded = 0;
  const pending = input.queue.listPending();

  for (const item of pending) {
    try {
      if (item.kind === 'driver_event') {
        await input.driverEventService.recordDriverEvent(item.event);
      } else {
        await input.proofMediaUploadService.uploadProofMedia(item.request);
      }
      input.queue.discard(item.queueItemId);
      succeeded += 1;
    } catch (error) {
      item.attempts += 1;
      item.lastError = error instanceof Error ? error.message : 'unknown error';
      failed += 1;
    }
  }

  return {
    failed,
    retried: pending.length,
    succeeded,
  };
}

function getDriverEventQueueItemId(event: DriverEventInput): string {
  return `driver-event:${event.clientEventId}`;
}

function getProofMediaQueueItemId(request: ProofMediaUploadRequest): string {
  return `proof-media:${request.routePlanId}:${request.deliveryStopId}:${request.fileName}`;
}
