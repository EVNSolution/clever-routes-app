import { isAssignedRoute, type AssignedRoute } from './assignedRoute';
import { parseLiveRoutePublication, type LiveRoutePublication } from './liveRouteChange';
import type { ProofPhotoCaptureResult } from '../proof/proofPhotoCapture';
import type { ProofMediaUploadResult } from '../proof/proofMediaUpload';
import { OFFLINE_EVIDENCE_AUDIT_RETENTION_MS } from '../offline/offlineSubmissionQueue';

export type LiveRouteChangeUiDraft = {
  currentStopId: string | null;
  selectedStopDetailsId: string | null;
  proofDrafts: Record<string, { additionalNotes: string; locationTip: string; todayNote: string }>;
  proofPhotoResults: Record<string, ProofPhotoCaptureResult>;
  proofMediaResults: Record<string, ProofMediaUploadResult>;
};

export type LiveRouteChangeState = {
  schemaVersion: 1;
  /** Written by the store. Missing timestamps are retained until the next successful update. */
  updatedAt?: string;
  routePlanId: string;
  assignmentGeneration: string;
  appliedRoute: AssignedRoute | null;
  appliedPublicationVersionId: string | null;
  appliedPublicationSequence: number | null;
  pendingPublication: LiveRoutePublication | null;
  ackPendingPublicationVersionId: string | null;
  uiDraft: LiveRouteChangeUiDraft | null;
};

export type LiveRouteChangeRawStorage = {
  readLiveRouteChangeState(accountOwnerHash: string): Promise<string | null>;
  removeLiveRouteChangeState(accountOwnerHash: string): Promise<void>;
  updateLiveRouteChangeState(accountOwnerHash: string, mutate: (raw: string | null) => string): Promise<string>;
};

export type LiveRouteChangeStore = {
  read(accountOwnerHash: string, routePlanId: string, assignmentGeneration: string): Promise<LiveRouteChangeState | null>;
  list(accountOwnerHash: string): Promise<LiveRouteChangeState[]>;
  removeAccount(accountOwnerHash: string): Promise<void>;
  update(
    accountOwnerHash: string,
    routePlanId: string,
    assignmentGeneration: string,
    mutate: (state: LiveRouteChangeState | null) => LiveRouteChangeState,
  ): Promise<LiveRouteChangeState>;
};

export function emptyLiveRouteChangeState(routePlanId: string, assignmentGeneration: string): LiveRouteChangeState {
  requireIdentity(routePlanId, assignmentGeneration);
  return {
    schemaVersion: 1, routePlanId, assignmentGeneration,
    appliedRoute: null, appliedPublicationVersionId: null, appliedPublicationSequence: null,
    pendingPublication: null, ackPendingPublicationVersionId: null, uiDraft: null,
  };
}

/** The caller must await update before exposing a new event version or sending its ACK. */
export function createLiveRouteChangeStore(
  storage: LiveRouteChangeRawStorage,
  options: { now?: () => Date } = {},
): LiveRouteChangeStore {
  const now = options.now ?? (() => new Date());
  const list = async (owner: string) => {
    requireOwner(owner);
    const entries = parseEnvelope(await storage.readLiveRouteChangeState(owner), owner);
    if (!entries.some((entry) => isResolvedExpiredState(entry, now()))) return entries;
    const pruned = await storage.updateLiveRouteChangeState(owner, (raw) => JSON.stringify({
      schemaVersion: 1, accountOwnerHash: owner,
      entries: parseEnvelope(raw, owner).filter((entry) => !isResolvedExpiredState(entry, now())),
    }));
    return parseEnvelope(pruned, owner);
  };
  return {
    list,
    read: async (owner, routeId, generation) => {
      requireIdentity(routeId, generation);
      return (await list(owner)).find((entry) => matchesIdentity(entry, routeId, generation)) ?? null;
    },
    removeAccount: async (owner) => {
      requireOwner(owner);
      await storage.removeLiveRouteChangeState(owner);
    },
    update: async (owner, routeId, generation, mutate) => {
      requireOwner(owner);
      requireIdentity(routeId, generation);
      const raw = await storage.updateLiveRouteChangeState(owner, (persisted) => {
        const entries = parseEnvelope(persisted, owner).filter((entry) => !isResolvedExpiredState(entry, now()));
        const index = entries.findIndex((entry) => matchesIdentity(entry, routeId, generation));
        const current = index < 0 ? null : entries[index]!;
        // Give the callback a detached copy so failed mutations cannot change comparison state.
        const next = parseState({
          ...mutate(current === null ? null : JSON.parse(JSON.stringify(current)) as LiveRouteChangeState),
          updatedAt: now().toISOString(),
        });
        if (!matchesIdentity(next, routeId, generation)) throw new Error('Live route state identity changed.');
        requireMonotonicTransition(current, next);
        if (index < 0) entries.push(next);
        else entries[index] = next;
        return JSON.stringify({ schemaVersion: 1, accountOwnerHash: owner, entries });
      });
      const updated = parseEnvelope(raw, owner).find((entry) => matchesIdentity(entry, routeId, generation));
      if (updated === undefined) throw new Error('Live route state update did not persist its identity.');
      return updated;
    },
  };
}

function requireMonotonicTransition(current: LiveRouteChangeState | null, next: LiveRouteChangeState): void {
  if (current === null) return;
  if (current.appliedPublicationSequence !== null && (
    next.appliedPublicationSequence === null
    || next.appliedPublicationSequence < current.appliedPublicationSequence
    || (next.appliedPublicationSequence === current.appliedPublicationSequence
      && next.appliedPublicationVersionId !== current.appliedPublicationVersionId)
  )) throw new Error('Live route applied publication cannot move backwards.');
  const previousPending = current.pendingPublication;
  const nextPending = next.pendingPublication;
  if (previousPending !== null && nextPending !== null && (
    nextPending.sequence < previousPending.sequence
    || (nextPending.sequence === previousPending.sequence
      && nextPending.publicationVersionId !== previousPending.publicationVersionId)
  )) throw new Error('Live route state cannot replace a newer pending change with an older publication.');
  if (previousPending?.pending === true && nextPending === null
    && (next.appliedPublicationSequence === null || next.appliedPublicationSequence < previousPending.sequence)) {
    throw new Error('Live route state cannot clear a publication that was not applied.');
  }
}

function parseEnvelope(raw: string | null, owner: string): LiveRouteChangeState[] {
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Live route cache is malformed; preserve it for recovery.'); }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Live route cache schema is invalid; preserve it for recovery.');
  }
  if (value.accountOwnerHash !== owner) throw new Error('Live route cache belongs to another account.');
  const entries = value.entries.map(parseState);
  const identities = entries.map((entry) => `${entry.routePlanId}:${entry.assignmentGeneration}`);
  if (new Set(identities).size !== identities.length) throw new Error('Live route cache contains duplicate assignment identities.');
  return entries;
}

function parseState(value: unknown): LiveRouteChangeState {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('Live route state schema is invalid.');
  requireIdentity(value.routePlanId, value.assignmentGeneration);
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) {
    throw new Error('Live route cache timestamp is invalid.');
  }
  if (value.appliedRoute !== null && (!isCachedAssignedRoute(value.appliedRoute) || value.appliedRoute.id !== value.routePlanId)) {
    throw new Error('Live route cached route is invalid or belongs to another route.');
  }
  if (!nullableId(value.appliedPublicationVersionId) || !nullableId(value.ackPendingPublicationVersionId)
    || !(value.appliedPublicationSequence === null || (Number.isSafeInteger(value.appliedPublicationSequence)
      && typeof value.appliedPublicationSequence === 'number' && value.appliedPublicationSequence >= 0))) {
    throw new Error('Live route publication cursor is invalid.');
  }
  if (value.ackPendingPublicationVersionId !== null
    && (value.ackPendingPublicationVersionId !== value.appliedPublicationVersionId || value.appliedRoute === null)) {
    throw new Error('Live route ACK must identify the locally persisted applied route.');
  }
  const pending = value.pendingPublication === null ? null : parseLiveRoutePublication(value.pendingPublication);
  if (pending !== null && !matchesIdentity(pending, value.routePlanId as string, value.assignmentGeneration as string)) {
    throw new Error('Live route pending publication belongs to another assignment identity.');
  }
  if (value.uiDraft !== null && !isUiDraft(value.uiDraft)) throw new Error('Live route proof draft is invalid.');
  return {
    schemaVersion: 1,
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt as string }),
    routePlanId: value.routePlanId as string,
    assignmentGeneration: value.assignmentGeneration as string,
    appliedRoute: value.appliedRoute as AssignedRoute | null,
    appliedPublicationVersionId: value.appliedPublicationVersionId,
    appliedPublicationSequence: value.appliedPublicationSequence as number | null,
    pendingPublication: pending,
    ackPendingPublicationVersionId: value.ackPendingPublicationVersionId,
    uiDraft: value.uiDraft as LiveRouteChangeUiDraft | null,
  };
}

function isUiDraft(value: unknown): value is LiveRouteChangeUiDraft {
  return isRecord(value) && nullableId(value.currentStopId) && nullableId(value.selectedStopDetailsId)
    && isRecord(value.proofDrafts) && Object.values(value.proofDrafts).every((draft) => isRecord(draft)
      && typeof draft.additionalNotes === 'string' && typeof draft.locationTip === 'string' && typeof draft.todayNote === 'string')
    && isRecord(value.proofPhotoResults) && Object.values(value.proofPhotoResults).every((photo) => isRecord(photo)
      && (photo.source === 'camera' || photo.source === 'library')
      && (photo.kind === 'cancelled' || (photo.kind === 'captured' && typeof photo.uri === 'string')
        || (photo.kind === 'permission_denied' && typeof photo.message === 'string')))
    && isRecord(value.proofMediaResults) && Object.values(value.proofMediaResults).every((result) => isRecord(result)
      && ((result.kind === 'skipped' && result.reason === 'photo_not_captured' && typeof result.message === 'string')
        || (result.kind === 'upload_failed' && typeof result.message === 'string'
          && (result.reason === undefined || ['driver_access_expired', 'proof_media_rejected', 'route_not_in_progress'].includes(String(result.reason))))
        || (result.kind === 'uploaded' && isProofMediaReference(result.media))));
}

function isCachedAssignedRoute(value: unknown): value is AssignedRoute {
  // The HTTP validator accepts legacy optional fields. A cache must contain the normalized app model.
  return isAssignedRoute(value) && value.depot !== undefined && value.routeGeometry !== undefined
    && value.routeMapPreview !== undefined && value.routeMetrics !== undefined
    && Array.isArray(value.routeStopPoints) && typeof value.timezone === 'string'
    && new Set(value.stops.map((stop) => stop.deliveryStopId)).size === value.stops.length
    && (value.depot === null || (Number.isFinite(value.depot.latitude) && Number.isFinite(value.depot.longitude)))
    && value.stops.every((stop) => stop.coordinates === null
      || (Number.isFinite(stop.coordinates.latitude) && Number.isFinite(stop.coordinates.longitude)));
}

function isProofMediaReference(media: unknown): boolean {
  return isRecord(media) && media.kind === 'photo'
    && ['contentType', 'mediaId', 'storageKey', 'uploadedAt'].every((key) => typeof media[key] === 'string')
    && (media.source === 'camera' || media.source === 'library')
    && (media.sha256 === undefined || typeof media.sha256 === 'string')
    && (media.sizeBytes === undefined || (typeof media.sizeBytes === 'number' && Number.isFinite(media.sizeBytes)));
}

function isResolvedExpiredState(state: LiveRouteChangeState, now: Date): boolean {
  if (state.updatedAt === undefined || now.getTime() - Date.parse(state.updatedAt) <= OFFLINE_EVIDENCE_AUDIT_RETENTION_MS
    || state.ackPendingPublicationVersionId !== null || state.pendingPublication?.pending === true) return false;
  const drafts = state.uiDraft;
  if (drafts === null) return true;
  const terminal = new Set(state.appliedRoute?.stops.filter((stop) => (
    ['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(stop.status)
  )).map((stop) => stop.deliveryStopId));
  return !Object.entries(drafts.proofDrafts).some(([stopId, draft]) => !terminal.has(stopId)
    && Object.values(draft).some((text) => text.trim() !== ''))
    && !Object.entries(drafts.proofPhotoResults).some(([stopId, photo]) => !terminal.has(stopId) && photo.kind === 'captured')
    && !Object.entries(drafts.proofMediaResults).some(([stopId, media]) => !terminal.has(stopId) && media.kind === 'upload_failed');
}

function requireOwner(owner: string): void {
  if (!/^[0-9a-f]{64}$/u.test(owner)) throw new Error('Live route state requires a lowercase SHA-256 account owner hash.');
}

function requireIdentity(routeId: unknown, generation: unknown): void {
  if (typeof routeId !== 'string' || routeId.trim() === '' || typeof generation !== 'string'
    || !/^[1-9]\d{0,18}$/u.test(generation) || BigInt(generation) > 9223372036854775807n) {
    throw new Error('Live route state requires a route and canonical assignment identity.');
  }
}

function matchesIdentity(value: { routePlanId: string; assignmentGeneration: string }, routeId: string, generation: string): boolean {
  return value.routePlanId === routeId && value.assignmentGeneration === generation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim() !== '');
}
