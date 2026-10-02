import {
  prepareDriverEventForPersistence,
  type DriverEventInput,
  type DriverEventService,
  type DriverEventType,
} from '../events/driverEvents';
import {
  BoundedOperationTimeoutError,
  OPERATION_TIMEOUT_CODE,
  runBoundedAsyncOperation,
} from '../async/boundedAsyncOperation';
import { resolveCompletionReceipt, type DriverEventReceiptService } from '../events/driverEventReceipt';
import {
  DriverApiHttpError,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import {
  getProofMediaUploadIdempotencyKey,
  isProofMediaRejectedError,
  type ProofMediaUploadRequest,
  type ProofMediaUploadService,
} from '../proof/proofMediaUpload';

export const OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY = '@clever-routes/offline-submission-queue-v1';
export const OFFLINE_SUBMISSION_QUEUE_MAX_ITEMS = 4_000;
export const OFFLINE_EVIDENCE_AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
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
  reason: 'account_signed_out' | 'assignment_changed' | 'event_identity_conflict' | 'proof_idempotency_conflict' | 'retry_policy_exceeded' | 'route_not_in_progress';
};

export type OfflineEvidenceState = 'ACKNOWLEDGED' | 'DISCARDED' | 'PENDING' | 'QUARANTINED';

export type OfflineEvidenceJournalEntry = {
  at: string;
  code: string;
  kind: 'ACK' | 'ATTEMPT' | 'DISCARD' | 'ENQUEUED' | 'HEARTBEAT' | 'RECONCILIATION';
};

export function retainOfflineEvidenceJournal(
  journal: OfflineEvidenceJournalEntry[],
  now: Date,
): OfflineEvidenceJournalEntry[] {
  const cutoff = now.getTime() - OFFLINE_EVIDENCE_AUDIT_RETENTION_MS;
  return journal
    .filter((entry) => {
      const timestamp = Date.parse(entry.at);
      return Number.isFinite(timestamp) && (
        timestamp >= cutoff
        || (entry.kind === 'ACK' && entry.code === 'SERVER_ACK')
        || (entry.kind === 'HEARTBEAT' && entry.code === 'ACK_CLEAR_DELIVERED')
      );
    })
    .slice(-64);
}

export function isOfflineTerminalEvidenceExpired(
  item: Pick<OfflineEvidenceIdentity, 'journal' | 'state'> & {
    enqueuedAt: string;
    event?: Pick<DriverEventInput, 'eventType'>;
    kind?: OfflineSubmissionQueueItem['kind'];
  },
  now: Date,
): boolean {
  if (item.state !== 'ACKNOWLEDGED' && item.state !== 'DISCARDED') return false;
  if (
    item.kind === 'driver_event'
    && item.event?.eventType === 'ROUTE_COMPLETED'
    && item.state === 'ACKNOWLEDGED'
  ) {
    const deliveredEntry = [...item.journal].reverse().find((entry) => (
      entry.kind === 'HEARTBEAT' && entry.code === 'ACK_CLEAR_DELIVERED'
    ));
    if (deliveredEntry === undefined) return false;
    const deliveredAt = Date.parse(deliveredEntry.at);
    return Number.isFinite(deliveredAt)
      && now.getTime() - deliveredAt > OFFLINE_EVIDENCE_AUDIT_RETENTION_MS;
  }
  const terminalEntry = [...item.journal].reverse().find((entry) => entry.kind === 'ACK' || entry.kind === 'DISCARD');
  const timestamp = Date.parse(terminalEntry?.at ?? item.enqueuedAt);
  return Number.isFinite(timestamp) && now.getTime() - timestamp > OFFLINE_EVIDENCE_AUDIT_RETENTION_MS;
}

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
  getAccountOwnerHash(): string | null;
  getCompletionClearTelemetry(entry: OfflineCompletionClearOutboxEntry): OfflineRouteCompletionTelemetry | null;
  getRouteCompletionTelemetry(routePlanId: string): OfflineRouteCompletionTelemetry;
  listPendingCompletionClearEntries(): OfflineCompletionClearOutboxEntry[];
  listPendingCompletionClearRoutePlanIds(): string[];
  listPending(): OfflineSubmissionQueueItem[];
  markCompletionClearHeartbeatDelivered(entry: OfflineCompletionClearOutboxEntry): boolean;
  quarantine(queueItemId: string, reason: OfflineSubmissionReconciliation['reason']): boolean;
  recordRetryFailure(queueItemId: string, lastError: unknown): boolean;
  reopenCompletionClearHeartbeat(entry: OfflineCompletionClearOutboxEntry): boolean;
  sealForAccountChange(): { discardedLocations: number; sealed: number };
  storageState(): 'READY' | 'STORAGE_DEGRADED';
  recoverStorage(): Promise<boolean>;
  whenPersisted(): Promise<void>;
};

export type OfflineCompletionClearOutboxEntry = {
  accountOwnerHash: string;
  assignmentGeneration: string | null;
  completionClientEventId: string;
  driverContractVersion: number | null;
  routePlanId: string;
};

export type OfflineRouteCompletionTelemetry = {
  finishPending: boolean;
  lastAcknowledgedAt: string | null;
  locallyFinished: boolean;
};

export type OfflineSubmissionQueueStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

export type OfflineSubmissionRetryResult = {
  blocked?: number;
  completionAcknowledgedRoutePlanIds?: string[];
  discarded: number;
  failed: number;
  reconciliationRoutePlanIds?: string[];
  requiresRouteLookup?: true;
  routeLookupReason?: 'driver_access_expired' | 'pickup_eta_snapshot_synced' | 'rolling_eta_snapshot_synced';
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
    prepareDriverEvent: (event) => prepareDriverEventForPersistence(input.driverEventService, event),
    recordDriverEvent: async (event, options) => {
      const preparedEvent = prepareDriverEventForPersistence(input.driverEventService, event);
      if (
        ROUTE_WORKFLOW_EVENT_TYPES.has(preparedEvent.eventType)
        && input.queue.listPending().some((item) => (
          item.kind === 'driver_event'
          && item.event.routePlanId === input.routePlanId
          && item.event.clientEventId !== preparedEvent.clientEventId
          && ROUTE_WORKFLOW_EVENT_TYPES.has(item.event.eventType)
        ))
      ) {
        throw new Error('Earlier route updates are waiting to sync. This update will be queued in order.');
      }

      return input.driverEventService.recordDriverEvent(preparedEvent, options);
    },
  };
}

export type PickupCompletionQueueState = 'none' | 'pending' | 'reconciliation';

export function getPickupCompletionQueueState(
  queue: Pick<OfflineSubmissionQueue, 'listPending'>,
  routePlanId: string,
): PickupCompletionQueueState {
  let hasRetryablePending = false;
  for (const item of queue.listPending()) {
    if (
      item.kind !== 'driver_event'
      || item.event.eventType !== 'PICKUP_COMPLETED'
      || item.event.routePlanId !== routePlanId
    ) {
      continue;
    }
    if (item.state === 'QUARANTINED' || item.reconciliation !== undefined) {
      return 'reconciliation';
    }
    if (item.state === 'PENDING') {
      hasRetryablePending = true;
    }
  }
  return hasRetryablePending ? 'pending' : 'none';
}

export function hasPendingPickupCompletion(queue: Pick<OfflineSubmissionQueue, 'listPending'>, routePlanId: string): boolean {
  return getPickupCompletionQueueState(queue, routePlanId) === 'pending';
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
  let initialLegacyAdopted = false;
  if (activeAccountOwnerHash !== null) {
    for (const item of items.values()) {
      if (item.accountOwnerHash !== 'legacy-unbound-owner') continue;
      items.delete(getInternalItemKey(item));
      item.accountOwnerHash = activeAccountOwnerHash;
      items.set(getInternalItemKey(item), item);
      initialLegacyAdopted = true;
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
    item.journal = retainOfflineEvidenceJournal(
      [...item.journal, { at: now().toISOString(), code, kind }],
      now(),
    );
  }

  function transition(item: OfflineSubmissionQueueItem, state: OfflineEvidenceState, kind: OfflineEvidenceJournalEntry['kind'], code: string) {
    item.state = state;
    appendJournal(item, kind, code);
  }

  function emitChange() {
    input?.onChange?.(Array.from(items.values()));
  }

  function upsertDriverEvent(event: DriverEventInput): {
    changed: boolean;
    inserted: boolean;
    item: OfflineDriverEventQueueItem;
  } {
    requireMutable();
    const queueItemId = getDriverEventQueueItemId(event);
    const existing = findActiveItem(queueItemId);
    if (existing?.kind === 'driver_event') {
      if (!hasSameImmutableDriverEventIdentity(existing.event, event)) {
        if (existing.reconciliation === undefined) {
          existing.reconciliation = { blockedAt: now().toISOString(), reason: 'event_identity_conflict' };
          transition(existing, 'QUARANTINED', 'RECONCILIATION', 'EVENT_IDENTITY_CONFLICT');
          return { changed: true, inserted: false, item: existing };
        }
        return { changed: false, inserted: false, item: existing };
      }
      if (
        hasCompleteOrderedEventContract(event)
        && !hasCompleteOrderedEventContract(existing.event)
      ) {
        existing.event = {
          ...existing.event,
          appVersion: event.appVersion,
          assignmentGeneration: event.assignmentGeneration,
          driverContractVersion: event.driverContractVersion,
          expectedRouteVersionId: event.expectedRouteVersionId,
          versionCode: event.versionCode,
        };
        return { changed: true, inserted: false, item: existing };
      }
      if (
        hasCompleteOrderedEventContract(existing.event)
        && hasCompleteOrderedEventContract(event)
        && !hasSameOrderedEventContract(existing.event, event)
      ) {
        if (existing.reconciliation === undefined) {
          existing.reconciliation = { blockedAt: now().toISOString(), reason: 'assignment_changed' };
          transition(existing, 'QUARANTINED', 'RECONCILIATION', 'ASSIGNMENT_CHANGED');
          return { changed: true, inserted: false, item: existing };
        }
      }
      return { changed: false, inserted: false, item: existing };
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
    return { changed: true, inserted: true, item };
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
      if (result.changed) {
        trimOfflineSubmissionQueue(items, maxItems, activeAccountOwnerHash, now);
        emitChange();
      }
      return result.item;
    },
    enqueueDriverEvents: (events) => {
      const results = events.map(upsertDriverEvent);
      if (results.some((result) => result.changed)) {
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
    getAccountOwnerHash: () => activeAccountOwnerHash,
    getCompletionClearTelemetry: (entry) => {
      const completion = activeItems().find((item): item is OfflineDriverEventQueueItem => (
        item.kind === 'driver_event'
        && item.event.eventType === 'ROUTE_COMPLETED'
        && item.accountOwnerHash === entry.accountOwnerHash
        && item.event.routePlanId === entry.routePlanId
        && (item.event.assignmentGeneration ?? null) === entry.assignmentGeneration
        && item.event.clientEventId === entry.completionClientEventId
        && (item.event.driverContractVersion ?? null) === entry.driverContractVersion
      ));
      if (completion === undefined || completion.state === 'DISCARDED') return null;
      const acknowledgedAt = completion.state === 'ACKNOWLEDGED'
        ? [...completion.journal].reverse().find((journalEntry) => (
            journalEntry.kind === 'ACK' && journalEntry.code === 'SERVER_ACK'
          ))?.at ?? null
        : null;
      return {
        finishPending: acknowledgedAt === null,
        lastAcknowledgedAt: acknowledgedAt,
        locallyFinished: true,
      };
    },
    getRouteCompletionTelemetry: (routePlanId) => {
      const completion = activeItems()
        .filter((item): item is OfflineDriverEventQueueItem => (
          item.kind === 'driver_event'
          && item.event.eventType === 'ROUTE_COMPLETED'
          && item.event.routePlanId === routePlanId
        ))
        .sort((left, right) => right.queueSequence - left.queueSequence)[0];
      if (completion === undefined || completion.state === 'DISCARDED') {
        return { finishPending: false, lastAcknowledgedAt: null, locallyFinished: false };
      }
      const acknowledgedAt = completion.state === 'ACKNOWLEDGED'
        ? [...completion.journal].reverse().find((entry) => (
            entry.kind === 'ACK' && entry.code === 'SERVER_ACK'
          ))?.at ?? null
        : null;
      return {
        finishPending: acknowledgedAt === null,
        lastAcknowledgedAt: acknowledgedAt,
        locallyFinished: true,
      };
    },
    listPendingCompletionClearEntries: () => activeItems()
      .filter((item): item is OfflineDriverEventQueueItem => (
        item.kind === 'driver_event'
        && item.event.eventType === 'ROUTE_COMPLETED'
        && item.event.routePlanId !== null
        && item.state === 'ACKNOWLEDGED'
        && item.journal.some((entry) => entry.kind === 'ACK' && entry.code === 'SERVER_ACK')
        && !item.journal.some((entry) => entry.kind === 'HEARTBEAT' && entry.code === 'ACK_CLEAR_DELIVERED')
      ))
      .sort((left, right) => left.queueSequence - right.queueSequence)
      .map((item) => ({
        accountOwnerHash: item.accountOwnerHash,
        assignmentGeneration: item.event.assignmentGeneration ?? null,
        completionClientEventId: item.event.clientEventId,
        driverContractVersion: item.event.driverContractVersion ?? null,
        routePlanId: item.event.routePlanId!,
      })),
    listPendingCompletionClearRoutePlanIds: () => queue.listPendingCompletionClearEntries()
      .map((entry) => entry.routePlanId),
    listPending: () => activeItems()
      .filter((item) => item.state === 'PENDING' || item.state === 'QUARANTINED')
      .sort((left, right) => left.queueSequence - right.queueSequence),
    markCompletionClearHeartbeatDelivered: (entry) => {
      requireMutable();
      const completion = activeItems()
        .find((item): item is OfflineDriverEventQueueItem => (
          item.kind === 'driver_event'
          && item.event.eventType === 'ROUTE_COMPLETED'
          && item.accountOwnerHash === entry.accountOwnerHash
          && item.event.routePlanId === entry.routePlanId
          && (item.event.assignmentGeneration ?? null) === entry.assignmentGeneration
          && item.event.clientEventId === entry.completionClientEventId
          && (item.event.driverContractVersion ?? null) === entry.driverContractVersion
          && item.state === 'ACKNOWLEDGED'
          && item.journal.some((journalEntry) => journalEntry.kind === 'ACK' && journalEntry.code === 'SERVER_ACK')
          && !item.journal.some((journalEntry) => (
            journalEntry.kind === 'HEARTBEAT' && journalEntry.code === 'ACK_CLEAR_DELIVERED'
          ))
        ));
      if (completion === undefined) return false;
      appendJournal(completion, 'HEARTBEAT', 'ACK_CLEAR_DELIVERED');
      emitChange();
      return true;
    },
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
    reopenCompletionClearHeartbeat: (entry) => {
      const completion = activeItems().find((item): item is OfflineDriverEventQueueItem => (
        item.kind === 'driver_event'
        && item.event.eventType === 'ROUTE_COMPLETED'
        && item.accountOwnerHash === entry.accountOwnerHash
        && item.event.routePlanId === entry.routePlanId
        && (item.event.assignmentGeneration ?? null) === entry.assignmentGeneration
        && item.event.clientEventId === entry.completionClientEventId
        && (item.event.driverContractVersion ?? null) === entry.driverContractVersion
      ));
      if (completion === undefined) return false;
      const filteredJournal = completion.journal.filter((journalEntry) => !(
        journalEntry.kind === 'HEARTBEAT' && journalEntry.code === 'ACK_CLEAR_DELIVERED'
      ));
      if (filteredJournal.length === completion.journal.length) return false;
      completion.journal = filteredJournal;
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

  if (initialDiscarded > 0 || initialLegacyAdopted) {
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
    now: input.now,
    storage: input.storage,
    storageKey,
  });
  let persistQueue: Promise<void> = Promise.resolve();
  let storageDegraded = false;
  let latestItems = initialItems;

  const persistLatest = async () => {
    const rawPayload = JSON.stringify(toPersistedEnvelope(latestItems));
    const payload = normalizePersistedOfflineSubmissionQueue(rawPayload, input.now);
    if (payload === null) throw new Error('Offline evidence snapshot normalization failed.');
    await input.storage.setItem(storageKey, payload);
    const reread = await input.storage.getItem(storageKey);
    const normalizedReread = reread === null
      ? null
      : normalizePersistedOfflineSubmissionQueue(reread, input.now);
    if (normalizedReread !== payload) {
      throw new Error('Offline evidence persistence verification failed.');
    }
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

export function normalizePersistedOfflineSubmissionQueue(
  raw: string,
  now: () => Date = () => new Date(),
): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = readPersistedEnvelope(parsed, now);
    return items === null ? null : JSON.stringify(toPersistedEnvelope(items));
  } catch {
    return null;
  }
}

export async function recoverPendingRouteEndReceipt(input: {
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  driverEventReceiptService: DriverEventReceiptService;
  isCurrent?: () => boolean;
  lifecycleSignal?: AbortSignal;
  queue: OfflineSubmissionQueue;
  routePlanId: string;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
}): Promise<'acknowledged' | 'none' | 'pending' | 'reconciliation'> {
  const item = input.queue.listPending().find((candidate): candidate is OfflineDriverEventQueueItem => (
    candidate.kind === 'driver_event'
    && candidate.event.routePlanId === input.routePlanId
    && (candidate.event.eventType === 'ROUTE_COMPLETED' || candidate.event.eventType === 'ROUTE_PAUSED')
  ));
  if (item === undefined) return 'none';

  const isCurrent = () => input.lifecycleSignal?.aborted !== true && input.isCurrent?.() !== false;
  if (!isCurrent()) return 'pending';
  const receipt = await runBoundedAsyncOperation((signal) => input.driverEventReceiptService.lookupReceipt({
    clientEventId: item.event.clientEventId,
    routePlanId: input.routePlanId,
  }, { signal }), {
    ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
    ...(input.lifecycleSignal === undefined ? {} : { signal: input.lifecycleSignal }),
    ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
    timeoutMs: input.attemptTimeoutMs ?? 15_000,
  }).catch((error: unknown) => {
    if (!(error instanceof BoundedOperationTimeoutError)) throw error;
    if (isCurrent()) input.queue.recordRetryFailure(item.queueItemId, OPERATION_TIMEOUT_CODE);
    return null;
  });
  if (receipt === null || !isCurrent()) return 'pending';
  const resolution = resolveCompletionReceipt(item.event, receipt);
  if (resolution.kind === 'retry') return 'pending';
  if (resolution.kind === 'reconcile') {
    if (!isCurrent()) return 'pending';
    input.queue.blockRouteSubmissionsForReconciliation(input.routePlanId);
    return 'reconciliation';
  }

  if (!isCurrent()) return 'pending';
  input.queue.acknowledge(item.queueItemId);
  input.queue.discardRouteSubmissions(input.routePlanId);
  await input.queue.whenPersisted();
  return 'acknowledged';
}

export async function retryOfflineSubmissions(input: {
  attemptTimeoutMs?: number;
  cancelAttemptTimeout?: (handle: unknown) => void;
  driverEventReceiptService?: DriverEventReceiptService;
  driverEventService: DriverEventService;
  isCurrent?: () => boolean;
  lifecycleSignal?: AbortSignal;
  orderedEventAccessIdentity?: {
    assignmentGeneration: string;
    driverContractVersion: number;
    expectedRouteVersionId: string;
    routePlanId: string;
  };
  now?: () => Date;
  proofMediaUploadService: ProofMediaUploadService;
  queue: OfflineSubmissionQueue;
  routePlanId?: string;
  retryPolicy?: OfflineSubmissionQueueRetryPolicy;
  scheduleAttemptTimeout?: (expire: () => void, timeoutMs: number) => unknown;
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
  const completionAcknowledgedRoutePlanIds = new Set<string>();
  const reconciliationRoutePlanIds = new Set<string>();
  const serverConfirmedStopIds = new Set<string>();
  const isCurrent = () => input.lifecycleSignal?.aborted !== true && input.isCurrent?.() !== false;
  const runAttempt = <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => runBoundedAsyncOperation(operation, {
    ...(input.cancelAttemptTimeout === undefined ? {} : { cancel: input.cancelAttemptTimeout }),
    ...(input.lifecycleSignal === undefined ? {} : { signal: input.lifecycleSignal }),
    ...(input.scheduleAttemptTimeout === undefined ? {} : { schedule: input.scheduleAttemptTimeout }),
    timeoutMs: input.attemptTimeoutMs ?? 15_000,
  });

  for (const item of pending) {
    if (!isCurrent()) break;
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
        if (
          isOrderedWorkflowEvidence(item)
          && input.orderedEventAccessIdentity !== undefined
          && !hasExactOrderedEventAccessIdentity(item.event, input.orderedEventAccessIdentity)
        ) {
          if (input.queue.quarantine(item.queueItemId, 'assignment_changed')) blocked += 1;
          if (routePlanId !== undefined) {
            workflowBlockedRoutePlanIds.add(routePlanId);
          }
          continue;
        }
        if (
          (item.event.eventType === 'ROUTE_COMPLETED' || item.event.eventType === 'ROUTE_PAUSED')
          && item.event.routePlanId != null
          && input.driverEventReceiptService !== undefined
        ) {
          const receiptRoutePlanId = item.event.routePlanId;
          const receipt = await runAttempt((signal) => input.driverEventReceiptService!.lookupReceipt({
            clientEventId: item.event.clientEventId,
            routePlanId: receiptRoutePlanId,
          }, { signal }));
          if (!isCurrent()) break;
          const resolution = resolveCompletionReceipt(item.event, receipt);
          if (resolution.kind === 'reconcile') {
            const recovery = input.queue.blockRouteSubmissionsForReconciliation(item.event.routePlanId);
            blocked += recovery.blocked;
            discarded += recovery.discarded;
            reconciliationRoutePlanIds.add(item.event.routePlanId);
            continue;
          }
          if (resolution.kind === 'acknowledge') {
            input.queue.acknowledge(item.queueItemId);
            discarded += input.queue.discardRouteSubmissions(item.event.routePlanId);
            await input.queue.whenPersisted();
            succeeded += 1;
            completedRoutePlanIds.add(item.event.routePlanId);
            completionAcknowledgedRoutePlanIds.add(item.event.routePlanId);
            continue;
          }
        }
        await runAttempt((signal) => input.driverEventService.recordDriverEvent(item.event, { signal }));
        if (!isCurrent()) break;
        if (item.event.eventType === 'PICKUP_COMPLETED') {
          requiresRouteLookup = true;
          routeLookupReason = 'pickup_eta_snapshot_synced';
        } else if (
          item.event.eventType === 'STOP_DELIVERED'
          || item.event.eventType === 'STOP_FAILED'
        ) {
          requiresRouteLookup = true;
          routeLookupReason = 'rolling_eta_snapshot_synced';
        }
      } else {
        await runAttempt((signal) => input.proofMediaUploadService.uploadProofMedia(item.request, {
          idempotencyKey: getProofMediaUploadIdempotencyKey(item.request),
          signal,
        }));
      }
      if (!isCurrent()) break;
      input.queue.acknowledge(item.queueItemId);
      await input.queue.whenPersisted();
      succeeded += 1;
      if (item.kind === 'driver_event' && isTerminalStopDriverEvent(item) && item.event.deliveryStopId != null) {
        serverConfirmedStopIds.add(item.event.deliveryStopId);
      }
      if (
        item.kind === 'driver_event'
        && (item.event.eventType === 'ROUTE_COMPLETED' || item.event.eventType === 'ROUTE_PAUSED')
        && item.event.routePlanId !== null
        && item.event.routePlanId !== undefined
      ) {
        completedRoutePlanIds.add(item.event.routePlanId);
        completionAcknowledgedRoutePlanIds.add(item.event.routePlanId);
        discarded += input.queue.discardRouteSubmissions(item.event.routePlanId);
      }
    } catch (error) {
      if (!isCurrent()) break;
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
      if (
        item.kind === 'proof_media'
        && error instanceof DriverApiHttpError
        && error.code === 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT'
      ) {
        input.queue.recordRetryFailure(item.queueItemId, error);
        if (input.queue.quarantine(item.queueItemId, 'proof_idempotency_conflict')) {
          blocked += 1;
        }
        continue;
      }

      if (getDriverApiRequiresRouteLookup(error) === true) {
        requiresRouteLookup = true;
        routeLookupReason = 'driver_access_expired';
      }
      input.queue.recordRetryFailure(item.queueItemId, error);
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
    ...(completionAcknowledgedRoutePlanIds.size === 0
      ? {}
      : { completionAcknowledgedRoutePlanIds: [...completionAcknowledgedRoutePlanIds] }),
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

function getStableRetryErrorCode(error: unknown) {
  if (error instanceof DriverApiHttpError) {
    if (error.code === 'PROOF_MEDIA_UPLOAD_IN_PROGRESS') return 'PROOF_MEDIA_UPLOAD_IN_PROGRESS';
    if (error.code === 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT') return 'PROOF_MEDIA_IDEMPOTENCY_CONFLICT';
    if (error.code === 'ROUTE_NOT_IN_PROGRESS') return 'ROUTE_NOT_IN_PROGRESS';
    if (error.status === 401) return 'AUTH_EXPIRED';
    return 'RETRY_FAILED';
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
  const normalized = message.toUpperCase();
  if (normalized.includes('OPERATION_TIMEOUT')) return 'OPERATION_TIMEOUT';
  if (normalized.includes('401') || normalized.includes('UNAUTHORIZED') || normalized.includes('EXPIRED')) return 'AUTH_EXPIRED';
  if (normalized.includes('ROUTE_NOT_IN_PROGRESS')) return 'ROUTE_NOT_IN_PROGRESS';
  if (normalized.includes('REJECT')) return 'PROOF_REJECTED';
  if (normalized.includes('NETWORK') || normalized.includes('OFFLINE') || normalized.includes('FETCH')) return 'NETWORK_UNAVAILABLE';
  return 'RETRY_FAILED';
}

function getDriverEventQueueItemId(event: DriverEventInput): string {
  return `driver-event:${event.clientEventId}`;
}

function hasCompleteOrderedEventContract(event: DriverEventInput): event is DriverEventInput & {
  appVersion: string;
  assignmentGeneration: string;
  driverContractVersion: 2;
  expectedRouteVersionId: string;
  versionCode: number;
} {
  return event.eventType !== 'LOCATION_UPDATED'
    && typeof event.appVersion === 'string' && event.appVersion.trim() !== ''
    && typeof event.assignmentGeneration === 'string' && /^\d+$/u.test(event.assignmentGeneration)
    && event.driverContractVersion === 2
    && typeof event.expectedRouteVersionId === 'string' && event.expectedRouteVersionId.trim() !== ''
    && Number.isSafeInteger(event.versionCode) && (event.versionCode ?? 0) > 0;
}

function hasSameOrderedEventContract(left: DriverEventInput, right: DriverEventInput): boolean {
  return left.appVersion === right.appVersion
    && left.assignmentGeneration === right.assignmentGeneration
    && left.driverContractVersion === right.driverContractVersion
    && left.expectedRouteVersionId === right.expectedRouteVersionId
    && left.versionCode === right.versionCode;
}

function hasSameImmutableDriverEventIdentity(left: DriverEventInput, right: DriverEventInput): boolean {
  return left.clientEventId === right.clientEventId
    && left.eventType === right.eventType
    && (left.routePlanId ?? null) === (right.routePlanId ?? null)
    && (left.deliveryStopId ?? null) === (right.deliveryStopId ?? null)
    && left.occurredAt.toISOString() === right.occurredAt.toISOString()
    && (left.latitude ?? null) === (right.latitude ?? null)
    && (left.longitude ?? null) === (right.longitude ?? null)
    && (left.accuracyMeters ?? null) === (right.accuracyMeters ?? null)
    && JSON.stringify(sortJsonValue(left.payload ?? null)) === JSON.stringify(sortJsonValue(right.payload ?? null));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  );
}

function hasExactOrderedEventAccessIdentity(
  event: DriverEventInput,
  access: NonNullable<Parameters<typeof retryOfflineSubmissions>[0]['orderedEventAccessIdentity']>,
): boolean {
  return event.routePlanId === access.routePlanId
    && event.assignmentGeneration === access.assignmentGeneration
    && event.driverContractVersion === access.driverContractVersion
    && event.expectedRouteVersionId === access.expectedRouteVersionId;
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
  now?: () => Date;
  storage: OfflineSubmissionQueueStorage;
  storageKey: string;
}): Promise<OfflineSubmissionQueueItem[]> {
  const raw = await input.storage.getItem(input.storageKey);
  if (raw === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = readPersistedEnvelope(parsed, input.now ?? (() => new Date()));
    if (items === null) {
      throw new Error('STORAGE_DEGRADED: persisted offline evidence contract is invalid and remains read-only.');
    }

    return items;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('STORAGE_DEGRADED:')) throw error;
    throw new Error('STORAGE_DEGRADED: persisted offline evidence envelope is unreadable and remains read-only.');
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

function readPersistedEnvelope(value: unknown, now: () => Date): OfflineSubmissionQueueItem[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.items)) {
    return null;
  }

  const items: OfflineSubmissionQueueItem[] = [];
  for (const [index, item] of data.items.entries()) {
    const parsed = readPersistedQueueItem(item, now, index + 1, data.version === 1);
    if (parsed === null) {
      return null;
    }
    items.push(parsed);
  }

  const retainedAt = now();
  return items.filter((item) => !isOfflineTerminalEvidenceExpired(item, retainedAt));
}

function readPersistedQueueItem(
  value: unknown,
  now: () => Date,
  legacySequence = 1,
  legacy = false,
): OfflineSubmissionQueueItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const accountOwnerHash = legacy ? 'legacy-unbound-owner' : readAccountOwnerHash(data.accountOwnerHash);
  const attempts = readNonNegativeNumber(data.attempts);
  const enqueuedAt = readRequiredString(data.enqueuedAt);
  const firstErrorCode = readOptionalString(data.firstErrorCode);
  const journal = legacy
    ? [{ at: now().toISOString(), code: 'LEGACY_MIGRATED', kind: 'ENQUEUED' as const }]
    : readJournal(data.journal, now);
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
    || ![
      'account_signed_out',
      'assignment_changed',
      'event_identity_conflict',
      'proof_idempotency_conflict',
      'retry_policy_exceeded',
      'route_not_in_progress',
    ].includes(String(reason))
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
  const accuracyMeters = readOptionalNullableNumber(data.accuracyMeters);
  const appVersion = readOptionalString(data.appVersion);
  const assignmentGeneration = readOptionalString(data.assignmentGeneration);
  const eventType = readDriverEventType(data.eventType);
  const driverContractVersion = data.driverContractVersion === undefined ? undefined : data.driverContractVersion === 2 ? 2 : null;
  const expectedRouteVersionId = readOptionalString(data.expectedRouteVersionId);
  const occurredAt = readDate(data.occurredAt);
  const deliveryStopId = readOptionalNullableString(data.deliveryStopId);
  const latitude = readOptionalNullableNumber(data.latitude);
  const longitude = readOptionalNullableNumber(data.longitude);
  const payload = readOptionalRecord(data.payload);
  const routePlanId = readOptionalNullableString(data.routePlanId);
  const versionCode = readOptionalPositiveInteger(data.versionCode);

  if (
    !isOptionalNullableNumber(data.accuracyMeters)
    || appVersion === null
    || assignmentGeneration === null
    || clientEventId === null
    || driverContractVersion === null
    || eventType === null
    || expectedRouteVersionId === null
    || occurredAt === null
    || !isOptionalNullableString(data.deliveryStopId)
    || !isOptionalNullableNumber(data.latitude)
    || !isOptionalNullableNumber(data.longitude)
    || payload === null
    || !isOptionalNullableString(data.routePlanId)
    || versionCode === null
  ) {
    return null;
  }

  return {
    ...(accuracyMeters === undefined ? {} : { accuracyMeters }),
    ...(appVersion === undefined ? {} : { appVersion }),
    ...(assignmentGeneration === undefined ? {} : { assignmentGeneration }),
    clientEventId,
    ...(deliveryStopId === undefined ? {} : { deliveryStopId }),
    ...(driverContractVersion === undefined ? {} : { driverContractVersion }),
    eventType,
    ...(expectedRouteVersionId === undefined ? {} : { expectedRouteVersionId }),
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    occurredAt,
    ...(payload === undefined ? {} : { payload }),
    ...(routePlanId === undefined ? {} : { routePlanId }),
    ...(versionCode === undefined ? {} : { versionCode }),
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

function readJournal(value: unknown, now: () => Date): OfflineEvidenceJournalEntry[] | null {
  if (!Array.isArray(value)) return null;
  const journal: OfflineEvidenceJournalEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const data = entry as Record<string, unknown>;
    const at = readRequiredString(data.at);
    const code = readRequiredString(data.code);
    const kind = data.kind;
    if (at === null || code === null || !['ACK', 'ATTEMPT', 'DISCARD', 'ENQUEUED', 'HEARTBEAT', 'RECONCILIATION'].includes(String(kind))) return null;
    journal.push({ at, code, kind: kind as OfflineEvidenceJournalEntry['kind'] });
  }
  return retainOfflineEvidenceJournal(journal, now());
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readAccountOwnerHash(value: unknown): string | null {
  return typeof value === 'string' && (
    /^[0-9a-f]{64}$/u.test(value)
    || value === 'test-account-owner'
    || value === 'legacy-unbound-owner'
  )
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

function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function readOptionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
