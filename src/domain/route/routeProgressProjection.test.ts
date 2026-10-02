import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectRouteProgress } from './routeProgressProjection';

describe('route progress projection', () => {
  it('keeps locally completed and server-confirmed stops independent', () => {
    assert.deepEqual(projectRouteProgress({
      localCompletedStopIds: ['stop-1', 'stop-2'],
      serverConfirmedStopIds: ['stop-1'],
      totalStops: 11,
    }), {
      localCompletedCount: 2,
      localCompletedStopIds: ['stop-1', 'stop-2'],
      serverConfirmedCount: 1,
      serverConfirmedStopIds: ['stop-1'],
      syncState: 'blocked',
      totalStops: 11,
    });
  });

  it('reports convergence only when local and server stop sets match', () => {
    assert.equal(projectRouteProgress({
      localCompletedStopIds: ['stop-2', 'stop-1'],
      serverConfirmedStopIds: ['stop-1', 'stop-2'],
      totalStops: 2,
    }).syncState, 'confirmed');
  });
});
