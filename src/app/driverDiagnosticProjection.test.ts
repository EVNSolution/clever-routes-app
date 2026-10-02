import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDriverDiagnosticProjection } from './driverDiagnosticProjection';

const start = '2026-10-01T14:00:00.000Z';
test('GPS collection remains visible when storage hangs and a changed reason starts its own interval', () => {
  let at = start;
  const projection = createDriverDiagnosticProjection(() => new Date(at));
  projection.observe({ kind: 'STATE', collectedAt: start, observedAt: start });
  at = '2026-10-01T14:00:15.000Z';
  projection.observe({ kind: 'OPERATION', operation: 'STORAGE_WRITE', phase: 'WATCHDOG_TIMEOUT', reasonCode: 'STORAGE_OPERATION_TIMEOUT', observedAt: at });
  at = '2026-10-01T14:00:30.000Z';
  projection.observe({ kind: 'OPERATION', operation: 'STORAGE_WRITE', phase: 'FAILED', reasonCode: 'STORAGE_WRITE_FAILED', observedAt: at });
  const snapshot = projection.snapshot();
  assert.equal(snapshot.lastGpsCollectedAt, start);
  assert.equal(snapshot.lastGpsPersistedAt, null);
  assert.equal(snapshot.blockers?.[0]?.since, at);
  assert.equal(snapshot.blockers?.[0]?.reason, 'STORAGE_WRITE_FAILED');
  assert.equal(snapshot.snapshotObservedAt, at);
});
test('a different event cannot clear a pending event failure or inherit its start time', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  const failure = { kind: 'OPERATION', operation: 'EVENT_SEND', phase: 'FAILED', reasonCode: 'HTTP_SERVER_ERROR', observedAt: start, clientEventId: 'event-a' } as const;
  projection.observe(failure);
  projection.observe({ ...failure, observedAt: '2026-10-01T14:01:00.000Z', requestId: 'retry' });
  assert.equal(projection.snapshot().blockers?.[0]?.since, start);
  projection.observe({ ...failure, clientEventId: 'event-b', observedAt: '2026-10-01T14:02:00.000Z' });
  assert.equal(projection.snapshot().blockers?.find(x => x.clientEventId === 'event-b')?.since, '2026-10-01T14:02:00.000Z');
  projection.observe({ ...failure, phase: 'SUCCEEDED', clientEventId: 'event-b' });
  assert.deepEqual(projection.snapshot().blockers?.map(x => x.clientEventId), ['event-a']);
  projection.observe({ ...failure, phase: 'SUCCEEDED' });
  assert.equal(projection.snapshot().blockers?.length, 0);
});
test('retained event blockers are bounded while the newest failures remain visible', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  for (let index = 0; index < 30; index++) projection.observe({ kind: 'OPERATION', operation: 'EVENT_SEND', phase: 'FAILED', reasonCode: 'HTTP_SERVER_ERROR', observedAt: start, clientEventId: `event-${index}` });
  assert.equal(projection.snapshot().blockers?.length, 10);
  assert.equal(projection.snapshot().blockers?.at(-1)?.clientEventId, 'event-29');
});
test('a changed failure stage replaces obsolete authentication evidence for the same event', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  const failure = { kind: 'OPERATION', operation: 'EVENT_SEND', phase: 'FAILED', observedAt: start, clientEventId: 'event-a' } as const;
  projection.observe({ ...failure, reasonCode: 'HTTP_UNAUTHORIZED' });
  projection.observe({ ...failure, reasonCode: 'HTTP_SERVER_ERROR', observedAt: '2026-10-01T14:01:00.000Z' });
  assert.deepEqual(projection.snapshot().blockers?.map(x => [x.stage, x.reason, x.since]), [['TRANSPORT', 'HTTP_SERVER_ERROR', '2026-10-01T14:01:00.000Z']]);
});
test('first HTTP failure is recorded without requiring any queued retry', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({ kind: 'OPERATION', operation: 'GPS_SEND', phase: 'STARTED', observedAt: start });
  projection.observe({ kind: 'OPERATION', operation: 'GPS_SEND', phase: 'FAILED', httpStatus: 401, reasonCode: 'HTTP_UNAUTHORIZED', observedAt: start });
  assert.equal(projection.snapshot().businessQueue.retryCount, 0);
  assert.equal(projection.snapshot().blockers?.[0]?.stage, 'AUTH');
  assert.equal(projection.snapshot().lastGpsSendAcknowledgedAt, null);
});
test('fresh contact does not change a previously observed GPS or permission time', () => {
  let at = start;
  const projection = createDriverDiagnosticProjection(() => new Date(at));
  projection.observe({ kind: 'STATE', patch: { locationPermission: 'DENIED' }, blocker: { stage: 'LOCATION', reasonCode: 'LOCATION_PERMISSION_DENIED' }, observedAt: start });
  at = '2026-10-01T14:15:00.000Z';
  const snapshot = projection.snapshot();
  assert.equal(snapshot.snapshotObservedAt, at);
  assert.equal(snapshot.stateObservedAt.locationPermission, start);
  assert.equal(snapshot.lastGpsCollectedAt, null);
  assert.equal(snapshot.blockers?.[0]?.since, start);
});
test('a successful unrelated request cannot clear authentication or storage failure', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({ kind: 'OPERATION', operation: 'AUTH_REFRESH', phase: 'FAILED', reasonCode: 'AUTH_REFRESH_FAILED', observedAt: start });
  projection.observe({ kind: 'OPERATION', operation: 'GPS_SEND', phase: 'SUCCEEDED', observedAt: start });
  assert.equal(projection.snapshot().blockers?.[0]?.stage, 'AUTH');
  projection.observe({ kind: 'OPERATION', operation: 'AUTH_REFRESH', phase: 'SUCCEEDED', observedAt: start });
  assert.equal(projection.snapshot().blockers?.length, 0);
});
test('queue age grows without waiting on business persistence', () => {
  let at = start;
  const projection = createDriverDiagnosticProjection(() => new Date(at));
  projection.setQueue({ queueDepth: 1, retryCount: 0, oldestQueuedAt: start, nextRetryAt: null });
  at = '2026-10-01T14:02:00.000Z';
  assert.equal(projection.snapshot().businessQueue.oldestAgeMs, 120000);
});

test('a successful completion update retry clears a settled update failure', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({
    clientEventId: 'completion-assistance-write:10000000-0000-4000-8000-000000000001',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'FAILED',
    reasonCode: 'STORAGE_WRITE_FAILED',
  });
  projection.observe({
    clientEventId: 'completion-assistance-write:10000000-0000-4000-8000-000000000002',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'SUCCEEDED',
  });

  const snapshot = projection.snapshot();
  assert.deepEqual(snapshot.blockers, []);
  assert.equal(snapshot.lastGpsSendAcknowledgedAt, null);
});

test('a successful storage retry does not clear an unresolved watchdog operation', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({
    clientEventId: 'completion-assistance-write:20000000-0000-4000-8000-000000000001',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'WATCHDOG_TIMEOUT',
    reasonCode: 'STORAGE_OPERATION_TIMEOUT',
  });
  projection.observe({
    clientEventId: 'completion-assistance-write:20000000-0000-4000-8000-000000000002',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'SUCCEEDED',
  });

  assert.deepEqual(projection.snapshot().blockers?.map(({ clientEventId, reason }) => ({ clientEventId, reason })), [{
    clientEventId: 'completion-assistance-write:20000000-0000-4000-8000-000000000001',
    reason: 'STORAGE_OPERATION_TIMEOUT',
  }]);
});

test('a storage success in a new owner projection cannot clear the previous owner failure', () => {
  const ownerA = createDriverDiagnosticProjection(() => new Date(start));
  const ownerB = createDriverDiagnosticProjection(() => new Date(start));
  ownerA.observe({
    clientEventId: 'completion-assistance-read:30000000-0000-4000-8000-000000000001',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_READ',
    phase: 'FAILED',
    reasonCode: 'STORAGE_READ_FAILED',
  });
  ownerB.observe({
    clientEventId: 'completion-assistance-read:30000000-0000-4000-8000-000000000002',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_READ',
    phase: 'SUCCEEDED',
  });

  assert.equal(ownerA.snapshot().blockers?.[0]?.reason, 'STORAGE_READ_FAILED');
  assert.deepEqual(ownerB.snapshot().blockers, []);
});

test('a completion update success cannot clear an unrelated GPS storage failure', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({
    clientEventId: 'location-updated-gpspersist',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'FAILED',
    reasonCode: 'STORAGE_WRITE_FAILED',
  });
  projection.observe({
    clientEventId: 'completion-assistance-write:40000000-0000-4000-8000-000000000002',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'SUCCEEDED',
  });

  assert.equal(projection.snapshot().blockers?.[0]?.clientEventId, 'location-updated-gpspersist');
});

test('a completion update success cannot clear remove failure but a remove retry can', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({
    clientEventId: 'completion-assistance-remove:50000000-0000-4000-8000-000000000001',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'FAILED',
    reasonCode: 'STORAGE_WRITE_FAILED',
  });
  projection.observe({
    clientEventId: 'completion-assistance-write:50000000-0000-4000-8000-000000000002',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'SUCCEEDED',
  });
  assert.equal(projection.snapshot().blockers?.[0]?.clientEventId, 'completion-assistance-remove:50000000-0000-4000-8000-000000000001');

  projection.observe({
    clientEventId: 'completion-assistance-remove:50000000-0000-4000-8000-000000000003',
    kind: 'OPERATION',
    observedAt: start,
    operation: 'STORAGE_WRITE',
    phase: 'SUCCEEDED',
  });
  assert.deepEqual(projection.snapshot().blockers, []);
});
test('task recovery preserves a simultaneous denied permission', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  projection.observe({ kind: 'STATE', observedAt: start, blocker: { stage: 'LOCATION', reasonCode: 'LOCATION_PERMISSION_DENIED' } });
  projection.observe({ kind: 'STATE', observedAt: start, blocker: { stage: 'LOCATION', reasonCode: 'LOCATION_TASK_ERROR' } });
  assert.equal(projection.snapshot().blockers?.length, 2);
  projection.observe({ kind: 'STATE', observedAt: start, clearReasonCodes: ['LOCATION_TASK_ERROR'] });
  assert.deepEqual(projection.snapshot().blockers?.map(x => x.reason), ['LOCATION_PERMISSION_DENIED']);
});
test('recovery produces an immediate transition but repeated normal probes do not', () => {
  const projection = createDriverDiagnosticProjection(() => new Date(start));
  const probe = { kind: 'STATE', observedAt: start, patch: { locationService: 'ENABLED' } } as const;
  assert.equal(projection.observe(probe), true);
  assert.equal(projection.observe({ ...probe, observedAt: '2026-10-01T14:01:00.000Z' }), false);
  projection.observe({ kind: 'OPERATION', operation: 'GPS_SEND', phase: 'FAILED', reasonCode: 'HTTP_SERVER_ERROR', observedAt: start });
  assert.equal(projection.observe({ kind: 'OPERATION', operation: 'GPS_SEND', phase: 'SUCCEEDED', observedAt: start }), true);
  assert.equal(projection.snapshot().lastGpsSendAcknowledgedAt, start);
});
