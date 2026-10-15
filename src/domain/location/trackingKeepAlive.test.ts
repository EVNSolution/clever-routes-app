import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideServiceAfterTaskResult,
  SERVER_ENDED_ACK_GRACE_MS,
} from './trackingKeepAlive';

const now = 1_000_000;
const ended = { kind: 'deactivated', reason: 'route_not_in_progress', routePlanId: 'r1', sessionGeneration: 'g1' } as const;
const revoked = { kind: 'deactivated', reason: 'route_revoked', routePlanId: 'r1', sessionGeneration: 'g1' } as const;
const preStartEnded = { kind: 'deactivated', reason: 'pre_start_ended', routePlanId: 'r1', sessionGeneration: 'g1' } as const;
const inactive = { kind: 'ignored', reason: 'inactive_route' } as const;
const processed = { kind: 'processed', recordedCount: 3, routePlanId: 'r1' } as const;

describe('tracking keep-alive after the server ends or revokes a route', () => {
  it('keeps the service running and asks for a notice when the server ended the route', () => {
    assert.deepEqual(decideServiceAfterTaskResult({ now, result: ended, serverEndedAt: null }),
      { action: 'keep', notifyServerEnded: true, serverEndedAt: now });
    assert.deepEqual(decideServiceAfterTaskResult({ now, result: revoked, serverEndedAt: null }),
      { action: 'keep', notifyServerEnded: true, serverEndedAt: now });
  });

  it('does not repeat the notice for the same ended route', () => {
    assert.deepEqual(decideServiceAfterTaskResult({ now: now + 10_000, result: ended, serverEndedAt: now }),
      { action: 'keep', notifyServerEnded: false, serverEndedAt: now });
  });

  it('keeps the service while the driver has not confirmed, then lets it stop after the grace time', () => {
    assert.deepEqual(decideServiceAfterTaskResult({ now: now + 60_000, result: inactive, serverEndedAt: now }),
      { action: 'keep', notifyServerEnded: false, serverEndedAt: now });
    assert.deepEqual(decideServiceAfterTaskResult({ now: now + SERVER_ENDED_ACK_GRACE_MS, result: inactive, serverEndedAt: now }),
      { action: 'stop_if_inactive', notifyServerEnded: false, serverEndedAt: null });
  });

  it('stops an inactive service at once when no server end is pending, and for tracking before Start that aged out', () => {
    assert.deepEqual(decideServiceAfterTaskResult({ now, result: inactive, serverEndedAt: null }),
      { action: 'stop_if_inactive', notifyServerEnded: false, serverEndedAt: null });
    assert.deepEqual(decideServiceAfterTaskResult({ now, result: preStartEnded, serverEndedAt: null }),
      { action: 'stop_if_inactive', notifyServerEnded: false, serverEndedAt: null });
  });

  it('clears a pending server end once a batch is processed again', () => {
    assert.deepEqual(decideServiceAfterTaskResult({ now, result: processed, serverEndedAt: now - 5_000 }),
      { action: 'keep', notifyServerEnded: false, serverEndedAt: null });
  });
});
