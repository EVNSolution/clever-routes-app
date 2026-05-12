import type { DriverEventInput, DriverEventService, DriverEventType } from './driverEvents';
import type { ProofMediaUploadRequest, ProofMediaUploadService } from './proofMediaUpload';

export const OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY = '@clever-driver/offline-submission-queue-v1';
export const OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY = {
  maxAgeMs: 72 * 60 * 60 * 1000,
  maxAttempts: 5,
} as const;

export type OfflineSubmissionQueueRetryPolicy = {
  maxAgeMs: number;
  maxAttempts: number;
};

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
  clear(): number;
  discard(queueItemId: string): boolean;
  discardRouteSubmissions(routePlanId: string): number;
  enqueueDriverEvent(event: DriverEventInput): OfflineDriverEventQueueItem;
  enqueueProofMediaUpload(request: ProofMediaUploadRequest): OfflineProofMediaQueueItem;
  listPending(): OfflineSubmissionQueueItem[];
  recordRetryFailure(queueItemId: string, lastError: string): boolean;
  whenPersisted(): Promise<void>;
};

export type OfflineSubmissionQueueStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

export type OfflineSubmissionRetryResult = {
  discarded: number;
  failed: number;
  retried: number;
  succeeded: number;
};

export function createInMemoryOfflineSubmissionQueue(input?: {
  initialItems?: OfflineSubmissionQueueItem[];
  now?: () => Date;
  onChange?: (items: OfflineSubmissionQueueItem[]) => void;
}): OfflineSubmissionQueue {
  const items = new Map((input?.initialItems ?? []).map((item) => [item.queueItemId, item]));
  const now = input?.now ?? (() => new Date());

  function emitChange() {
    input?.onChange?.(Array.from(items.values()));
  }

  return {
    clear: () => {
      const count = items.size;
      if (count > 0) {
        items.clear();
        emitChange();
      }
      return count;
    },
    discard: (queueItemId) => {
      const deleted = items.delete(queueItemId);
      if (deleted) {
        emitChange();
      }
      return deleted;
    },
    discardRouteSubmissions: (routePlanId) => {
      const queueItemIds = Array.from(items.values())
        .filter((item) => getQueueItemRoutePlanId(item) === routePlanId)
        .map((item) => item.queueItemId);
      for (const queueItemId of queueItemIds) {
        items.delete(queueItemId);
      }
      if (queueItemIds.length > 0) {
        emitChange();
      }
      return queueItemIds.length;
    },
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
      emitChange();
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
      emitChange();
      return item;
    },
    listPending: () => Array.from(items.values()),
    recordRetryFailure: (queueItemId, lastError) => {
      const item = items.get(queueItemId);
      if (item === undefined) {
        return false;
      }

      item.attempts += 1;
      item.lastError = lastError;
      emitChange();
      return true;
    },
    whenPersisted: async () => undefined,
  };
}

export async function createPersistentOfflineSubmissionQueue(input: {
  now?: () => Date;
  storage: OfflineSubmissionQueueStorage;
  storageKey?: string;
}): Promise<OfflineSubmissionQueue> {
  const storageKey = input.storageKey ?? OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY;
  const initialItems = await readPersistedOfflineSubmissionQueueItems({
    storage: input.storage,
    storageKey,
  });
  let persistQueue = Promise.resolve();

  const queue = createInMemoryOfflineSubmissionQueue({
    initialItems,
    now: input.now,
    onChange: (items) => {
      const payload = JSON.stringify(toPersistedEnvelope(items));
      persistQueue = persistQueue
        .catch(() => undefined)
        .then(() => input.storage.setItem(storageKey, payload))
        .catch(() => undefined);
    },
  });

  return {
    ...queue,
    whenPersisted: () => persistQueue,
  };
}

export async function retryOfflineSubmissions(input: {
  driverEventService: DriverEventService;
  now?: () => Date;
  proofMediaUploadService: ProofMediaUploadService;
  queue: OfflineSubmissionQueue;
  retryPolicy?: OfflineSubmissionQueueRetryPolicy;
}): Promise<OfflineSubmissionRetryResult> {
  let discarded = 0;
  let failed = 0;
  let succeeded = 0;
  const pending = input.queue.listPending();
  const retryPolicy = input.retryPolicy ?? OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY;
  const now = input.now ?? (() => new Date());

  for (const item of pending) {
    if (shouldDiscardOfflineSubmission(item, retryPolicy, now())) {
      if (input.queue.discard(item.queueItemId)) {
        discarded += 1;
      }
      continue;
    }

    try {
      if (item.kind === 'driver_event') {
        await input.driverEventService.recordDriverEvent(item.event);
      } else {
        await input.proofMediaUploadService.uploadProofMedia(item.request);
      }
      input.queue.discard(item.queueItemId);
      succeeded += 1;
    } catch (error) {
      input.queue.recordRetryFailure(item.queueItemId, error instanceof Error ? error.message : 'unknown error');
      const updatedItem = input.queue.listPending().find((pendingItem) => pendingItem.queueItemId === item.queueItemId);
      if (updatedItem !== undefined && shouldDiscardOfflineSubmission(updatedItem, retryPolicy, now())) {
        input.queue.discard(updatedItem.queueItemId);
        discarded += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    discarded,
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

function getQueueItemRoutePlanId(item: OfflineSubmissionQueueItem): string | undefined {
  return item.kind === 'driver_event' ? item.event.routePlanId ?? undefined : item.request.routePlanId;
}

function shouldDiscardOfflineSubmission(
  item: OfflineSubmissionQueueItem,
  retryPolicy: OfflineSubmissionQueueRetryPolicy,
  now: Date,
): boolean {
  if (item.attempts >= retryPolicy.maxAttempts) {
    return true;
  }

  const enqueuedAtMs = Date.parse(item.enqueuedAt);
  if (Number.isNaN(enqueuedAtMs)) {
    return true;
  }

  return now.getTime() - enqueuedAtMs > retryPolicy.maxAgeMs;
}

async function readPersistedOfflineSubmissionQueueItems(input: {
  storage: OfflineSubmissionQueueStorage;
  storageKey: string;
}): Promise<OfflineSubmissionQueueItem[]> {
  const raw = await input.storage.getItem(input.storageKey);
  if (raw === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = readPersistedEnvelope(parsed);
    if (items === null) {
      await input.storage.removeItem(input.storageKey);
      return [];
    }

    return items;
  } catch {
    await input.storage.removeItem(input.storageKey);
    return [];
  }
}

function toPersistedEnvelope(items: OfflineSubmissionQueueItem[]): Record<string, unknown> {
  return {
    items: items.map(toPersistedQueueItem),
    version: 1,
  };
}

function toPersistedQueueItem(item: OfflineSubmissionQueueItem): Record<string, unknown> {
  const base = {
    attempts: item.attempts,
    enqueuedAt: item.enqueuedAt,
    kind: item.kind,
    ...(item.lastError === undefined ? {} : { lastError: item.lastError }),
    queueItemId: item.queueItemId,
  };

  if (item.kind === 'driver_event') {
    return {
      ...base,
      event: {
        ...item.event,
        occurredAt: item.event.occurredAt.toISOString(),
      },
    };
  }

  return {
    ...base,
    request: item.request,
  };
}

function readPersistedEnvelope(value: unknown): OfflineSubmissionQueueItem[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !Array.isArray(data.items)) {
    return null;
  }

  const items: OfflineSubmissionQueueItem[] = [];
  for (const item of data.items) {
    const parsed = readPersistedQueueItem(item);
    if (parsed === null) {
      return null;
    }
    items.push(parsed);
  }

  return items;
}

function readPersistedQueueItem(value: unknown): OfflineSubmissionQueueItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const attempts = readNonNegativeNumber(data.attempts);
  const enqueuedAt = readRequiredString(data.enqueuedAt);
  const queueItemId = readRequiredString(data.queueItemId);
  const lastError = readOptionalString(data.lastError);

  if (attempts === null || enqueuedAt === null || queueItemId === null || lastError === null) {
    return null;
  }

  if (data.kind === 'driver_event') {
    const event = readPersistedDriverEvent(data.event);
    if (event === null) {
      return null;
    }

    return {
      attempts,
      enqueuedAt,
      event,
      kind: 'driver_event',
      ...(lastError === undefined ? {} : { lastError }),
      queueItemId,
    };
  }

  if (data.kind === 'proof_media') {
    const request = readPersistedProofMediaRequest(data.request);
    if (request === null) {
      return null;
    }

    return {
      attempts,
      enqueuedAt,
      kind: 'proof_media',
      ...(lastError === undefined ? {} : { lastError }),
      queueItemId,
      request,
    };
  }

  return null;
}

function readPersistedDriverEvent(value: unknown): DriverEventInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const clientEventId = readRequiredString(data.clientEventId);
  const eventType = readDriverEventType(data.eventType);
  const occurredAt = readDate(data.occurredAt);
  const deliveryStopId = readOptionalNullableString(data.deliveryStopId);
  const latitude = readOptionalNullableNumber(data.latitude);
  const longitude = readOptionalNullableNumber(data.longitude);
  const payload = readOptionalRecord(data.payload);
  const routePlanId = readOptionalNullableString(data.routePlanId);

  if (
    clientEventId === null
    || eventType === null
    || occurredAt === null
    || deliveryStopId === null
    || latitude === null
    || longitude === null
    || payload === null
    || routePlanId === null
  ) {
    return null;
  }

  return {
    clientEventId,
    ...(deliveryStopId === undefined ? {} : { deliveryStopId }),
    eventType,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    occurredAt,
    ...(payload === undefined ? {} : { payload }),
    ...(routePlanId === undefined ? {} : { routePlanId }),
  };
}

function readPersistedProofMediaRequest(value: unknown): ProofMediaUploadRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const deliveryStopId = readRequiredString(data.deliveryStopId);
  const fileName = readRequiredString(data.fileName);
  const routePlanId = readRequiredString(data.routePlanId);
  const source = data.source === 'camera' || data.source === 'library' ? data.source : null;
  const uri = readRequiredString(data.uri);

  if (deliveryStopId === null || fileName === null || routePlanId === null || source === null || uri === null) {
    return null;
  }

  return {
    deliveryStopId,
    fileName,
    routePlanId,
    source,
    uri,
  };
}

function readDriverEventType(value: unknown): DriverEventType | null {
  const allowed: DriverEventType[] = [
    'LOCATION_UPDATED',
    'ROUTE_COMPLETED',
    'ROUTE_PAUSED',
    'ROUTE_STARTED',
    'STOP_ARRIVED',
    'STOP_DELIVERED',
    'STOP_FAILED',
  ];
  return allowed.includes(value as DriverEventType) ? value as DriverEventType : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'string' ? value : null;
}

function readOptionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : null;
}

function readOptionalNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
