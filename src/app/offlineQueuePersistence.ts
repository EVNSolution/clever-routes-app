import { captureDriverDiagnosticOperationObserver, observeDriverDiagnosticOperation } from '../domain/diagnostics/driverDiagnosticObservation';
import type { OfflineSubmissionQueue } from '../domain/offline/offlineSubmissionQueue';

export async function persistOfflineQueueAndSyncState<Queue extends Pick<OfflineSubmissionQueue, 'whenPersisted'>>(
  queue: Queue,
  syncState: (queue: Queue) => void,
): Promise<void> {
  try {
    await observeDriverDiagnosticOperation({operation:'STORAGE_WRITE'},()=>queue.whenPersisted());
  } finally {
    syncState(queue);
  }
}

/** Same queue behavior, with a diagnostic-only observer pinned to this account scope. */
export function observeOfflineQueuePersistence<Queue extends Pick<OfflineSubmissionQueue,'whenPersisted'>>(queue:Queue):Queue {
  const observe=captureDriverDiagnosticOperationObserver();
  return {...queue,whenPersisted:()=>observe({operation:'STORAGE_WRITE'},()=>queue.whenPersisted())};
}
