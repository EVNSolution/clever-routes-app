import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import type { DiagnosticStorage } from '../../../domain/diagnostics/driverDiagnosticOutbox';
import {
  createDiagnosticStorage,
  type DiagnosticDatabase,
} from './diagnosticStorage';

let diagnosticStoragePromise: Promise<DiagnosticStorage> | null = null;

export function getExpoDiagnosticStorage(): Promise<DiagnosticStorage> {
  diagnosticStoragePromise ??= createDiagnosticStorage({
    keyStore: {
      getItemAsync: (key) => SecureStore.getItemAsync(key, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
      setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
    },
    openDatabaseAsync: async (databaseName) => adaptDatabase(await SQLite.openDatabaseAsync(databaseName)),
    randomBytes: Crypto.getRandomBytesAsync,
  }).catch((error: unknown) => {
    diagnosticStoragePromise = null;
    throw error;
  });
  return diagnosticStoragePromise;
}

function adaptDatabase(
  database: SQLite.SQLiteDatabase,
  keyPragma: { value: string | null } = { value: null },
): DiagnosticDatabase {
  return {
    execAsync: async (sql) => {
      if (sql.startsWith('PRAGMA key = ')) keyPragma.value = sql;
      await database.execAsync(sql);
    },
    getAllAsync: <T>(sql: string, ...params: unknown[]) => database.getAllAsync<T>(
      sql,
      ...(params as SQLite.SQLiteVariadicBindParams),
    ),
    getFirstAsync: <T>(sql: string, ...params: unknown[]) => database.getFirstAsync<T>(
      sql,
      ...(params as SQLite.SQLiteVariadicBindParams),
    ),
    runAsync: (sql, ...params) => database.runAsync(sql, ...(params as SQLite.SQLiteVariadicBindParams)),
    withExclusiveTransactionAsync: (operation) => database.withExclusiveTransactionAsync(async (transaction) => {
      const keyPragmaSql = keyPragma.value;
      if (keyPragmaSql === null) throw new Error('Encrypted diagnostic database key was not applied.');
      await transaction.execAsync(keyPragmaSql);
      await operation(adaptDatabase(transaction, keyPragma));
    }),
  };
}
