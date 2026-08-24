import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { createDriverSyncIdentity } from '../../../domain/operations/driverSyncIdentity';

let identity: ReturnType<typeof createDriverSyncIdentity> | null = null;

export function getExpoDriverSyncIdentity() {
  identity ??= createDriverSyncIdentity({
    async createDeviceInstanceHash() {
      const random = Crypto.getRandomBytes(32);
      const seed = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, seed);
    },
    storage: {
      getItemAsync: (key) => SecureStore.getItemAsync(key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    },
  });
  return identity;
}
