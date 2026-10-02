import type { PersistedDriverAccess } from '../../../domain/driver/driverAccessTokenStore';
import type { ContinuousLocationBatchItem } from '../../../domain/location/continuousLocationStream';
import { observeAssignedCompletionLocations } from '../../../domain/completion/completionAssistance';
import { notifyCompletionCandidates } from '../../../domain/completion/completionAssistanceNotifications';
import { createExpoCompletionAssistanceStore, getCompletionAccountOwnerHash } from '../storage/expoCompletionAssistanceStore';
import { showCompletionCandidateNotification } from '../notifications/expoCompletionAssistanceNotifications';

const listeners = new Set<() => void>();
const workControllers = new Set<AbortController>();
export function startCompletionAssistanceWork() {
  const controller = new AbortController();
  workControllers.add(controller);
  return { signal: controller.signal, release: () => { workControllers.delete(controller); } };
}
export function invalidateCompletionAssistanceWork(): void {
  for (const controller of workControllers) controller.abort();
  workControllers.clear();
}
export function subscribeCompletionAssistance(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitCompletionAssistanceChange(): void {
  for (const listener of listeners) listener();
}

export async function recordExpoCompletionLocations(input: {
  persistedAccess: PersistedDriverAccess;
  locations: ContinuousLocationBatchItem[];
  isCurrent(): Promise<boolean>;
}): Promise<void> {
  const { activeRouteSession, routeAccess } = input.persistedAccess;
  if (activeRouteSession?.status !== 'active' || routeAccess?.routePlanId !== activeRouteSession.routePlanId) return;
  const work = startCompletionAssistanceWork();
  try {
    const accountOwnerHash = await getCompletionAccountOwnerHash(input.persistedAccess.driverProfile.phoneE164);
    const store = await createExpoCompletionAssistanceStore();
    if (work.signal.aborted || !(await input.isCurrent())) return;
    const state = await store.update(accountOwnerHash, (current) => {
      if (work.signal.aborted) return current;
      return observeAssignedCompletionLocations(current, {
        routePlanId: routeAccess.routePlanId,
        assignmentGeneration: routeAccess.assignmentGeneration,
        expectedRouteVersionId: routeAccess.expectedRouteVersionId,
      }, input.locations.map((location) => ({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters ?? Number.NaN,
        occurredAt: Number.isFinite(location.occurredAt.getTime()) ? location.occurredAt.toISOString() : '',
      })));
    });
    if (work.signal.aborted || !(await input.isCurrent())) return;
    emitCompletionAssistanceChange();
    if (state.candidates.some((candidate) => !candidate.notified && (candidate.status === 'awaiting_response' || candidate.status === 'held'))) {
      await notifyCompletionCandidates({
        store, accountOwnerHash, notify: (candidate) => showCompletionCandidateNotification(candidate, accountOwnerHash),
        isCurrent: () => !work.signal.aborted, validateCurrent: input.isCurrent,
      });
      emitCompletionAssistanceChange();
    }
  } finally { work.release(); }
}
