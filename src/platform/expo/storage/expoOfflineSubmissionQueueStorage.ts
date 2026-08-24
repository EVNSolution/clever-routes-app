import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import {
  createPersistentOfflineSubmissionQueue,
  type OfflineSubmissionQueue,
} from '../../../domain/offline/offlineSubmissionQueue';
import {
  createEncryptedEvidenceStore,
  type EvidenceDatabase,
} from './expoEncryptedEvidenceStore';

let offlineSubmissionQueuePromise: Promise<OfflineSubmissionQueue> | null = null;

export async function createExpoOfflineSubmissionQueueStorage() {
  return createEncryptedEvidenceStore({
    keyStore: {
      getItemAsync: (key) => SecureStore.getItemAsync(key, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    },
    legacyStorage: AsyncStorage,
    openDatabaseAsync: async (databaseName) => adaptDatabase(await SQLite.openDatabaseAsync(databaseName)),
    randomBytes: Crypto.getRandomBytesAsync,
    sha256: async (value) => new Uint8Array(await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      Uint8Array.from(value).buffer,
    )),
  });
}

export function getExpoOfflineSubmissionQueue(): Promise<OfflineSubmissionQueue> {
  if (offlineSubmissionQueuePromise === null) {
    offlineSubmissionQueuePromise = createExpoOfflineSubmissionQueueStorage()
      .then((storage) => createPersistentOfflineSubmissionQueue({ storage }))
      .catch((error: unknown) => {
        offlineSubmissionQueuePromise = null;
        throw error;
      });
  }
  return offlineSubmissionQueuePromise;
}

function adaptDatabase(database: SQLite.SQLiteDatabase): EvidenceDatabase {
  return {
    execAsync: (sql) => database.execAsync(sql),
    getAllAsync: <T>(sql: string, ...params: unknown[]) => database.getAllAsync<T>(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    getFirstAsync: <T>(sql: string, ...params: unknown[]) => database.getFirstAsync<T>(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    runAsync: (sql, ...params) => database.runAsync(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    withExclusiveTransactionAsync: (operation) => database.withExclusiveTransactionAsync(
      async (transaction) => operation(adaptDatabase(transaction)),
    ),
  };
}
