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
      Uint8Array.from(value),
    )),
  });
}

export function getExpoOfflineSubmissionQueue(): Promise<OfflineSubmissionQueue> {
  if (offlineSubmissionQueuePromise === null) {
    offlineSubmissionQueuePromise = createExpoOfflineSubmissionQueueStorage()
      .then((storage) => createPersistentOfflineSubmissionQueue({ accountOwnerHash: null, storage }))
      .catch((error: unknown) => {
        offlineSubmissionQueuePromise = null;
        throw error;
      });
  }
  return offlineSubmissionQueuePromise;
}

export async function bindExpoOfflineSubmissionQueueAccount(phoneE164: string): Promise<OfflineSubmissionQueue> {
  const ownerHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `clever-driver-account:${phoneE164.trim()}`,
  );
  const queue = await getExpoOfflineSubmissionQueue();
  queue.bindAccountOwnerHash(ownerHash.toLowerCase());
  await queue.whenPersisted();
  return queue;
}

function adaptDatabase(
  database: SQLite.SQLiteDatabase,
  keyPragma: { value: string | null } = { value: null },
): EvidenceDatabase {
  return {
    execAsync: async (sql) => {
      if (sql.startsWith('PRAGMA key = ')) keyPragma.value = sql;
      await database.execAsync(sql);
    },
    getAllAsync: <T>(sql: string, ...params: unknown[]) => database.getAllAsync<T>(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    getFirstAsync: <T>(sql: string, ...params: unknown[]) => database.getFirstAsync<T>(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    runAsync: (sql, ...params) => database.runAsync(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    withExclusiveTransactionAsync: (operation) => database.withExclusiveTransactionAsync(async (transaction) => {
      const keyPragmaSql = keyPragma.value;
      if (keyPragmaSql === null) throw new Error('Encrypted evidence database key was not applied.');
      await transaction.execAsync(keyPragmaSql);
      await operation(adaptDatabase(transaction, keyPragma));
    }),
  };
}
