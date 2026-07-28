import type { DriverEventInput, DriverEventService, DriverEventType } from '../events/driverEvents';
import {
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import {
  isProofMediaRejectedError,
  type ProofMediaUploadRequest,
  type ProofMediaUploadService,
} from '../proof/proofMediaUpload';

export const OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY = '@clever-driver/offline-submission-queue-v1';
export const OFFLINE_SUBMISSION_QUEUE_MAX_ITEMS = 4_000;
export const OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY = {
  maxAgeMs: 72 * 60 * 60 * 1000,
  maxAttempts: 5,
} as const;

export type OfflineSubmissionQueueRetryPolicy = {
  maxAgeMs: number;
  maxAttempts: number;
};

export type OfflineSubmissionReconciliation = {
  blockedAt: string;
  reason: 'route_not_in_progress';
};

export type OfflineDriverEventQueueItem = {
  attempts: number;
  enqueuedAt: string;
  event: DriverEventInput;
  kind: 'driver_event';
  lastError?: string;
  queueItemId: string;
  reconciliation?: OfflineSubmissionReconciliation;
};

export type OfflineProofMediaQueueItem = {
  attempts: number;
  enqueuedAt: string;
  kind: 'proof_media';
  lastError?: string;
  queueItemId: string;
  reconciliation?: OfflineSubmissionReconciliation;
  request: ProofMediaUploadRequest;
};

export type OfflineSubmissionQueueItem = OfflineDriverEventQueueItem | OfflineProofMediaQueueItem;

export type OfflineSubmissionQueue = {
  blockRouteSubmissionsForReconciliation(routePlanId: string): { blocked: number; discarded: number };
  clear(): number;
  discard(queueItemId: string): boolean;
  discardRouteSubmissions(routePlanId: string): number;
  enqueueDriverEvent(event: DriverEventInput): OfflineDriverEventQueueItem;
  enqueueDriverEvents(events: DriverEventInput[]): OfflineDriverEventQueueItem[];
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
  blocked?: number;
  discarded: number;
  failed: number;
  reconciliationRoutePlanIds?: string[];
  requiresRouteLookup?: true;
  retried: number;
  succeeded: number;
};

export type OfflineSubmissionQueueSummary = {
  blockedCount: number;
  reconciliationRoutePlanIds: string[];
  retryableCount: number;
  totalCount: number;
};

export type PendingRouteEnd = 'completed' | 'released';

const ROUTE_WORKFLOW_EVENT_TYPES = new Set<DriverEventType>([
  'ROUTE_COMPLETED',
  'ROUTE_PAUSED',
  'ROUTE_STARTED',
  'STOP_ARRIVED',
  'STOP_DELIVERED',
  'STOP_FAILED',
]);

export function getPendingRouteEnd(queue: OfflineSubmissionQueue, routePlanId: string): PendingRouteEnd | null {
  const pending = queue.listPending().filter((item) => item.reconciliation === undefined);
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const item = pending[index];
    if (item?.kind !== 'driver_event' || item.event.routePlanId !== routePlanId) {
      continue;
    }
    if (item.event.eventType === 'ROUTE_COMPLETED') {
      return 'completed';
    }
    if (item.event.eventType === 'ROUTE_PAUSED') {
      return 'released';
    }
  }

  return null;
}

export function createRouteOrderedDriverEventService(input: {
  driverEventService: DriverEventService;
  queue: OfflineSubmissionQueue;
  routePlanId: string;
}): DriverEventService {
  return {
    recordDriverEvent: async (event) => {
      if (
        ROUTE_WORKFLOW_EVENT_TYPES.has(event.eventType)
        && input.queue.listPending().some((item) => (
          item.kind === 'driver_event'
          && item.event.routePlanId === input.routePlanId
          && item.event.clientEventId !== event.clientEventId
          && item.reconciliation === undefined
          && ROUTE_WORKFLOW_EVENT_TYPES.has(item.event.eventType)
        ))
      ) {
        throw new Error('Earlier route updates are waiting to sync. This update will be queued in order.');
      }

      return input.driverEventService.recordDriverEvent(event);
    },
  };
}

export function createInMemoryOfflineSubmissionQueue(input?: {
  initialItems?: OfflineSubmissionQueueItem[];
  maxItems?: number;
  now?: () => Date;
  onChange?: (items: OfflineSubmissionQueueItem[]) => void;
}): OfflineSubmissionQueue {
  const items = new Map((input?.initialItems ?? []).map((item) => [item.queueItemId, item]));
  const now = input?.now ?? (() => new Date());
  const maxItems = normalizeMaxItems(input?.maxItems);

  function emitChange() {
    input?.onChange?.(Array.from(items.values()));
  }

  function upsertDriverEvent(event: DriverEventInput): {
    inserted: boolean;
    item: OfflineDriverEventQueueItem;
  } {
    const queueItemId = getDriverEventQueueItemId(event);
    const existing = items.get(queueItemId);
    if (existing?.kind === 'driver_event') {
      return { inserted: false, item: existing };
    }

    const item: OfflineDriverEventQueueItem = {
      attempts: 0,
      enqueuedAt: now().toISOString(),
      event,
      kind: 'driver_event',
      queueItemId,
    };
    items.set(queueItemId, item);
    return { inserted: true, item };
  }

  const initialDiscarded = trimOfflineSubmissionQueue(items, maxItems);
  const queue: OfflineSubmissionQueue = {
    blockRouteSubmissionsForReconciliation: (routePlanId) => {
      const blockedAt = now().toISOString();
      let blocked = 0;
      let discarded = 0;
      for (const item of Array.from(items.values())) {
        if (getQueueItemRoutePlanId(item) !== routePlanId) {
          continue;
        }
        if (isTerminalStopDriverEvent(item) || item.kind === 'proof_media') {
          if (item.reconciliation === undefined) {
            item.reconciliation = { blockedAt, reason: 'route_not_in_progress' };
            blocked += 1;
          }
          continue;
        }
        items.delete(item.queueItemId);
        discarded += 1;
      }
      if (blocked > 0 || discarded > 0) {
        emitChange();
      }
      return { blocked, discarded };
    },
    clear: () => {
      const count = items.size;
      items.clear();
      emitChange();
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
        .filter((item) => item.kind !== 'proof_media' && !isTerminalStopDriverEvent(item))
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
      const result = upsertDriverEvent(event);
      if (result.inserted) {
        trimOfflineSubmissionQueue(items, maxItems);
        emitChange();
      }
      return result.item;
    },
    enqueueDriverEvents: (events) => {
      const results = events.map(upsertDriverEvent);
      if (results.some((result) => result.inserted)) {
        trimOfflineSubmissionQueue(items, maxItems);
        emitChange();
      }
      return results.map((result) => result.item);
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
      trimOfflineSubmissionQueue(items, maxItems);
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

  if (initialDiscarded > 0) {
    emitChange();
  }
  return queue;
}

export async function createPersistentOfflineSubmissionQueue(input: {
  maxItems?: number;
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
    maxItems: input.maxItems,
    now: input.now,
    onChange: (items) => {
      const payload = JSON.stringify(toPersistedEnvelope(items));
      persistQueue = persistQueue
        .catch(() => undefined)
        .then(() => items.length === 0
          ? input.storage.removeItem(storageKey)
          : input.storage.setItem(storageKey, payload));
      void persistQueue.catch(() => undefined);
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
  routePlanId?: string;
  retryPolicy?: OfflineSubmissionQueueRetryPolicy;
}): Promise<OfflineSubmissionRetryResult> {
  let blocked = 0;
  let discarded = 0;
  let failed = 0;
  let requiresRouteLookup: true | undefined;
  let retried = 0;
  let succeeded = 0;
  const pending = input.queue.listPending().filter((item) => (
    item.reconciliation === undefined
    && (input.routePlanId === undefined || getQueueItemRoutePlanId(item) === input.routePlanId)
  ));
  const retryPolicy = input.retryPolicy ?? OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY;
  const now = input.now ?? (() => new Date());
  const completedRoutePlanIds = new Set<string>();
  const reconciliationRoutePlanIds = new Set<string>();

  for (const item of pending) {
    const routePlanId = getQueueItemRoutePlanId(item);
    if (routePlanId !== undefined && reconciliationRoutePlanIds.has(routePlanId)) {
      continue;
    }
    if (
      routePlanId !== undefined
      && completedRoutePlanIds.has(routePlanId)
      && !isTerminalStopDriverEvent(item)
    ) {
      continue;
    }
    retried += 1;

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
      if (
        item.kind === 'driver_event'
        && item.event.eventType === 'ROUTE_COMPLETED'
        && item.event.routePlanId !== null
        && item.event.routePlanId !== undefined
      ) {
        completedRoutePlanIds.add(item.event.routePlanId);
        discarded += input.queue.discardRouteSubmissions(item.event.routePlanId);
      }
    } catch (error) {
      if (
        routePlanId !== undefined
        && getDriverApiRequiresRouteReconciliation(error) === true
      ) {
        const recovery = input.queue.blockRouteSubmissionsForReconciliation(routePlanId);
        blocked += recovery.blocked;
        discarded += recovery.discarded;
        reconciliationRoutePlanIds.add(routePlanId);
        continue;
      }
      if (item.kind === 'proof_media' && isProofMediaRejectedError(error)) {
        if (input.queue.discard(item.queueItemId)) {
          discarded += 1;
        }
        continue;
      }

      requiresRouteLookup ??= getDriverApiRequiresRouteLookup(error);
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
    ...(blocked === 0 ? {} : { blocked }),
    discarded,
    failed,
    ...(reconciliationRoutePlanIds.size === 0
      ? {}
      : { reconciliationRoutePlanIds: [...reconciliationRoutePlanIds] }),
    ...(requiresRouteLookup === undefined ? {} : { requiresRouteLookup }),
    retried,
    succeeded,
  };
}

export function getOfflineSubmissionQueueSummary(queue: OfflineSubmissionQueue): OfflineSubmissionQueueSummary {
  const items = queue.listPending();
  const blockedItems = items.filter((item) => item.reconciliation !== undefined);
  return {
    blockedCount: blockedItems.length,
    reconciliationRoutePlanIds: [...new Set(blockedItems.flatMap((item) => {
      const routePlanId = getQueueItemRoutePlanId(item);
      return routePlanId === undefined ? [] : [routePlanId];
    }))].sort(),
    retryableCount: items.length - blockedItems.length,
    totalCount: items.length,
  };
}

function normalizeMaxItems(maxItems: number | undefined): number {
  return maxItems !== undefined && Number.isInteger(maxItems) && maxItems > 0
    ? maxItems
    : OFFLINE_SUBMISSION_QUEUE_MAX_ITEMS;
}

function trimOfflineSubmissionQueue(
  items: Map<string, OfflineSubmissionQueueItem>,
  maxItems: number,
): number {
  let discarded = 0;
  while (items.size > maxItems) {
    const oldestLocation = Array.from(items.values()).find((item) => (
      item.reconciliation === undefined
      && item.kind === 'driver_event'
      && item.event.eventType === 'LOCATION_UPDATED'
    ));
    const oldestRetryable = Array.from(items.values()).find((item) => item.reconciliation === undefined);
    const oldest = oldestLocation ?? oldestRetryable;
    if (oldest === undefined) {
      break;
    }
    items.delete(oldest.queueItemId);
    discarded += 1;
  }
  return discarded;
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

function isTerminalStopDriverEvent(item: OfflineSubmissionQueueItem): boolean {
  return item.kind === 'driver_event' && (
    item.event.eventType === 'STOP_DELIVERED' || item.event.eventType === 'STOP_FAILED'
  );
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
    ...(item.reconciliation === undefined ? {} : { reconciliation: item.reconciliation }),
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
  const reconciliation = readOptionalReconciliation(data.reconciliation);

  if (
    attempts === null
    || enqueuedAt === null
    || queueItemId === null
    || lastError === null
    || reconciliation === null
  ) {
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
      ...(reconciliation === undefined ? {} : { reconciliation }),
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
      ...(reconciliation === undefined ? {} : { reconciliation }),
      request,
    };
  }

  return null;
}

function readOptionalReconciliation(value: unknown): OfflineSubmissionReconciliation | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const blockedAt = readRequiredString((value as Record<string, unknown>).blockedAt);
  const reason = (value as Record<string, unknown>).reason;
  if (blockedAt === null || reason !== 'route_not_in_progress') {
    return null;
  }
  return { blockedAt, reason };
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
