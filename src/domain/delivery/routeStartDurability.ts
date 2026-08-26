export type RouteStartDurabilityOutcome =
  | { kind: 'completed'; durablyCommitted: boolean }
  | { kind: 'recovery_pending'; error: unknown }
  | { kind: 'rolled_back'; error: unknown };

export async function runRouteStartDurabilityBoundary(input: {
  recover(error: unknown): Promise<void>;
  rollback(error: unknown): Promise<void>;
  run(markDurablyCommitted: () => void): Promise<void>;
}): Promise<RouteStartDurabilityOutcome> {
  let durablyCommitted = false;

  try {
    await input.run(() => { durablyCommitted = true; });
    return { durablyCommitted, kind: 'completed' };
  } catch (error) {
    if (durablyCommitted) {
      await input.recover(error);
      return { error, kind: 'recovery_pending' };
    }
    await input.rollback(error);
    return { error, kind: 'rolled_back' };
  }
}

export function resolveRouteStartRefreshRecovery(input: {
  etaStatus: string | undefined;
  executionStatus: string | undefined;
  hasLocalPickupCompletion: boolean;
  pickupQueueState: 'none' | 'pending' | 'reconciliation';
}): 'pickup_retry' | 'unchanged' {
  return input.executionStatus === 'IN_PROGRESS'
    && input.etaStatus === 'PRE_PICKUP'
    && input.pickupQueueState === 'none'
    && !input.hasLocalPickupCompletion
    ? 'pickup_retry'
    : 'unchanged';
}

export async function runPickupRetryStateMachine<T extends { kind: 'blocked' | 'queued' | 'recorded' }>(input: {
  activateFirstStop(): void;
  onDurablyCommitted(result: T): Promise<void>;
  persistLocalCompletion(result: T): Promise<boolean>;
  persistQueued(result: T): Promise<void>;
  recordPickup(): Promise<T>;
  setRecoveryState(state: 'idle' | 'sync_pending'): void;
}): Promise<{ kind: 'blocked' | 'completed' | 'local_save_failed'; result: T }> {
  const result = await input.recordPickup();
  if (result.kind === 'blocked') return { kind: 'blocked', result };
  if (result.kind === 'queued') await input.persistQueued(result);

  input.setRecoveryState('sync_pending');
  await input.onDurablyCommitted(result);
  if (!await input.persistLocalCompletion(result)) {
    return { kind: 'local_save_failed', result };
  }

  input.setRecoveryState('idle');
  input.activateFirstStop();
  return { kind: 'completed', result };
}
