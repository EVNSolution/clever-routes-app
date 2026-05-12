import * as SecureStore from 'expo-secure-store';

import { createDriverAccessTokenStore, type DriverAccessTokenStore } from './driverAccessTokenStore';

export function createExpoSecureDriverAccessTokenStore(): DriverAccessTokenStore {
  return createDriverAccessTokenStore({ storage: SecureStore });
}
