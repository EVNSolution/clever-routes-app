import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emptyCompletionAssistanceState,
  endCompletionTracking,
  observeAssignedCompletionLocations,
  observeCompletionLocations,
  parseCompletionPolicy,
  reconcileCompletionRuns,
  recordCompletionManualResponse,
  recordCompletionReturnIntent,
  respondToCompletionCandidate,
  type CompletionAssistanceState,
  type CompletionCommand,
  type CompletionPolicy,
  type CompletionRun,
  type CompletionRunContext,
  type CompletionSample,
} from './completionAssistance';

const policy: CompletionPolicy = {
  version: 'visit-v1',
  maxAccuracyMeters: 50,
  enterRadiusMeters: 100,
  exitRadiusMeters: 200,
  dwellMs: 60_000,
  maxGapMs: 35_000,
  minDwellSamples: 3,
  ambiguityRadiusMeters: 100,
};

const metersToLatitude = (meters: number) => meters / 111_195;

function sample(metersNorth: number, occurredAt: string, accuracyMeters = 5): CompletionSample {
  return {
    accuracyMeters,
    latitude: metersToLatitude(metersNorth),
    longitude: 0,
    occurredAt,
  };
}

function run(input?: Partial<CompletionRun>): CompletionRun {
  return {
    assignmentGeneration: 'assignment-1',
    expectedRouteVersionId: 'route-version-1',
    policy,
    routePlanId: 'route-1',
    runId: 'run-1',
    stops: [{
      coordinates: { latitude: 0, longitude: 0 },
      deliveryStopId: 'stop-1',
      status: 'PENDING',
    }],
    ...input,
  };
}

function initialized(inputRun = run()): CompletionAssistanceState {
  return reconcileCompletionRuns(emptyCompletionAssistanceState(), [inputRun]);
}

function runContext(inputRun = run()): CompletionRunContext {
  const { policy: _policy, ...context } = inputRun;
  return context;
}

function completeVisit(
  state: CompletionAssistanceState,
  routePlanId = 'route-1',
  minuteOffset = 0,
): CompletionAssistanceState {
  const at = (seconds: number) => new Date(Date.UTC(2026, 8, 17, 12, minuteOffset, seconds)).toISOString();
  return observeCompletionLocations(state, routePlanId, [
    sample(240, at(0)),
    sample(50, at(5)),
    sample(45, at(35)),
    sample(40, at(65)),
    sample(230, at(70)),
  ]);
}

describe('completion assistance policy', () => {
  it('accepts only explicit, safe runtime policies and supplies no defaults', () => {
    assert.deepEqual(parseCompletionPolicy(policy), policy);
    assert.equal(parseCompletionPolicy({ ...policy, exitRadiusMeters: 90 }), null);
    assert.equal(parseCompletionPolicy({ ...policy, maxAccuracyMeters: 100 }), null);
    assert.equal(parseCompletionPolicy({ ...policy, maxGapMs: 60_001 }), null);
    assert.equal(parseCompletionPolicy({ ...policy, ambiguityRadiusMeters: 99 }), null);
    assert.equal(parseCompletionPolicy({ ...policy, minDwellSamples: 2 }), null);
    assert.equal(parseCompletionPolicy({ ...policy, unknown: true }), null);
    assert.equal(parseCompletionPolicy(undefined), null);
  });
});

describe('completion visit detection', () => {
  it('creates deterministic candidates for every assigned pending stop independent of selection', () => {
    let state = initialized(run({
      stops: [
        { coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'PENDING' },
        { coordinates: { latitude: metersToLatitude(1_000), longitude: 0 }, deliveryStopId: 'stop-2', status: 'ARRIVED' },
      ],
    }));

    state = completeVisit(state);
    state = observeCompletionLocations(state, 'route-1', [
      sample(760, '2026-09-17T12:02:00.000Z'),
      sample(950, '2026-09-17T12:02:05.000Z'),
      sample(955, '2026-09-17T12:02:35.000Z'),
      sample(960, '2026-09-17T12:03:05.000Z'),
      sample(1_230, '2026-09-17T12:03:10.000Z'),
    ]);

    assert.deepEqual(state.candidates.map((candidate) => candidate.deliveryStopId), ['stop-1', 'stop-2']);
    assert.equal(state.candidates.every((candidate) => candidate.status === 'awaiting_response'), true);
    assert.equal(state.candidates.every((candidate) => candidate.responseDeadlineAt === undefined), true);
    assert.equal(state.commands.filter((command) => command.kind === 'candidate').length, 2);

    const replayed = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      sample(45, '2026-09-17T12:00:35.000Z'),
      sample(40, '2026-09-17T12:01:05.000Z'),
      sample(230, '2026-09-17T12:01:10.000Z'),
    ]);
    assert.deepEqual(replayed.candidates, state.candidates);
    assert.deepEqual(replayed.commands, state.commands);
  });

  it('detects normal assigned and en-route server stop states', () => {
    for (const status of ['ASSIGNED', 'EN_ROUTE']) {
      const state = completeVisit(initialized(run({
        stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status }],
      })));
      assert.equal(state.candidates.length, 1, status);
    }
  });

  it('buffers early assigned GPS and replays it after the matching run policy arrives', () => {
    const identity = {
      assignmentGeneration: 'assignment-1',
      expectedRouteVersionId: 'route-version-1',
      routePlanId: 'route-1',
    };
    let state = observeAssignedCompletionLocations(emptyCompletionAssistanceState(), identity, [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      sample(45, '2026-09-17T12:00:35.000Z'),
      sample(40, '2026-09-17T12:01:05.000Z'),
      sample(230, '2026-09-17T12:01:10.000Z'),
    ]);
    assert.equal(state.bufferedLocations?.[0]?.samples.length, 5);

    state = reconcileCompletionRuns(state, [run()]);

    assert.equal(state.candidates.length, 1);
    assert.equal(state.bufferedLocations, undefined);
  });

  it('bounds unknown-run GPS and records nothing when capability is unsupported', () => {
    const identity = (index: number) => ({
      assignmentGeneration: `assignment-${index}`,
      expectedRouteVersionId: `version-${index}`,
      routePlanId: `route-${index}`,
    });
    let state = emptyCompletionAssistanceState();
    for (let index = 0; index < 3; index += 1) {
      state = observeAssignedCompletionLocations(state, identity(index), Array.from({ length: 130 }, (_, sampleIndex) => (
        sample(240, new Date(Date.UTC(2026, 8, 17, 12, index, sampleIndex)).toISOString())
      )));
    }
    assert.equal(state.bufferedLocations?.length, 2);
    assert.equal(state.bufferedLocations?.every((buffered) => buffered.samples.length <= 120), true);

    const unsupported = observeAssignedCompletionLocations(
      { ...emptyCompletionAssistanceState(), capability: 'unsupported' },
      identity(4),
      [sample(240, '2026-09-17T12:00:00.000Z')],
    );
    assert.equal(unsupported.bufferedLocations, undefined);
  });

  it('rejects one-point pass-bys, uncertain accuracy, gaps, duplicates, and out-of-order samples', () => {
    let state = initialized();
    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      sample(230, '2026-09-17T12:00:10.000Z'),
      sample(240, '2026-09-17T12:01:00.000Z'),
      sample(50, '2026-09-17T12:01:05.000Z'),
      sample(45, '2026-09-17T12:01:45.000Z'),
      sample(40, '2026-09-17T12:02:05.000Z'),
      sample(230, '2026-09-17T12:02:10.000Z'),
      sample(240, '2026-09-17T12:03:00.000Z'),
      sample(50, '2026-09-17T12:03:05.000Z', 75),
      sample(40, '2026-09-17T12:04:05.000Z'),
      sample(40, '2026-09-17T12:04:05.000Z'),
      sample(45, '2026-09-17T12:03:35.000Z'),
      sample(230, '2026-09-17T12:04:10.000Z'),
    ]);

    assert.deepEqual(state.candidates, []);
  });

  it('holds overlapping neighboring stops instead of guessing which same-building stop was visited', () => {
    let state = initialized(run({
      stops: [
        { coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'PENDING' },
        { coordinates: { latitude: metersToLatitude(20), longitude: 0 }, deliveryStopId: 'stop-2', status: 'PENDING' },
      ],
    }));

    state = completeVisit(state);

    assert.deepEqual(state.candidates, []);
  });

  it('uses terminal neighboring stops as ambiguity evidence at the same building', () => {
    for (const terminalStatus of ['FAILED', 'DELIVERED', 'CANCELLED']) {
      let state = initialized(run({
        stops: [
          { coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'PENDING' },
          {
            coordinates: { latitude: metersToLatitude(20), longitude: 0 },
            deliveryStopId: 'terminal-neighbor',
            status: terminalStatus,
          },
        ],
      }));

      state = completeVisit(state);

      assert.deepEqual(state.candidates, [], terminalStatus);
    }
  });

  it('resets active dwell when a malformed GPS observation interrupts otherwise valid points', () => {
    let state = initialized();
    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      { ...sample(45, '2026-09-17T12:00:35.000Z'), accuracyMeters: Number.NaN },
      sample(40, '2026-09-17T12:01:05.000Z'),
      sample(35, '2026-09-17T12:01:20.000Z'),
      sample(230, '2026-09-17T12:01:25.000Z'),
    ]);

    assert.deepEqual(state.candidates, []);
  });

  it('treats a noisy sample in overlapping geofences as ambiguous even when only one stop is certainly inside', () => {
    let state = initialized(run({
      stops: [
        { coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'PENDING' },
        { coordinates: { latitude: metersToLatitude(150), longitude: 0 }, deliveryStopId: 'stop-2', status: 'PENDING' },
      ],
    }));
    state = observeCompletionLocations(state, 'route-1', [
      sample(300, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      sample(45, '2026-09-17T12:00:35.000Z'),
      sample(40, '2026-09-17T12:01:05.000Z'),
      sample(230, '2026-09-17T12:01:10.000Z'),
    ]);

    assert.deepEqual(state.candidates, []);
  });

  it('restores an in-progress dwell from persisted state after restart', () => {
    let state = initialized();
    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
      sample(45, '2026-09-17T12:00:35.000Z'),
    ]);
    const restored = structuredClone(state);

    state = observeCompletionLocations(restored, 'route-1', [
      sample(40, '2026-09-17T12:01:05.000Z'),
      sample(230, '2026-09-17T12:01:10.000Z'),
    ]);

    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0]?.arrivalAt, '2026-09-17T12:00:05.000Z');
  });
});

describe('completion candidate lifecycle', () => {
  it('records responses per candidate without locally auto-completing any candidate at 24 hours', () => {
    let state = initialized(run({
      stops: [
        { coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'PENDING' },
        { coordinates: { latitude: metersToLatitude(1_000), longitude: 0 }, deliveryStopId: 'stop-2', status: 'PENDING' },
      ],
    }));
    state = completeVisit(state);
    state = observeCompletionLocations(state, 'route-1', [
      sample(760, '2026-09-17T12:02:00.000Z'),
      sample(950, '2026-09-17T12:02:05.000Z'),
      sample(955, '2026-09-17T12:02:35.000Z'),
      sample(960, '2026-09-17T12:03:05.000Z'),
      sample(1_230, '2026-09-17T12:03:10.000Z'),
    ]);
    const [first, second] = state.candidates;
    assert.ok(first && second);

    state = respondToCompletionCandidate(state, first.candidateId, 'completed', '2026-09-17T12:04:00.000Z');
    state = observeCompletionLocations(state, 'route-1', [sample(500, '2026-09-19T12:00:00.000Z')]);

    assert.equal(state.candidates.find((item) => item.candidateId === first.candidateId)?.status, 'responded');
    assert.equal(state.candidates.find((item) => item.candidateId === second.candidateId)?.status, 'awaiting_response');
    assert.equal(state.candidates.some((item) => item.status === 'inferred_completed'), false);
  });

  it('permits a new visit only after an explicit not-completed response and supports corrections by revision', () => {
    let state = completeVisit(initialized());
    const original = state.candidates[0];
    assert.ok(original);
    state = respondToCompletionCandidate(state, original.candidateId, 'not_completed', '2026-09-17T12:09:00.000Z');
    state = completeVisit(state, 'route-1', 10);
    assert.equal(state.candidates.length, 2);

    const revisit = state.candidates[1];
    assert.ok(revisit);
    state = respondToCompletionCandidate(state, revisit.candidateId, 'completed', '2026-09-17T13:20:00.000Z');
    state = respondToCompletionCandidate(state, revisit.candidateId, 'failed', '2026-09-17T13:21:00.000Z');
    const corrected = state.candidates.find((item) => item.candidateId === revisit.candidateId);
    assert.equal(corrected?.response, 'failed');
    assert.equal(corrected?.revision, 2);
    const responses = state.commands.filter(
      (command): command is Extract<CompletionCommand, { kind: 'response' }> => (
        command.kind === 'response' && command.candidateId === revisit.candidateId
      ),
    );
    assert.deepEqual(responses.map((command) => command.expectedRevision), [0, 1]);
  });

  it('chains queued offline response corrections per candidate across restart', () => {
    let state = completeVisit(initialized());
    const candidate = state.candidates[0];
    assert.ok(candidate);
    state = {
      ...state,
      candidates: [candidate, {
        ...candidate,
        candidateId: 'independent-candidate',
        deliveryStopId: 'stop-2',
      }],
    };

    state = respondToCompletionCandidate(state, candidate.candidateId, 'completed', '2026-09-17T12:04:00.000Z');
    state = respondToCompletionCandidate(state, 'independent-candidate', 'failed', '2026-09-17T12:04:30.000Z');
    state = respondToCompletionCandidate(state, candidate.candidateId, 'failed', '2026-09-17T12:05:00.000Z');
    state = structuredClone(state);
    state = respondToCompletionCandidate(state, candidate.candidateId, 'not_completed', '2026-09-17T12:06:00.000Z');

    const responses = state.commands.filter(
      (command): command is Extract<CompletionCommand, { kind: 'response' }> => command.kind === 'response',
    );
    const candidateResponses = responses.filter((command) => command.candidateId === candidate.candidateId);
    assert.deepEqual(candidateResponses.map((command) => ({
      commandId: command.commandId,
      previousResponseCommandId: command.previousResponseCommandId,
      response: command.response,
    })), [
      {
        commandId: candidateResponses[0]?.commandId,
        previousResponseCommandId: undefined,
        response: 'completed',
      },
      {
        commandId: candidateResponses[1]?.commandId,
        previousResponseCommandId: candidateResponses[0]?.commandId,
        response: 'failed',
      },
      {
        commandId: candidateResponses[2]?.commandId,
        previousResponseCommandId: candidateResponses[1]?.commandId,
        response: 'not_completed',
      },
    ]);
    assert.equal(
      responses.find((command) => command.candidateId === 'independent-candidate')?.previousResponseCommandId,
      undefined,
    );
  });

  it('invalidates candidates on terminal stop state or reassignment without synthesizing terminal commands', () => {
    let state = completeVisit(initialized());
    const commandCount = state.commands.length;
    state = reconcileCompletionRuns(state, [run({
      assignmentGeneration: 'assignment-2',
      stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'COMPLETED' }],
    })]);

    assert.equal(state.candidates[0]?.status, 'invalidated');
    assert.equal(state.commands.length, commandCount);
    assert.equal(state.candidates[0]?.holdReason, 'assignment_changed');
  });

  it('invalidates a candidate when its expected route version changes', () => {
    let state = completeVisit(initialized());
    const commandCount = state.commands.length;
    state = reconcileCompletionRuns(state, [run({ expectedRouteVersionId: 'route-version-2' })]);

    assert.equal(state.candidates[0]?.status, 'invalidated');
    assert.equal(state.candidates[0]?.holdReason, 'route_version_changed');
    assert.equal(state.commands.length, commandCount);
  });

  it('keeps candidate correction actionable when policy is invalid but assignment context remains valid', () => {
    let state = completeVisit(initialized());
    const candidate = state.candidates[0];
    assert.ok(candidate);

    state = reconcileCompletionRuns(state, [], [runContext()]);

    assert.deepEqual(state.runs, []);
    assert.deepEqual(state.visits, []);
    assert.equal(state.candidates[0]?.status, 'awaiting_response');
    state = respondToCompletionCandidate(state, candidate.candidateId, 'failed', '2026-09-17T12:04:00.000Z');
    assert.equal(state.candidates[0]?.status, 'responded');
  });

  it('still invalidates candidates from invalid-policy context on identity or terminal changes', () => {
    const original = completeVisit(initialized());
    const reassigned = reconcileCompletionRuns(original, [], [runContext(run({
      assignmentGeneration: 'assignment-2',
    }))]);
    assert.equal(reassigned.candidates[0]?.holdReason, 'assignment_changed');

    const terminal = reconcileCompletionRuns(original, [], [runContext(run({
      stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'FAILED' }],
    }))]);
    assert.equal(terminal.candidates[0]?.holdReason, 'stop_terminal');
  });

  it('preserves previous explicit manual state through stale invalid-policy context', () => {
    let state = completeVisit(initialized());
    state = recordCompletionManualResponse(
      state,
      'route-1',
      'stop-1',
      'failed',
      '2026-09-17T12:04:00.000Z',
      { assignmentGeneration: 'assignment-1', expectedRouteVersionId: 'route-version-1' },
    );

    state = reconcileCompletionRuns(state, [], [runContext()]);

    assert.deepEqual(state.runs, []);
    assert.equal(state.candidates[0]?.status, 'responded');
    assert.equal(state.candidates[0]?.response, 'failed');
  });

  it('removes inferred completion projection when the same assignment has a contradictory terminal stop', () => {
    for (const status of ['FAILED', 'CANCELLED', 'SKIPPED']) {
      let state = completeVisit(initialized());
      state = {
        ...state,
        candidates: state.candidates.map((candidate) => ({
          ...candidate,
          autoCompletedAt: '2026-09-18T12:01:10.000Z',
          status: 'inferred_completed',
        })),
      };

      state = reconcileCompletionRuns(state, [run({
        stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status }],
      })]);

      assert.equal(state.candidates[0]?.status, 'invalidated', status);
      assert.equal(state.candidates[0]?.holdReason, `stop_terminal:${status.toLowerCase()}`, status);
    }
  });

  it('keeps inferred delivered completion correctable but projects an explicit manual outcome', () => {
    let inferred = completeVisit(initialized());
    inferred = {
      ...inferred,
      candidates: inferred.candidates.map((candidate) => ({
        ...candidate,
        autoCompletedAt: '2026-09-18T12:01:10.000Z',
        status: 'inferred_completed',
      })),
    };
    const delivered = reconcileCompletionRuns(inferred, [run({
      stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'DELIVERED' }],
    })]);
    assert.equal(delivered.candidates[0]?.status, 'inferred_completed');

    const explicit = reconcileCompletionRuns(inferred, [run({
      stops: [{
        coordinates: { latitude: 0, longitude: 0 },
        deliveryStopId: 'stop-1',
        manualResponse: { response: 'failed', occurredAt: '2026-09-18T12:02:00.000Z' },
        status: 'FAILED',
      }],
    })]);
    assert.equal(explicit.candidates[0]?.status, 'responded');
    assert.equal(explicit.candidates[0]?.response, 'failed');
    assert.equal(explicit.candidates[0]?.responseAt, '2026-09-18T12:02:00.000Z');
  });

  it('preserves local tracking end and explicit response state across stale canonical snapshots', () => {
    let state = completeVisit(initialized());
    const candidate = state.candidates[0];
    assert.ok(candidate);
    state = respondToCompletionCandidate(state, candidate.candidateId, 'completed', '2026-09-17T12:05:00.000Z');
    state = endCompletionTracking(state, 'route-1', '2026-09-17T12:10:00.000Z');
    state = reconcileCompletionRuns(state, [run({
      stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'DELIVERED' }],
    })]);

    assert.equal(state.runs[0]?.trackingEndedAt, '2026-09-17T12:10:00.000Z');
    assert.equal(state.candidates[0]?.status, 'responded');
    assert.equal(state.candidates[0]?.response, 'completed');
  });

  it('durably suppresses detection after a manual stop response even when a stale snapshot says pending', () => {
    let state = initialized();
    state = recordCompletionManualResponse(
      state,
      'route-1',
      'stop-1',
      'completed',
      '2026-09-17T12:00:00.000Z',
    );
    state = reconcileCompletionRuns(state, [run()]);
    state = completeVisit(state);

    assert.equal(state.runs[0]?.stops[0]?.status, 'DELIVERED');
    assert.deepEqual(state.runs[0]?.stops[0]?.manualResponse, {
      response: 'completed',
      occurredAt: '2026-09-17T12:00:00.000Z',
    });
    assert.deepEqual(state.candidates, []);
    assert.deepEqual(state.commands, []);
  });

  it('persists a manual terminal outcome before the run exists and overlays a stale pending snapshot', () => {
    let state = recordCompletionManualResponse(
      emptyCompletionAssistanceState(),
      'route-1',
      'stop-1',
      'failed',
      '2026-09-17T11:59:00.000Z',
      { assignmentGeneration: 'assignment-1', expectedRouteVersionId: 'route-version-1' },
    );
    assert.equal(state.manualOutcomes?.length, 1);

    state = reconcileCompletionRuns(state, [run()]);
    state = completeVisit(state);

    assert.equal(state.runs[0]?.stops[0]?.status, 'FAILED');
    assert.deepEqual(state.candidates, []);
  });

  it('clears pending manual suppression when the server reports a definitive terminal stop', () => {
    let state = recordCompletionManualResponse(
      emptyCompletionAssistanceState(),
      'route-1',
      'stop-1',
      'completed',
      '2026-09-17T11:59:00.000Z',
      { assignmentGeneration: 'assignment-1', expectedRouteVersionId: 'route-version-1' },
    );
    state = reconcileCompletionRuns(state, [run()]);
    state = reconcileCompletionRuns(state, [run({
      stops: [{ coordinates: { latitude: 0, longitude: 0 }, deliveryStopId: 'stop-1', status: 'CANCELLED' }],
    })]);

    assert.equal(state.runs[0]?.stops[0]?.status, 'CANCELLED');
    assert.equal(state.runs[0]?.stops[0]?.manualResponse, undefined);
    assert.equal(state.manualOutcomes, undefined);
  });

  it('applies a manual response only to the current assignment candidate', () => {
    let state = completeVisit(initialized());
    const currentCandidate = state.candidates[0];
    assert.ok(currentCandidate);
    state = {
      ...state,
      candidates: [{
        ...currentCandidate,
        candidateId: 'historical-candidate',
        assignmentGeneration: 'old-assignment',
      }, currentCandidate],
    };

    state = recordCompletionManualResponse(
      state,
      'route-1',
      'stop-1',
      'failed',
      '2026-09-17T12:05:00.000Z',
    );

    assert.equal(state.candidates[0]?.status, 'awaiting_response');
    assert.equal(state.candidates[1]?.status, 'responded');
    assert.equal(state.candidates[1]?.response, 'failed');
    assert.equal(state.commands.filter((command) => command.kind === 'response').length, 1);
  });

  it('keeps at most one active run per route and clears dwell on route version changes', () => {
    let state = initialized();
    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
    ]);
    assert.equal(state.visits.some((visit) => visit.stage === 'dwelling'), true);

    state = reconcileCompletionRuns(state, [
      run({ runId: 'old-run' }),
      run({ expectedRouteVersionId: 'route-version-2' }),
    ]);

    assert.deepEqual(state.runs.map((item) => item.runId), ['run-1']);
    assert.deepEqual(state.visits, []);
  });

  it('clears dwell when policy or destination changes without a route version change', () => {
    let state = initialized();
    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:00:00.000Z'),
      sample(50, '2026-09-17T12:00:05.000Z'),
    ]);
    state = reconcileCompletionRuns(state, [run({ policy: { ...policy, version: 'visit-v2' } })]);
    assert.deepEqual(state.visits, []);

    state = observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T12:02:00.000Z'),
      sample(50, '2026-09-17T12:02:05.000Z'),
    ]);
    state = reconcileCompletionRuns(state, [run({
      policy: { ...policy, version: 'visit-v2' },
      stops: [{
        coordinates: { latitude: metersToLatitude(10), longitude: 0 },
        deliveryStopId: 'stop-1',
        status: 'PENDING',
      }],
    })]);
    assert.deepEqual(state.visits, []);
  });

  it('does not carry local tracking end across an assignment change', () => {
    let state = endCompletionTracking(initialized(), 'route-1', '2026-09-17T12:10:00.000Z');
    state = reconcileCompletionRuns(state, [run({ assignmentGeneration: 'assignment-2' })]);
    assert.equal(state.runs[0]?.trackingEndedAt, undefined);
  });

  it('records return intent and tracking end separately from completion', () => {
    let state = initialized();
    state = recordCompletionReturnIntent(state, 'route-1', '2026-09-17T15:00:00.000Z');
    state = endCompletionTracking(state, 'route-1', '2026-09-17T15:10:00.000Z');

    assert.equal(state.commands.length, 1);
    assert.equal(state.commands[0]?.kind, 'return_intent');
    assert.equal(state.candidates.length, 0);
    assert.equal(state.runs[0]?.trackingEndedAt, '2026-09-17T15:10:00.000Z');
    assert.equal(observeCompletionLocations(state, 'route-1', [
      sample(240, '2026-09-17T15:11:00.000Z'),
      sample(50, '2026-09-17T15:11:05.000Z'),
      sample(45, '2026-09-17T15:11:35.000Z'),
      sample(40, '2026-09-17T15:12:05.000Z'),
      sample(230, '2026-09-17T15:12:10.000Z'),
    ]).candidates.length, 0);
  });

  it('persists return intent before run synchronization and promotes it after tracking end was requested', () => {
    const identity = { assignmentGeneration: 'assignment-1', expectedRouteVersionId: 'route-version-1' };
    let state = recordCompletionReturnIntent(
      emptyCompletionAssistanceState(),
      'route-1',
      '2026-09-17T15:00:00.000Z',
      identity,
    );
    state = endCompletionTracking(state, 'route-1', '2026-09-17T15:10:00.000Z');
    assert.equal(state.pendingReturnIntents?.length, 1);

    state = reconcileCompletionRuns(state, [run()]);

    assert.equal(state.pendingReturnIntents, undefined);
    assert.equal(state.commands.length, 1);
    assert.equal(state.commands[0]?.kind, 'return_intent');
    assert.equal(state.commands[0]?.commandId.includes('2026-09-17T15%3A00%3A00.000Z'), true);
  });

  it('promotes pre-sync return intent when the first matching server run is already ended', () => {
    const identity = { assignmentGeneration: 'assignment-1', expectedRouteVersionId: 'route-version-1' };
    let state = recordCompletionReturnIntent(
      emptyCompletionAssistanceState(),
      'route-1',
      '2026-09-17T15:00:00.000Z',
      identity,
    );

    state = reconcileCompletionRuns(state, [run({ trackingEndedAt: '2026-09-17T15:10:00.000Z' })]);

    assert.equal(state.pendingReturnIntents, undefined);
    assert.equal(state.commands.length, 1);
    assert.equal(state.commands[0]?.kind, 'return_intent');
  });

  it('keeps only the latest pending return intent for each of the latest two assignments', () => {
    let state = emptyCompletionAssistanceState();
    for (let index = 1; index <= 3; index += 1) {
      state = recordCompletionReturnIntent(
        state,
        'route-1',
        `2026-09-17T15:0${index}:00.000Z`,
        { assignmentGeneration: `assignment-${index}`, expectedRouteVersionId: `version-${index}` },
      );
    }
    state = recordCompletionReturnIntent(
      state,
      'route-1',
      '2026-09-17T15:04:00.000Z',
      { assignmentGeneration: 'assignment-3', expectedRouteVersionId: 'version-3' },
    );

    assert.deepEqual(state.pendingReturnIntents?.map((intent) => ({
      assignmentGeneration: intent.assignmentGeneration,
      occurredAt: intent.occurredAt,
    })), [
      { assignmentGeneration: 'assignment-2', occurredAt: '2026-09-17T15:02:00.000Z' },
      { assignmentGeneration: 'assignment-3', occurredAt: '2026-09-17T15:04:00.000Z' },
    ]);
  });
});
