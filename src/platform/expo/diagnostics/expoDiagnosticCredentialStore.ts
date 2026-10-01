import * as SecureStore from 'expo-secure-store';

import type { DiagnosticCredentialStore } from '../../../domain/diagnostics/driverDiagnosticTransport';
import { createDiagnosticCredentialStore } from './diagnosticCredentialStore';

let diagnosticCredentialStore: DiagnosticCredentialStore | null = null;

export function getExpoDiagnosticCredentialStore(): DiagnosticCredentialStore {
  diagnosticCredentialStore ??= createDiagnosticCredentialStore({
    storage: {
      deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
      getItemAsync: (key) => SecureStore.getItemAsync(key, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
    },
  });
  return diagnosticCredentialStore;
}
