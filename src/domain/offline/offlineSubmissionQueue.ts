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

export const OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY = '@clever-routes/offline-submission-queue-v1';
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
  reason: 'account_signed_out' | 'retry_policy_exceeded' | 'route_not_in_progress';
};

export type OfflineEvidenceState = 'ACKNOWLEDGED' | 'DISCARDED' | 'PENDING' | 'QUARANTINED';

export type OfflineEvidenceJournalEntry = {
  at: string;
  code: string;
  kind: 'ACK' | 'ATTEMPT' | 'DISCARD' | 'ENQUEUED' | 'RECONCILIATION';
};

type OfflineEvidenceIdentity = {
  accountOwnerHash: string;
  journal: OfflineEvidenceJournalEntry[];
  queueSequence: number;
  state: OfflineEvidenceState;
};

export type OfflineDriverEventQueueItem = OfflineEvidenceIdentity & {
  attempts: number;
  enqueuedAt: string;
  event: DriverEventInput;
  firstErrorCode?: string;
  kind: 'driver_event';
  lastErrorCode?: string;
  queueItemId: string;
  reconciliation?: OfflineSubmissionReconciliation;
};

export type OfflineProofMediaQueueItem = OfflineEvidenceIdentity & {
  attempts: number;
  enqueuedAt: string;
  firstErrorCode?: string;
  kind: 'proof_media';
  lastErrorCode?: string;
  queueItemId: string;
  reconciliation?: OfflineSubmissionReconciliation;
  request: ProofMediaUploadRequest;
};

export type OfflineSubmissionQueueItem = OfflineDriverEventQueueItem | OfflineProofMediaQueueItem;

export type OfflineSubmissionQueue = {
  acknowledge(queueItemId: string): boolean;
  bindAccountOwnerHash(accountOwnerHash: string): void;
  blockRouteSubmissionsForReconciliation(routePlanId: string): { blocked: number; discarded: number };
  clear(): number;
  completeAccountDeletionAfterServerAudit(): number;
  discard(queueItemId: string): boolean;
  discardReconciliationRecords(): number;
  discardRouteSubmissions(routePlanId: string): number;
  enqueueDriverEvent(event: DriverEventInput): OfflineDriverEventQueueItem;
  enqueueDriverEvents(events: DriverEventInput[]): OfflineDriverEventQueueItem[];
  enqueueProofMediaUpload(request: ProofMediaUploadRequest): OfflineProofMediaQueueItem;
  listPending(): OfflineSubmissionQueueItem[];
  quarantine(queueItemId: string, reason: OfflineSubmissionReconciliation['reason']): boolean;
  recordRetryFailure(queueItemId: string, lastError: string): boolean;
  sealForAccountChange(): { discardedLocations: number; sealed: number };
  storageState(): 'READY' | 'STORAGE_DEGRADED';
  recoverStorage(): Promise<boolean>;
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
  routeLookupReason?: 'driver_access_expired' | 'pickup_eta_snapshot_synced';
  serverConfirmedStopIds?: string[];
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
  'PICKUP_COMPLETED',
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
  accountOwnerHash?: string | null;
  initialItems?: OfflineSubmissionQueueItem[];
  isMutationAllowed?: () => boolean;
  maxItems?: number;
  now?: () => Date;
  onChange?: (items: OfflineSubmissionQueueItem[]) => void;
}): OfflineSubmissionQueue {
  const items = new Map((input?.initialItems ?? []).map((item) => [getInternalItemKey(item), item]));
  const now = input?.now ?? (() => new Date());
  const maxItems = normalizeMaxItems(input?.maxItems);
  let activeAccountOwnerHash = input?.accountOwnerHash === undefined ? 'test-account-owner' : input.accountOwnerHash;
  if (activeAccountOwnerHash !== null) {
    for (const item of items.values()) {
      if (item.accountOwnerHash !== 'legacy-unbound-owner') continue;
      items.delete(getInternalItemKey(item));
      item.accountOwnerHash = activeAccountOwnerHash;
      items.set(getInternalItemKey(item), item);
    }
  }
  let nextQueueSequence = Math.max(0, ...Array.from(items.values()).map((item) => item.queueSequence)) + 1;

  function requireMutable() {
    if (input?.isMutationAllowed?.() === false) throw new Error('STORAGE_DEGRADED: offline evidence is read-only until recovery succeeds.');
    if (activeAccountOwnerHash === null || activeAccountOwnerHash.trim() === '') {
      throw new Error('Offline evidence account owner is not bound.');
    }
  }

  function activeItems() {
    if (activeAccountOwnerHash === null) return [];
    return Array.from(items.values()).filter((item) => item.accountOwnerHash === activeAccountOwnerHash);
  }

  function findActiveItem(queueItemId: string) {
    return activeItems().find((item) => item.queueItemId === queueItemId);
  }

  function appendJournal(item: OfflineSubmissionQueueItem, kind: OfflineEvidenceJournalEntry['kind'], code: string) {
    const cutoff = now().getTime() - 30 * 24 * 60 * 60 * 1000;
    item.journal = [...item.journal, { at: now().toISOString(), code, kind }]
      .filter((entry) => Date.parse(entry.at) >= cutoff)
      .slice(-64);
  }

  function transition(item: OfflineSubmissionQueueItem, state: OfflineEvidenceState, kind: OfflineEvidenceJournalEntry['kind'], code: string) {
    item.state = state;
    appendJournal(item, kind, code);
  }

  function emitChange() {
    input?.onChange?.(Array.from(items.values()));
  }

  function upsertDriverEvent(event: DriverEventInput): {
    inserted: boolean;
    item: OfflineDriverEventQueueItem;
  } {
    requireMutable();
    const queueItemId = getDriverEventQueueItemId(event);
    const existing = findActiveItem(queueItemId);
    if (existing?.kind === 'driver_event') {
      return { inserted: false, item: existing };
    }

    const item: OfflineDriverEventQueueItem = {
      accountOwnerHash: activeAccountOwnerHash!,
      attempts: 0,
      enqueuedAt: now().toISOString(),
      event,
      journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
      kind: 'driver_event',
      queueSequence: nextQueueSequence,
      queueItemId,
      state: 'PENDING',
    };
    nextQueueSequence += 1;
    items.set(getInternalItemKey(item), item);
    return { inserted: true, item };
  }

  const initialDiscarded = trimOfflineSubmissionQueue(items, maxItems, activeAccountOwnerHash, now);
  const queue: OfflineSubmissionQueue = {
    acknowledge: (queueItemId) => {
      requireMutable();
      const item = findActiveItem(queueItemId);
      if (item === undefined || item.state === 'ACKNOWLEDGED' || item.state === 'DISCARDED') return false;
      transition(item, 'ACKNOWLEDGED', 'ACK', 'SERVER_ACK');
      emitChange();
      return true;
    },
    bindAccountOwnerHash: (accountOwnerHash) => {
      if (!/^[0-9a-f]{64}$/u.test(accountOwnerHash) && accountOwnerHash !== 'test-account-owner') {
        throw new Error('Offline evidence account owner hash is invalid.');
      }
      const legacyItems = Array.from(items.values()).filter((item) => item.accountOwnerHash === 'legacy-unbound-owner');
      if (legacyItems.length > 0 && input?.isMutationAllowed?.() === false) {
        throw new Error('STORAGE_DEGRADED: offline evidence is read-only until recovery succeeds.');
      }
      for (const item of legacyItems) {
        items.delete(getInternalItemKey(item));
        item.accountOwnerHash = accountOwnerHash;
        items.set(getInternalItemKey(item), item);
      }
      activeAccountOwnerHash = accountOwnerHash;
      if (legacyItems.length > 0) emitChange();
    },
    blockRouteSubmissionsForReconciliation: (routePlanId) => {
      requireMutable();
      const blockedAt = now().toISOString();
      let blocked = 0;
      let discarded = 0;
      for (const item of activeItems()) {
        if (item.state === 'ACKNOWLEDGED' || item.state === 'DISCARDED') continue;
        if (getQueueItemRoutePlanId(item) !== routePlanId) {
          continue;
        }
        if (isOrderedWorkflowEvidence(item) || item.kind === 'proof_media') {
          if (item.reconciliation === undefined) {
            item.reconciliation = { blockedAt, reason: 'route_not_in_progress' };
            transition(item, 'QUARANTINED', 'RECONCILIATION', 'ROUTE_NOT_IN_PROGRESS');
            blocked += 1;
          }
          continue;
        }
        transition(item, 'DISCARDED', 'DISCARD', 'TRANSIENT_ROUTE_STATE');
        discarded += 1;
      }
      if (blocked > 0 || discarded > 0) {
        emitChange();
      }
      return { blocked, discarded };
    },
    clear: () => {
      requireMutable();
      const current = activeItems().filter((item) => item.state === 'PENDING' || item.state === 'QUARANTINED');
      const count = current.length;
      for (const item of current) transition(item, 'DISCARDED', 'DISCARD', 'EXPLICIT_OPERATOR_PURGE');
      if (count > 0) emitChange();
      return count;
    },
    completeAccountDeletionAfterServerAudit: () => {
      requireMutable();
      const ownRows = activeItems().filter((item) => item.state !== 'DISCARDED');
      for (const item of ownRows) {
        transition(item, 'DISCARDED', 'DISCARD', 'ACCOUNT_DELETION_SERVER_AUDITED');
      }
      if (ownRows.length > 0) emitChange();
      return ownRows.length;
    },
    discard: (queueItemId) => {
      requireMutable();
      const item = findActiveItem(queueItemId);
      if (item === undefined || item.state === 'ACKNOWLEDGED' || item.state === 'DISCARDED') return false;
      transition(item, 'DISCARDED', 'DISCARD', 'EXPLICIT_DISCARD');
      emitChange();
      return true;
    },
    discardReconciliationRecords: () => {
      requireMutable();
      let discarded = 0;
      for (const item of activeItems()) {
        if (item.reconciliation === undefined || item.state !== 'QUARANTINED') {
          continue;
        }
        transition(item, 'ACKNOWLEDGED', 'ACK', 'RECONCILIATION_ACK');
        discarded += 1;
      }
      if (discarded > 0) {
        emitChange();
      }
      return discarded;
    },
    discardRouteSubmissions: (routePlanId) => {
      requireMutable();
      const routeItems = activeItems()
        .filter((item) => item.state === 'PENDING')
        .filter((item) => getQueueItemRoutePlanId(item) === routePlanId)
        .filter((item) => (
          item.kind !== 'proof_media'
          && !isTerminalStopDriverEvent(item)
          && !isRouteEndDriverEvent(item)
        ));
      for (const item of routeItems) transition(item, 'DISCARDED', 'DISCARD', 'ROUTE_TRANSIENT_CLEANUP');
      if (routeItems.length > 0) {
        emitChange();
      }
      return routeItems.length;
    },
    enqueueDriverEvent: (event) => {
      const result = upsertDriverEvent(event);
      if (result.inserted) {
        trimOfflineSubmissionQueue(items, maxItems, activeAccountOwnerHash, now);
        emitChange();
      }
      return result.item;
    },
    enqueueDriverEvents: (events) => {
      const results = events.map(upsertDriverEvent);
      if (results.some((result) => result.inserted)) {
        trimOfflineSubmissionQueue(items, maxItems, activeAccountOwnerHash, now);
        emitChange();
      }
      return results.map((result) => result.item);
    },
    enqueueProofMediaUpload: (request) => {
      requireMutable();
      const queueItemId = getProofMediaQueueItemId(request);
      const existing = findActiveItem(queueItemId);
      if (existing?.kind === 'proof_media') {
        return existing;
      }

      const item: OfflineProofMediaQueueItem = {
        accountOwnerHash: activeAccountOwnerHash!,
        attempts: 0,
        enqueuedAt: now().toISOString(),
        journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
        kind: 'proof_media',
        queueSequence: nextQueueSequence,
        queueItemId,
        request,
        state: 'PENDING',
      };
      nextQueueSequence += 1;
      items.set(getInternalItemKey(item), item);
      trimOfflineSubmissionQueue(items, maxItems, activeAccountOwnerHash, now);
      emitChange();
      return item;
    },
    listPending: () => activeItems()
      .filter((item) => item.state === 'PENDING' || item.state === 'QUARANTINED')
      .sort((left, right) => left.queueSequence - right.queueSequence),
    quarantine: (queueItemId, reason) => {
      requireMutable();
      const item = findActiveItem(queueItemId);
      if (item === undefined || item.state !== 'PENDING' || item.reconciliation !== undefined) return false;
      item.reconciliation = { blockedAt: now().toISOString(), reason };
      transition(item, 'QUARANTINED', 'RECONCILIATION', reason.toUpperCase());
      emitChange();
      return true;
    },
    recordRetryFailure: (queueItemId, lastError) => {
      requireMutable();
      const item = findActiveItem(queueItemId);
      if (item === undefined || item.state !== 'PENDING') {
        return false;
      }

      const errorCode = getStableRetryErrorCode(lastError);
      item.attempts += 1;
      item.firstErrorCode ??= errorCode;
      item.lastErrorCode = errorCode;
      appendJournal(item, 'ATTEMPT', errorCode);
      emitChange();
      return true;
    },
    sealForAccountChange: () => {
      requireMutable();
      const blockedAt = now().toISOString();
      let discardedLocations = 0;
      let sealed = 0;
      for (const item of activeItems()) {
        if (item.state !== 'PENDING') continue;
        if (isLocationDriverEvent(item)) {
          transition(item, 'DISCARDED', 'DISCARD', 'ACCOUNT_CHANGED_LOCATION');
          discardedLocations += 1;
          continue;
        }
        if (item.reconciliation !== undefined) continue;
        item.reconciliation = { blockedAt, reason: 'account_signed_out' };
        transition(item, 'QUARANTINED', 'RECONCILIATION', 'ACCOUNT_SIGNED_OUT');
        sealed += 1;
      }
      if (sealed > 0 || discardedLocations > 0) emitChange();
      return { discardedLocations, sealed };
    },
    storageState: () => 'READY',
    recoverStorage: async () => true,
    whenPersisted: async () => undefined,
  };

  if (initialDiscarded > 0) {
    emitChange();
  }
  return queue;
}

export async function createPersistentOfflineSubmissionQueue(input: {
  accountOwnerHash?: string | null;
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
  let persistQueue: Promise<void> = Promise.resolve();
  let storageDegraded = false;
  let latestItems = initialItems;

  const persistLatest = async () => {
    const payload = JSON.stringify(toPersistedEnvelope(latestItems));
    await input.storage.setItem(storageKey, payload);
  };

  const queue = createInMemoryOfflineSubmissionQueue({
    accountOwnerHash: input.accountOwnerHash === undefined ? 'test-account-owner' : input.accountOwnerHash,
    initialItems,
    isMutationAllowed: () => !storageDegraded,
    maxItems: input.maxItems,
    now: input.now,
    onChange: (items) => {
      latestItems = items;
      persistQueue = persistQueue
        .catch(() => undefined)
        .then(persistLatest)
        .catch((error: unknown) => {
          storageDegraded = true;
          throw error;
        });
      void persistQueue.catch(() => undefined);
    },
  });

  return {
    ...queue,
    recoverStorage: async () => {
      try {
        await persistLatest();
        storageDegraded = false;
        persistQueue = Promise.resolve();
        return true;
      } catch {
        storageDegraded = true;
        return false;
      }
    },
    storageState: () => storageDegraded ? 'STORAGE_DEGRADED' : 'READY',
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
  let routeLookupReason: OfflineSubmissionRetryResult['routeLookupReason'];
  let retried = 0;
  let succeeded = 0;
  const allActive = input.queue.listPending();
  const workflowBlockedRoutePlanIds = new Set(allActive.flatMap((item) => {
    const routePlanId = getQueueItemRoutePlanId(item);
    return item.reconciliation !== undefined && routePlanId !== undefined && isOrderedWorkflowEvidence(item)
      ? [routePlanId]
      : [];
  }));
  const pending = allActive.filter((item) => (
    item.reconciliation === undefined
    && (input.routePlanId === undefined || getQueueItemRoutePlanId(item) === input.routePlanId)
  ));
  const retryPolicy = input.retryPolicy ?? OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY;
  const now = input.now ?? (() => new Date());
  const completedRoutePlanIds = new Set<string>();
  const reconciliationRoutePlanIds = new Set<string>();
  const serverConfirmedStopIds = new Set<string>();

  for (const item of pending) {
    const routePlanId = getQueueItemRoutePlanId(item);
    if (routePlanId !== undefined && workflowBlockedRoutePlanIds.has(routePlanId) && isOrderedWorkflowEvidence(item)) {
      continue;
    }
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
      if (isLocationDriverEvent(item)) {
        if (input.queue.discard(item.queueItemId)) discarded += 1;
      } else {
        blocked += quarantineRetryPolicyEvidence(input.queue, item);
        if (routePlanId !== undefined && isOrderedWorkflowEvidence(item)) {
          workflowBlockedRoutePlanIds.add(routePlanId);
        }
      }
      continue;
    }

    try {
      if (item.kind === 'driver_event') {
        await input.driverEventService.recordDriverEvent(item.event);
        if (item.event.eventType === 'PICKUP_COMPLETED') {
          requiresRouteLookup = true;
          routeLookupReason = 'pickup_eta_snapshot_synced';
        }
      } else {
        await input.proofMediaUploadService.uploadProofMedia(item.request);
      }
      input.queue.acknowledge(item.queueItemId);
      succeeded += 1;
      if (item.kind === 'driver_event' && isTerminalStopDriverEvent(item) && item.event.deliveryStopId != null) {
        serverConfirmedStopIds.add(item.event.deliveryStopId);
      }
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

      if (getDriverApiRequiresRouteLookup(error) === true) {
        requiresRouteLookup = true;
        routeLookupReason = 'driver_access_expired';
      }
      input.queue.recordRetryFailure(item.queueItemId, error instanceof Error ? error.message : 'unknown error');
      const updatedItem = input.queue.listPending().find((pendingItem) => pendingItem.queueItemId === item.queueItemId);
      if (updatedItem !== undefined && shouldDiscardOfflineSubmission(updatedItem, retryPolicy, now())) {
        if (isLocationDriverEvent(updatedItem)) {
          input.queue.discard(updatedItem.queueItemId);
          discarded += 1;
        } else {
          blocked += quarantineRetryPolicyEvidence(input.queue, updatedItem);
        }
      } else {
        failed += 1;
      }
      if (routePlanId !== undefined && isOrderedWorkflowEvidence(item)) {
        workflowBlockedRoutePlanIds.add(routePlanId);
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
    ...(routeLookupReason === undefined ? {} : { routeLookupReason }),
    ...(serverConfirmedStopIds.size === 0 ? {} : { serverConfirmedStopIds: [...serverConfirmedStopIds] }),
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
  accountOwnerHash: string | null,
  now: () => Date,
): number {
  let discarded = 0;
  const activeCount = () => Array.from(items.values()).filter((item) => (
    item.accountOwnerHash === accountOwnerHash && item.state === 'PENDING'
  )).length;
  while (activeCount() > maxItems) {
    const oldestLocation = Array.from(items.values()).find((item) => (
      item.accountOwnerHash === accountOwnerHash
      && item.state === 'PENDING'
      && item.reconciliation === undefined
      && item.kind === 'driver_event'
      && item.event.eventType === 'LOCATION_UPDATED'
    ));
    const oldest = oldestLocation;
    if (oldest === undefined) {
      break;
    }
    oldest.state = 'DISCARDED';
    oldest.journal = [...oldest.journal, {
      at: now().toISOString(),
      code: 'QUEUE_CAPACITY_LOCATION',
      kind: 'DISCARD' as const,
    }].slice(-64);
    discarded += 1;
  }
  return discarded;
}

function getInternalItemKey(item: Pick<OfflineSubmissionQueueItem, 'accountOwnerHash' | 'queueItemId'>) {
  return `${item.accountOwnerHash}:${item.queueItemId}`;
}

function getStableRetryErrorCode(message: string) {
  const normalized = message.toUpperCase();
  if (normalized.includes('401') || normalized.includes('UNAUTHORIZED') || normalized.includes('EXPIRED')) return 'AUTH_EXPIRED';
  if (normalized.includes('ROUTE_NOT_IN_PROGRESS') || normalized.includes('409')) return 'ROUTE_NOT_IN_PROGRESS';
  if (normalized.includes('REJECT')) return 'PROOF_REJECTED';
  if (normalized.includes('NETWORK') || normalized.includes('OFFLINE') || normalized.includes('FETCH')) return 'NETWORK_UNAVAILABLE';
  return 'RETRY_FAILED';
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

function isRouteEndDriverEvent(item: OfflineSubmissionQueueItem): boolean {
  return item.kind === 'driver_event' && (
    item.event.eventType === 'ROUTE_COMPLETED' || item.event.eventType === 'ROUTE_PAUSED'
  );
}

function isLocationDriverEvent(item: OfflineSubmissionQueueItem): boolean {
  return item.kind === 'driver_event' && item.event.eventType === 'LOCATION_UPDATED';
}

function isOrderedWorkflowEvidence(item: OfflineSubmissionQueueItem): boolean {
  return item.kind === 'driver_event' && ROUTE_WORKFLOW_EVENT_TYPES.has(item.event.eventType);
}

function quarantineRetryPolicyEvidence(
  queue: OfflineSubmissionQueue,
  item: OfflineSubmissionQueueItem,
): number {
  return queue.quarantine(item.queueItemId, 'retry_policy_exceeded') ? 1 : 0;
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
    version: 2,
  };
}

function toPersistedQueueItem(item: OfflineSubmissionQueueItem): Record<string, unknown> {
  const base = {
    accountOwnerHash: item.accountOwnerHash,
    attempts: item.attempts,
    enqueuedAt: item.enqueuedAt,
    ...(item.firstErrorCode === undefined ? {} : { firstErrorCode: item.firstErrorCode }),
    journal: item.journal,
    kind: item.kind,
    ...(item.lastErrorCode === undefined ? {} : { lastErrorCode: item.lastErrorCode }),
    queueSequence: item.queueSequence,
    queueItemId: item.queueItemId,
    ...(item.reconciliation === undefined ? {} : { reconciliation: item.reconciliation }),
    state: item.state,
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
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.items)) {
    return null;
  }

  const items: OfflineSubmissionQueueItem[] = [];
  for (const [index, item] of data.items.entries()) {
    const parsed = readPersistedQueueItem(item, index + 1, data.version === 1);
    if (parsed === null) {
      return null;
    }
    items.push(parsed);
  }

  return items;
}

function readPersistedQueueItem(value: unknown, legacySequence = 1, legacy = false): OfflineSubmissionQueueItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const accountOwnerHash = legacy ? 'legacy-unbound-owner' : readAccountOwnerHash(data.accountOwnerHash);
  const attempts = readNonNegativeNumber(data.attempts);
  const enqueuedAt = readRequiredString(data.enqueuedAt);
  const firstErrorCode = readOptionalString(data.firstErrorCode);
  const journal = legacy ? [{ at: enqueuedAt ?? new Date(0).toISOString(), code: 'LEGACY_MIGRATED', kind: 'ENQUEUED' as const }] : readJournal(data.journal);
  const queueSequence = legacy ? legacySequence : readPositiveNumber(data.queueSequence);
  const queueItemId = readRequiredString(data.queueItemId);
  const lastErrorCode = readOptionalString(data.lastErrorCode);
  const reconciliation = readOptionalReconciliation(data.reconciliation);
  const state = legacy
    ? reconciliation === undefined ? 'PENDING' : 'QUARANTINED'
    : readEvidenceState(data.state);

  if (
    accountOwnerHash === null
    || attempts === null
    || enqueuedAt === null
    || firstErrorCode === null
    || journal === null
    || queueSequence === null
    || queueItemId === null
    || lastErrorCode === null
    || reconciliation === null
    || state === null
  ) {
    return null;
  }

  if (data.kind === 'driver_event') {
    const event = readPersistedDriverEvent(data.event);
    if (event === null) {
      return null;
    }

    return {
      accountOwnerHash,
      attempts,
      enqueuedAt,
      event,
      ...(firstErrorCode === undefined ? {} : { firstErrorCode }),
      journal,
      kind: 'driver_event',
      ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
      queueSequence,
      queueItemId,
      ...(reconciliation === undefined ? {} : { reconciliation }),
      state,
    };
  }

  if (data.kind === 'proof_media') {
    const request = readPersistedProofMediaRequest(data.request);
    if (request === null) {
      return null;
    }

    return {
      accountOwnerHash,
      attempts,
      enqueuedAt,
      ...(firstErrorCode === undefined ? {} : { firstErrorCode }),
      journal,
      kind: 'proof_media',
      ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
      queueSequence,
      queueItemId,
      ...(reconciliation === undefined ? {} : { reconciliation }),
      request,
      state,
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
  if (
    blockedAt === null
    || !['account_signed_out', 'retry_policy_exceeded', 'route_not_in_progress'].includes(String(reason))
  ) {
    return null;
  }
  return { blockedAt, reason: reason as OfflineSubmissionReconciliation['reason'] };
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
    'PICKUP_COMPLETED',
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

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readEvidenceState(value: unknown): OfflineEvidenceState | null {
  return ['ACKNOWLEDGED', 'DISCARDED', 'PENDING', 'QUARANTINED'].includes(String(value))
    ? value as OfflineEvidenceState
    : null;
}

function readJournal(value: unknown): OfflineEvidenceJournalEntry[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const journal: OfflineEvidenceJournalEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const data = entry as Record<string, unknown>;
    const at = readRequiredString(data.at);
    const code = readRequiredString(data.code);
    const kind = data.kind;
    if (at === null || code === null || !['ACK', 'ATTEMPT', 'DISCARD', 'ENQUEUED', 'RECONCILIATION'].includes(String(kind))) return null;
    journal.push({ at, code, kind: kind as OfflineEvidenceJournalEntry['kind'] });
  }
  return journal;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readAccountOwnerHash(value: unknown): string | null {
  return typeof value === 'string' && (/^[0-9a-f]{64}$/u.test(value) || value === 'test-account-owner')
    ? value
    : null;
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
