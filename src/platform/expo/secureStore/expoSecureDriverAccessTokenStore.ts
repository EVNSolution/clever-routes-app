import * as SecureStore from 'expo-secure-store';

import { createDriverAccessTokenStore, type DriverAccessTokenStore } from '../../../domain/driver/driverAccessTokenStore';

let driverAccessTokenStore: DriverAccessTokenStore | null = null;

export function createExpoSecureDriverAccessTokenStore(): DriverAccessTokenStore {
  driverAccessTokenStore ??= createDriverAccessTokenStore({ storage: SecureStore });
  return driverAccessTokenStore;
}
