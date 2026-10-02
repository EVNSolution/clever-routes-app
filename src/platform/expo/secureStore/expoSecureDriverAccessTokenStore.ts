import * as SecureStore from 'expo-secure-store';

import { createDriverAccessTokenStore, type DriverAccessTokenStore } from '../../../domain/driver/driverAccessTokenStore';

import { observeDriverAccessStore } from '../../../app/diagnosticAccessObserver';
import {
  clearExpoDriverDiagnosticAccount,
  observeExpoDriverDiagnosticAccess,
  observeExpoDriverDiagnosticBusinessAccessCleared,
} from '../diagnostics/expoDriverDiagnosticRuntime';

let driverAccessTokenStore: DriverAccessTokenStore | null = null;

export function createExpoSecureDriverAccessTokenStore(): DriverAccessTokenStore {
  driverAccessTokenStore ??= observeDriverAccessStore(createDriverAccessTokenStore({ storage: SecureStore }), {
    changed: observeExpoDriverDiagnosticAccess,
    cleared: (cause) => {
      if (cause === 'account_replacement') clearExpoDriverDiagnosticAccount();
      else observeExpoDriverDiagnosticBusinessAccessCleared();
    },
  });
  return driverAccessTokenStore;
}
