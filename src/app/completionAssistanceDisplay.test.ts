import assert from 'node:assert/strict';
import { it } from 'node:test';
import { emptyCompletionAssistanceState, respondToCompletionCandidate, type CompletionCandidate } from '../domain/completion/completionAssistance';
import { getLocationInferredStopIds } from './completionAssistanceDisplay';

const candidate: CompletionCandidate = {
  candidateId: 'candidate', runId: 'run', routePlanId: 'route', assignmentGeneration: '1', expectedRouteVersionId: 'version',
  deliveryStopId: 'stop', arrivalAt: '2026-09-17T01:00:00.000Z', dwellCompletedAt: '2026-09-17T01:01:00.000Z',
  exitAt: '2026-09-17T01:02:00.000Z', autoCompletedAt: '2026-09-18T01:02:00.000Z',
  evidence: [], policyVersion: 'policy', revision: 1, status: 'inferred_completed',
};

it('labels inferred completion only for the matching route assignment and version', () => {
  const state = { ...emptyCompletionAssistanceState(), candidates: [candidate] };
  assert.deepEqual(getLocationInferredStopIds(state, candidate), ['stop']);
  assert.deepEqual(getLocationInferredStopIds(state, { ...candidate, assignmentGeneration: '2' }), []);
  assert.deepEqual(getLocationInferredStopIds(state, { ...candidate, expectedRouteVersionId: 'new-version' }), []);
  assert.deepEqual(getLocationInferredStopIds(state, undefined), []);
  for (const status of ['FAILED', 'CANCELLED', 'SKIPPED']) {
    assert.deepEqual(getLocationInferredStopIds(state, candidate, [{ deliveryStopId: 'stop', status }]), []);
  }
});

it('retains the inference label during an offline correction until the server acknowledges it', () => {
  const state = respondToCompletionCandidate({ ...emptyCompletionAssistanceState(), candidates: [candidate] },
    candidate.candidateId, 'not_completed', '2026-09-18T02:00:00.000Z');
  assert.deepEqual(getLocationInferredStopIds(state, candidate), ['stop']);
  assert.deepEqual(getLocationInferredStopIds({ ...state, commands: [] }, candidate), []);
});
