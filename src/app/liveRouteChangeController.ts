import { runBoundedAsyncOperation } from '../domain/async/boundedAsyncOperation';
import { getAssignedRouteServerProgress } from '../domain/route/routeStepProgress';
import type { AssignedRoute } from '../domain/route/assignedRoute';
import { applyLiveRoutePublication, mergeLiveRouteExecutionState, type LiveRouteChangeService, type LiveRoutePublication } from '../domain/route/liveRouteChange';
import { emptyLiveRouteChangeState, type LiveRouteChangeState, type LiveRouteChangeStore, type LiveRouteChangeUiDraft } from '../domain/route/liveRouteChangeStore';

function assertPublicationScope(publication: LiveRoutePublication, routePlanId: string, assignmentGeneration: string): void {
  if (publication.routePlanId !== routePlanId || publication.assignmentGeneration !== assignmentGeneration) {
    throw new Error('Route assignment changed. Refresh route access before applying changes.');
  }
}
export function observeLiveRoutePublication(state: LiveRouteChangeState, publication: LiveRoutePublication): LiveRouteChangeState {
  assertPublicationScope(publication, state.routePlanId, state.assignmentGeneration);
  const previous = state.pendingPublication;
  if (previous !== null && previous.sequence > publication.sequence) return state;
  if (previous !== null && previous.sequence === publication.sequence && previous.publicationVersionId !== publication.publicationVersionId) {
    throw new Error('Route publication identity changed unexpectedly.');
  }
  return { ...state, pendingPublication: publication };
}
export function hasPendingLiveRouteChange(state: LiveRouteChangeState): boolean {
  return state.ackPendingPublicationVersionId !== null || (state.pendingPublication !== null
    && (state.appliedRoute === null || (state.pendingPublication.sequence > 0 && state.pendingPublication.publicationVersionId !== state.appliedPublicationVersionId)));
}
export function stageLiveRouteRefresh(input: {
  state: LiveRouteChangeState | null;
  route: AssignedRoute;
  assignmentGeneration: string;
  expectedRouteVersionId: string;
  publication: LiveRoutePublication | null;
}): LiveRouteChangeState {
  let state = input.state ?? emptyLiveRouteChangeState(input.route.id, input.assignmentGeneration);
  if (state.routePlanId !== input.route.id || state.assignmentGeneration !== input.assignmentGeneration) throw new Error('Route assignment changed.');
  if (input.publication === null) {
    if (state.pendingPublication !== null) throw new Error('The enrolled route publication is temporarily unavailable.');
    return { ...state, appliedRoute: input.route, appliedPublicationVersionId: input.expectedRouteVersionId };
  }
  state = observeLiveRoutePublication(state, input.publication);
  if (state.appliedRoute === null && input.publication.sequence === 0 && !input.publication.pending) {
    return { ...state, appliedRoute: input.route, appliedPublicationVersionId: input.expectedRouteVersionId, appliedPublicationSequence: 0 };
  }
  return { ...state, appliedRoute: state.appliedRoute === null ? null : mergeLiveRouteExecutionState(state.appliedRoute, input.route) };
}
export function preserveLiveRouteStep(route: AssignedRoute, currentStopId: string | null, previousStep: number): number {
  if (currentStopId !== null) {
    const index = route.stops.findIndex(stop => stop.deliveryStopId === currentStopId);
    if (index < 0) throw new Error('The current delivery stop changed. Refresh route access.');
    return index + 1;
  }
  return previousStep <= 0 ? 0 : route.stops.length + 1;
}
type Operation = {
  accountOwnerHash: string;
  routePlanId: string;
  assignmentGeneration: string;
  store: LiveRouteChangeStore;
  service: LiveRouteChangeService;
  isCurrent(): boolean;
};
function requireCurrent(input: Operation): void {
  if (!input.isCurrent()) throw new Error('Driver account or route assignment changed.');
}
export async function retryLiveRouteAcknowledgement(input: Operation): Promise<LiveRouteChangeState | null> {
  requireCurrent(input);
  const state = await input.store.read(input.accountOwnerHash, input.routePlanId, input.assignmentGeneration);
  requireCurrent(input);
  const version = state?.ackPendingPublicationVersionId;
  if (state === null || version === null || version === undefined) return state;
  const response = await runBoundedAsyncOperation(signal => input.service.acknowledgeLiveRouteChange({ routePlanId: input.routePlanId, assignmentGeneration: input.assignmentGeneration, publicationVersionId: version }, { signal }), { timeoutMs: 15_000 });
  requireCurrent(input);
  assertPublicationScope(response, input.routePlanId, input.assignmentGeneration);
  return input.store.update(input.accountOwnerHash, input.routePlanId, input.assignmentGeneration, current => {
    requireCurrent(input);
    if (current === null) throw new Error('Saved applied route is unavailable.');
    const observed = observeLiveRoutePublication(current, response);
    return { ...observed, ackPendingPublicationVersionId: current.ackPendingPublicationVersionId === version ? null : current.ackPendingPublicationVersionId };
  });
}
export async function applyLiveRouteChange(input: Operation & {
  baseRoute: AssignedRoute;
  expectedRouteVersionId?: string;
  uiDraft?: LiveRouteChangeUiDraft;
  onApplied(state: LiveRouteChangeState): void | Promise<void>;
}): Promise<LiveRouteChangeState> {
  requireCurrent(input);
  const publication = await runBoundedAsyncOperation(signal => input.service.getLiveRouteChange({ routePlanId: input.routePlanId }, { signal }), { timeoutMs: 15_000 });
  requireCurrent(input);
  if (publication === null) {
    const state = await input.store.update(input.accountOwnerHash, input.routePlanId, input.assignmentGeneration, current => {
      requireCurrent(input);
      const version = input.expectedRouteVersionId ?? current?.appliedPublicationVersionId;
      if (version == null || current?.pendingPublication != null) throw new Error('The enrolled route publication is unavailable.');
      return stageLiveRouteRefresh({ state: current, route: input.baseRoute, assignmentGeneration: input.assignmentGeneration,
        expectedRouteVersionId: version, publication: null });
    });
    requireCurrent(input);
    await input.onApplied(state);
    return state;
  }
  assertPublicationScope(publication, input.routePlanId, input.assignmentGeneration);
  const state = await input.store.update(input.accountOwnerHash, input.routePlanId, input.assignmentGeneration, saved => {
    requireCurrent(input);
    const current = saved ?? emptyLiveRouteChangeState(input.routePlanId, input.assignmentGeneration);
    if (current.appliedPublicationSequence !== null && current.appliedPublicationSequence > publication.sequence) throw new Error('A newer route publication was already applied.');
    const observed = observeLiveRoutePublication(current, publication);
    // GET captures exact N. A concurrent poll may discover N+1, which remains pending.
    const baselineVersion = input.expectedRouteVersionId ?? current.appliedPublicationVersionId ?? publication.snapshot.initialRouteVersionId;
    if (publication.sequence === 0 && baselineVersion == null) throw new Error('The baseline route identity is unavailable.');
    return { ...observed, appliedRoute: publication.sequence === 0 ? input.baseRoute : applyLiveRoutePublication(input.baseRoute, publication),
      appliedPublicationVersionId: publication.sequence === 0 ? baselineVersion! : publication.publicationVersionId, appliedPublicationSequence: publication.sequence,
      ackPendingPublicationVersionId: publication.sequence === 0 ? null : publication.publicationVersionId, uiDraft: input.uiDraft ?? current.uiDraft };
  });
  requireCurrent(input);
  await input.onApplied(state);
  requireCurrent(input);
  return (await retryLiveRouteAcknowledgement(input))!;
}

export function supportsLiveRouteChanges(shopDomain: string): boolean {
  // Matches the server's KFOOD_DELIVERY_SHOP_DOMAIN. The server also enforces app/account scope.
  return shopDomain.trim().toLowerCase() === '7hrud1-xq.myshopify.com';
}

export function shouldCheckLiveRouteChange(shopDomain: string, executionStatus: string, locallyActive: boolean): boolean {
  return supportsLiveRouteChanges(shopDomain) && (executionStatus === 'IN_PROGRESS' || locallyActive);
}

/** Execution may restore from a private fresh response while its new content stays hidden. */
export function getLiveRouteRecoveryProgress(visibleRoute: AssignedRoute, privateFreshRoute?: AssignedRoute): ReturnType<typeof getAssignedRouteServerProgress> {
  if (privateFreshRoute !== undefined && visibleRoute.id !== privateFreshRoute.id) throw new Error('Route recovery identity changed.');
  return getAssignedRouteServerProgress(privateFreshRoute ?? visibleRoute);
}
