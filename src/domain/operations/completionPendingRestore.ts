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
  onPending(identity: CompletionPendingRestoreIdentity): void;
  onResolved(routePlanId: string, resolution: 'acknowledged' | 'reconciliation'): Promise<void>;
  queue: OfflineSubmissionQueue;
  receiptService: DriverEventReceiptService;
}): Promise<{ receiptRecovery: 'acknowledged' | 'pending' | 'reconciliation'; routeResult: T }> {
  let recovery: Awaited<ReturnType<typeof recoverPendingRouteEndReceipt>>;
  try {
    recovery = await recoverPendingRouteEndReceipt({
      driverEventReceiptService: input.receiptService,
      queue: input.queue,
      routePlanId: input.identity.activeRouteSession.routePlanId,
    });
    await input.queue.whenPersisted();
  } catch {
    input.onPending(input.identity);
    return { receiptRecovery: 'pending', routeResult: await input.hydrateRoute() };
  }

  if (recovery === 'acknowledged' || recovery === 'reconciliation') {
    await input.onResolved(input.identity.activeRouteSession.routePlanId, recovery);
    return { receiptRecovery: recovery, routeResult: await input.hydrateRoute() };
  }

  input.onPending(input.identity);
  return { receiptRecovery: 'pending', routeResult: await input.hydrateRoute() };
}
