import * as SecureStore from 'expo-secure-store';

import { createDriverAccessTokenStore, type DriverAccessTokenStore } from '../../../domain/driver/driverAccessTokenStore';

export function createExpoSecureDriverAccessTokenStore(): DriverAccessTokenStore {
  return createDriverAccessTokenStore({ storage: SecureStore });
}
