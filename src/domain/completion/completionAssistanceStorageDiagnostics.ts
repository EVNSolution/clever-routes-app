import type {
  DriverDiagnosticOperation,
  DriverDiagnosticOperationObserver,
} from '../diagnostics/driverDiagnosticObservation';
import type { CompletionAssistanceRawStorage } from './completionAssistanceSync';

type CaptureOperationObserver = (accountOwnerHash: string) => DriverDiagnosticOperationObserver;

export function observeCompletionAssistanceStorage(
  storage: CompletionAssistanceRawStorage,
  captureObserver: CaptureOperationObserver,
  clientEventIdFactory: () => string,
): CompletionAssistanceRawStorage {
  const observe = <T>(
    accountOwnerHash: string,
    resource: 'read' | 'remove' | 'write',
    diagnosticOperation: Extract<DriverDiagnosticOperation, 'STORAGE_READ' | 'STORAGE_WRITE'>,
    operation: () => Promise<T>,
  ) => (
    captureObserver(accountOwnerHash)({
      operation: diagnosticOperation,
      clientEventId: `completion-assistance-${resource}:${clientEventIdFactory()}`,
    }, operation)
  );

  return {
    readCompletionAssistanceState: (accountOwnerHash) => observe(
      accountOwnerHash,
      'read',
      'STORAGE_READ',
      () => storage.readCompletionAssistanceState(accountOwnerHash),
    ),
    removeCompletionAssistanceState: (accountOwnerHash) => observe(
      accountOwnerHash,
      'remove',
      'STORAGE_WRITE',
      () => storage.removeCompletionAssistanceState(accountOwnerHash),
    ),
    updateCompletionAssistanceState: (accountOwnerHash, mutate) => observe(
      accountOwnerHash,
      'write',
      'STORAGE_WRITE',
      () => storage.updateCompletionAssistanceState(accountOwnerHash, mutate),
    ),
  };
}
