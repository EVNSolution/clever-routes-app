import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveRouteStartRefreshRecovery,
  runPickupRetryStateMachine,
  runRouteStartDurabilityBoundary,
} from './routeStartDurability';

describe('route start durable commit boundary', () => {
  it('rolls back when route start fails before durable server or queue evidence', async () => {
    const actions: string[] = [];
    const outcome = await runRouteStartDurabilityBoundary({
      recover: async () => { actions.push('recover'); },
      rollback: async () => { actions.push('rollback'); },
      run: async () => { throw new Error('queue persistence failed'); },
    });

    assert.equal(outcome.kind, 'rolled_back');
    assert.deepEqual(actions, ['rollback']);
  });

  it('keeps the active session for recovery when a later step fails after durable commit', async () => {
    const actions: string[] = [];
    const outcome = await runRouteStartDurabilityBoundary({
      recover: async () => { actions.push('recover'); },
      rollback: async () => { actions.push('rollback'); },
      run: async (markDurablyCommitted) => {
        markDurablyCommitted();
        throw new Error('pickup persistence failed');
      },
    });

    assert.equal(outcome.kind, 'recovery_pending');
    assert.deepEqual(actions, ['recover']);
  });

  it('reopens only Store Pickup after refresh confirms an active pre-pickup route with no pickup evidence', () => {
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'PRE_PICKUP',
      executionStatus: 'IN_PROGRESS',
      hasLocalPickupCompletion: false,
      pickupQueueState: 'none',
    }), 'pickup_retry');
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'PRE_PICKUP',
      executionStatus: 'IN_PROGRESS',
      hasLocalPickupCompletion: false,
      pickupQueueState: 'reconciliation',
    }), 'unchanged');
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'READY',
      executionStatus: 'IN_PROGRESS',
      hasLocalPickupCompletion: false,
      pickupQueueState: 'none',
    }), 'unchanged');
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'PRE_PICKUP',
      executionStatus: 'READY',
      hasLocalPickupCompletion: false,
      pickupQueueState: 'none',
    }), 'unchanged');
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'PRE_PICKUP',
      executionStatus: 'IN_PROGRESS',
      hasLocalPickupCompletion: true,
      pickupQueueState: 'none',
    }), 'unchanged');
    assert.equal(resolveRouteStartRefreshRecovery({
      etaStatus: 'PRE_PICKUP',
      executionStatus: 'IN_PROGRESS',
      hasLocalPickupCompletion: false,
      pickupQueueState: 'pending',
    }), 'unchanged');
  });

  it('moves a server-recorded pickup through sync pending to stop 1 after local save', async () => {
    const actions: string[] = [];
    const outcome = await runPickupRetryStateMachine({
      activateFirstStop: () => { actions.push('stop:1'); },
      onDurablyCommitted: async () => { actions.push('durable'); },
      persistLocalCompletion: async () => { actions.push('local'); return true; },
      persistQueued: async () => { actions.push('queue'); },
      recordPickup: async () => { actions.push('recorded'); return { kind: 'recorded' as const }; },
      setRecoveryState: (state) => { actions.push(`state:${state}`); },
    });

    assert.equal(outcome.kind, 'completed');
    assert.deepEqual(actions, ['recorded', 'state:sync_pending', 'durable', 'local', 'state:idle', 'stop:1']);
  });

  it('waits for queued pickup persistence before entering sync pending and completing locally', async () => {
    const actions: string[] = [];
    const outcome = await runPickupRetryStateMachine({
      activateFirstStop: () => { actions.push('stop:1'); },
      onDurablyCommitted: async () => { actions.push('durable'); },
      persistLocalCompletion: async () => { actions.push('local'); return true; },
      persistQueued: async () => { actions.push('queue:persisted'); },
      recordPickup: async () => { actions.push('queued'); return { kind: 'queued' as const }; },
      setRecoveryState: (state) => { actions.push(`state:${state}`); },
    });

    assert.equal(outcome.kind, 'completed');
    assert.deepEqual(actions, ['queued', 'queue:persisted', 'state:sync_pending', 'durable', 'local', 'state:idle', 'stop:1']);
  });

  it('stays sync pending when the durable pickup cannot be saved to the active session', async () => {
    const actions: string[] = [];
    const outcome = await runPickupRetryStateMachine({
      activateFirstStop: () => { actions.push('stop:1'); },
      onDurablyCommitted: async () => { actions.push('durable'); },
      persistLocalCompletion: async () => { actions.push('local:failed'); return false; },
      persistQueued: async () => { actions.push('queue'); },
      recordPickup: async () => ({ kind: 'recorded' as const }),
      setRecoveryState: (state) => { actions.push(`state:${state}`); },
    });

    assert.equal(outcome.kind, 'local_save_failed');
    assert.deepEqual(actions, ['state:sync_pending', 'durable', 'local:failed']);
  });
});
