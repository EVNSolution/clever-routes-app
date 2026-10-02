import type { PersistedActiveRouteSession, PersistedDriverAccess } from '../driver/driverAccessTokenStore';
import type { DriverEventReceiptService } from '../events/driverEventReceipt';
import {
  recoverPendingRouteEndReceipt,
  type OfflineSubmissionQueue,
} from '../offline/offlineSubmissionQueue';

export type CompletionPendingRestoreIdentity = {
  activeRouteSession: PersistedActiveRouteSession;
  driverAccess: PersistedDriverAccess['driverAccess'];
  routeAccess: PersistedDriverAccess['routeAccess'];
};

export async function restoreCompletionPendingBeforeRouteHydration<T>(input: {
  hydrateRoute(): Promise<T>;
  identity: CompletionPendingRestoreIdentity;
  isCurrent?: () => boolean;
  lifecycleSignal?: AbortSignal;
  onPending(identity: CompletionPendingRestoreIdentity): void;
  onResolved(routePlanId: string, resolution: 'acknowledged' | 'reconciliation'): Promise<void>;
  queue: OfflineSubmissionQueue;
  receiptService: DriverEventReceiptService;
}): Promise<{ receiptRecovery: 'acknowledged' | 'pending' | 'reconciliation'; routeResult: T }> {
  const isCurrent = () => input.lifecycleSignal?.aborted !== true && input.isCurrent?.() !== false;
  const requireCurrent = () => {
    if (!isCurrent()) throw Object.assign(new Error('Completion restore lifecycle changed.'), { name: 'AbortError' });
  };
  const hydrateCurrentRoute = async () => {
    requireCurrent();
    const routeResult = await input.hydrateRoute();
    requireCurrent();
    return routeResult;
  };
  let recovery: Awaited<ReturnType<typeof recoverPendingRouteEndReceipt>>;
  try {
    recovery = await recoverPendingRouteEndReceipt({
      driverEventReceiptService: input.receiptService,
      isCurrent,
      ...(input.lifecycleSignal === undefined ? {} : { lifecycleSignal: input.lifecycleSignal }),
      queue: input.queue,
      routePlanId: input.identity.activeRouteSession.routePlanId,
    });
    requireCurrent();
    await input.queue.whenPersisted();
    requireCurrent();
  } catch {
    requireCurrent();
    input.onPending(input.identity);
    return { receiptRecovery: 'pending', routeResult: await hydrateCurrentRoute() };
  }

  if (recovery === 'acknowledged' || recovery === 'reconciliation') {
    requireCurrent();
    await input.onResolved(input.identity.activeRouteSession.routePlanId, recovery);
    requireCurrent();
    return { receiptRecovery: recovery, routeResult: await hydrateCurrentRoute() };
  }

  requireCurrent();
  input.onPending(input.identity);
  return { receiptRecovery: 'pending', routeResult: await hydrateCurrentRoute() };
}
