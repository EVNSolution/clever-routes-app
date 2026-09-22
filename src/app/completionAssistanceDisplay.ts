import type { CompletionAssignmentIdentity, CompletionAssistanceState } from '../domain/completion/completionAssistance';

export function getLocationInferredStopIds(
  state: CompletionAssistanceState,
  identity: CompletionAssignmentIdentity | undefined,
  stops: readonly { deliveryStopId: string; status: string }[] = [],
): string[] {
  if (identity === undefined) return [];
  return state.candidates.filter((candidate) => (
    candidate.routePlanId === identity.routePlanId
    && candidate.assignmentGeneration === identity.assignmentGeneration
    && candidate.expectedRouteVersionId === identity.expectedRouteVersionId
    && !stops.some((stop) => stop.deliveryStopId === candidate.deliveryStopId
      && ['FAILED', 'CANCELLED', 'CANCELED', 'SKIPPED'].includes(stop.status.toUpperCase()))
    && (candidate.status === 'inferred_completed'
      || (candidate.autoCompletedAt !== undefined && state.commands.some((command) => (
        command.kind === 'response' && command.candidateId === candidate.candidateId
      ))))
  )).map((candidate) => candidate.deliveryStopId);
}
