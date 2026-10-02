import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  observeLocationTaskCallback,
  observeLocationTaskResult,
  probeLocationDiagnosticStates,
  runObservedLocationOperation,
  startLocationTaskProcessingWatchdog,
  type LocationDiagnosticObservation,
} from './locationDiagnosticOrchestration';

describe('location diagnostic orchestration', () => {
  it('observes the callback and newest valid collection time before business processing can stall', async () => {
    const observations: LocationDiagnosticObservation[] = [];
    let releaseBusinessProcessing!: () => void;
    const stalled = new Promise<void>((resolve) => { releaseBusinessProcessing = resolve; });

    observeLocationTaskCallback({
      callbackAt: new Date('2026-10-01T14:04:20.000Z'),
      locationTimestamps: [
        Number.NaN,
        1e300,
        Date.parse('2026-10-01T14:03:59.000Z'),
        Date.parse('2026-10-01T14:04:03.349Z'),
      ],
      observe: (observation) => observations.push(observation),
    });
    const businessProcessing = stalled;

    assert.deepEqual(observations, [{
      callbackAt: '2026-10-01T14:04:20.000Z',
      collectedAt: '2026-10-01T14:04:03.349Z',
      type: 'LOCATION_TASK_CALLBACK',
    }]);

    releaseBusinessProcessing();
    await businessProcessing;
  });

  it('records operation attempt and failure without changing the thrown business error', async () => {
    const observations: LocationDiagnosticObservation[] = [];
    const failure = new Error('native detail must not enter diagnostics');

    await assert.rejects(
      runObservedLocationOperation({
        execute: async () => { throw failure; },
        observe: (observation) => observations.push(observation),
        operation: 'START',
      }),
      (error) => error === failure,
    );

    assert.deepEqual(observations, [
      { operation: 'START', phase: 'ATTEMPT', type: 'LOCATION_TASK_OPERATION' },
      { operation: 'START', phase: 'ERROR', type: 'LOCATION_TASK_OPERATION' },
    ]);
    assert.doesNotMatch(JSON.stringify(observations), /native detail/u);
  });

  it('distinguishes an expected stop from route and session mismatch results', () => {
    const observations: LocationDiagnosticObservation[] = [];
    const observe = (observation: LocationDiagnosticObservation) => observations.push(observation);

    observeLocationTaskResult({ kind: 'ignored', reason: 'completion_pending' }, observe);
    observeLocationTaskResult({
      kind: 'deactivated',
      reason: 'route_not_in_progress',
      routePlanId: 'route-1',
      sessionGeneration: 'session-1',
    }, observe);
    observeLocationTaskResult({
      kind: 'deactivated',
      reason: 'route_revoked',
      routePlanId: 'route-1',
      sessionGeneration: 'session-1',
    }, observe);

    assert.deepEqual(observations, [
      { reason: 'COMPLETION_PENDING', type: 'LOCATION_TASK_EXPECTED_STOP' },
      {
        reason: 'ROUTE_NOT_IN_PROGRESS',
        routePlanId: 'route-1',
        sessionGeneration: 'session-1',
        type: 'LOCATION_TASK_CONTEXT_BLOCKED',
      },
      {
        reason: 'ROUTE_REVOKED',
        routePlanId: 'route-1',
        sessionGeneration: 'session-1',
        type: 'LOCATION_TASK_CONTEXT_BLOCKED',
      },
    ]);
  });

  it('reports a stalled business processing stage without cancelling that business work', () => {
    const observations: LocationDiagnosticObservation[] = [];
    let watchdog!: () => void;
    let cancelled = false;
    const handle = startLocationTaskProcessingWatchdog({
      cancel: () => { cancelled = true; },
      observe: (observation) => observations.push(observation),
      schedule: (run) => { watchdog = run; return 'timer'; },
    });

    watchdog();
    assert.deepEqual(observations, [{ type: 'LOCATION_TASK_PROCESSING_TIMEOUT' }]);
    assert.equal(cancelled, false);

    handle.complete();
    assert.equal(cancelled, true);
  });

  it('keeps service and task probes observable when permissions fail, then clears only recovered reasons', async () => {
    const emitted: unknown[] = [];
    await probeLocationDiagnosticStates({
      emit: (observation) => emitted.push(observation),
      getBackgroundPermission: async () => ({ granted: false }),
      getForegroundPermission: async () => { throw new Error('permission API unavailable'); },
      getServicesEnabled: async () => false,
      getTaskStarted: async () => true,
    });

    assert.deepEqual(emitted, [
      {
        blocker: { reasonCode: 'LOCATION_PERMISSION_STATUS_FAILED', stage: 'LOCATION' },
        kind: 'STATE',
        patch: { locationPermission: 'UNKNOWN' },
      },
      {
        blocker: { reasonCode: 'LOCATION_SERVICES_DISABLED', stage: 'LOCATION' },
        clearReasonCodes: ['LOCATION_SERVICE_STATUS_FAILED'],
        kind: 'STATE',
        patch: { locationService: 'DISABLED' },
      },
      {
        clearReasonCodes: ['LOCATION_TASK_ERROR', 'LOCATION_TASK_STATUS_FAILED'],
        kind: 'STATE',
        patch: { locationTask: 'STARTED' },
      },
    ]);

    const recovered: unknown[] = [];
    await probeLocationDiagnosticStates({
      emit: (observation) => recovered.push(observation),
      getBackgroundPermission: async () => ({ granted: true }),
      getForegroundPermission: async () => ({ granted: true }),
      getServicesEnabled: async () => true,
      getTaskStarted: async () => false,
    });

    assert.deepEqual(recovered, [
      {
        clearReasonCodes: ['LOCATION_PERMISSION_DENIED', 'LOCATION_PERMISSION_STATUS_FAILED'],
        kind: 'STATE',
        patch: { locationPermission: 'GRANTED_ALWAYS' },
      },
      {
        clearReasonCodes: ['LOCATION_SERVICES_DISABLED', 'LOCATION_SERVICE_STATUS_FAILED'],
        kind: 'STATE',
        patch: { locationService: 'ENABLED' },
      },
      {
        clearReasonCodes: ['LOCATION_TASK_ERROR', 'LOCATION_TASK_STATUS_FAILED'],
        kind: 'STATE',
        patch: { locationTask: 'STOPPED' },
      },
    ]);
  });

  it('reports a task status query failure as unknown without claiming the task failed', async () => {
    const emitted: unknown[] = [];
    await probeLocationDiagnosticStates({
      emit: (observation) => emitted.push(observation),
      getBackgroundPermission: async () => ({ granted: true }),
      getForegroundPermission: async () => ({ granted: true }),
      getServicesEnabled: async () => true,
      getTaskStarted: async () => { throw new Error('query unavailable'); },
    });

    assert.deepEqual(emitted[2], {
      blocker: { reasonCode: 'LOCATION_TASK_STATUS_FAILED', stage: 'LOCATION' },
      kind: 'STATE',
      patch: { locationTask: 'UNKNOWN' },
    });
  });
});
