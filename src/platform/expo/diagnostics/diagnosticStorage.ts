import {
  isDriverDiagnosticPermanentRejectionCode,
  sanitizeDriverDiagnosticRecord,
  type DriverDiagnosticRecord,
  type DriverDiagnosticQuarantineEntry,
} from '../../../domain/diagnostics/driverDiagnosticContract';
import type { DiagnosticStorage } from '../../../domain/diagnostics/driverDiagnosticOutbox';

export const DRIVER_DIAGNOSTIC_DATABASE_NAME = 'clever_driver_diagnostics_v1.db';
export const DRIVER_DIAGNOSTIC_DATABASE_KEY_STORAGE_KEY = 'clever.driverDiagnostics.sqlcipherKey.v1';
export const DRIVER_DIAGNOSTIC_DATABASE_SCHEMA_VERSION = 2;
export const DRIVER_DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DRIVER_DIAGNOSTIC_MAX_RECORDS = 1_000;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

export type DiagnosticDatabase = {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  withExclusiveTransactionAsync(operation: (database: DiagnosticDatabase) => Promise<void>): Promise<void>;
};

type DiagnosticKeyStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type StoredDiagnosticRow = {
  diagnosticId: string;
  payload: string;
};

export async function createDiagnosticStorage(input: {
  databaseName?: string;
  keyStore: DiagnosticKeyStore;
  maxRecords?: number;
  now?: () => Date;
  openDatabaseAsync: (databaseName: string) => Promise<DiagnosticDatabase>;
  randomBytes: (length: number) => Promise<Uint8Array>;
  retentionMs?: number;
}): Promise<DiagnosticStorage> {
  const maxRecords = input.maxRecords ?? DRIVER_DIAGNOSTIC_MAX_RECORDS;
  const now = input.now ?? (() => new Date());
  const retentionMs = input.retentionMs ?? DRIVER_DIAGNOSTIC_RETENTION_MS;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('Diagnostic record limit must be a positive integer.');
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 1) throw new Error('Diagnostic retention must be a positive integer.');

  const existingKey = await input.keyStore.getItemAsync(DRIVER_DIAGNOSTIC_DATABASE_KEY_STORAGE_KEY);
  const generatedKey = existingKey === null;
  const key = existingKey ?? bytesToHex(await input.randomBytes(32));
  if (!/^[0-9a-f]{64}$/u.test(key)) {
    throw new Error('Encrypted diagnostic database key is missing or invalid. Preserve the database for support recovery.');
  }

  const database = await input.openDatabaseAsync(input.databaseName ?? DRIVER_DIAGNOSTIC_DATABASE_NAME);
  const keyPragma = `PRAGMA key = "x'${key}'";`;
  await database.execAsync(keyPragma);
  const cipher = await database.getFirstAsync<{ cipher_version?: string | null }>('PRAGMA cipher_version;');
  if (cipher?.cipher_version === null || cipher?.cipher_version === undefined || cipher.cipher_version.trim() === '') {
    throw new Error('SQLCipher is unavailable in this native build. Diagnostic storage is disabled.');
  }
  try {
    await database.getFirstAsync('SELECT name FROM sqlite_master LIMIT 1;');
  } catch {
    throw new Error('Encrypted diagnostic database key is missing or invalid. Preserve the database for support recovery.');
  }
  if (generatedKey) await input.keyStore.setItemAsync(DRIVER_DIAGNOSTIC_DATABASE_KEY_STORAGE_KEY, key);

  const version = (await database.getFirstAsync<{ user_version?: number }>('PRAGMA user_version;'))?.user_version ?? 0;
  if (version > DRIVER_DIAGNOSTIC_DATABASE_SCHEMA_VERSION) {
    throw new Error(`Encrypted diagnostic database uses newer schema version ${version}; downgrade is blocked.`);
  }
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS diagnostic_records (
      account_owner_hash TEXT NOT NULL,
      diagnostic_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (account_owner_hash, diagnostic_id)
    );
    CREATE INDEX IF NOT EXISTS diagnostic_records_owner_observed
      ON diagnostic_records (account_owner_hash, observed_at, diagnostic_id);
    CREATE TABLE IF NOT EXISTS diagnostic_quarantine (
      account_owner_hash TEXT NOT NULL,
      diagnostic_id TEXT NOT NULL,
      quarantined_at TEXT NOT NULL,
      rejection_code TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (account_owner_hash, diagnostic_id)
    );
    CREATE INDEX IF NOT EXISTS diagnostic_quarantine_owner_quarantined
      ON diagnostic_quarantine (account_owner_hash, quarantined_at, diagnostic_id);
    PRAGMA user_version = ${DRIVER_DIAGNOSTIC_DATABASE_SCHEMA_VERSION};
  `);

  async function inEncryptedTransaction(operation: (transaction: DiagnosticDatabase) => Promise<void>) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(keyPragma);
      await operation(transaction);
    });
  }

  async function removeRows(accountOwnerHash: string, diagnosticIds: readonly string[]) {
    if (diagnosticIds.length === 0) return;
    await inEncryptedTransaction(async (transaction) => {
      for (const diagnosticId of new Set(diagnosticIds)) {
        await transaction.runAsync(
          'DELETE FROM diagnostic_records WHERE account_owner_hash = ? AND diagnostic_id = ?;',
          accountOwnerHash,
          diagnosticId,
        );
      }
    });
  }

  return {
    append: async (accountOwnerHash, records) => {
      assertAccountOwnerHash(accountOwnerHash);
      const sanitized = records.map((record) => {
        const parsed = sanitizeDriverDiagnosticRecord(record);
        if (parsed === null) throw new Error('Cannot persist invalid diagnostic record.');
        return parsed;
      });
      if (sanitized.length === 0) return;
      await inEncryptedTransaction(async (transaction) => {
        for (const record of sanitized) {
          await transaction.runAsync(
            `INSERT OR IGNORE INTO diagnostic_records
              (account_owner_hash, diagnostic_id, observed_at, payload)
             VALUES (?, ?, ?, ?);`,
            accountOwnerHash,
            record.diagnosticId,
            record.observedAt,
            JSON.stringify(record),
          );
        }
        const cutoff = new Date(now().getTime() - retentionMs).toISOString();
        await transaction.runAsync(
          'DELETE FROM diagnostic_records WHERE account_owner_hash = ? AND observed_at < ?;',
          accountOwnerHash,
          cutoff,
        );
        await transaction.runAsync(
          `DELETE FROM diagnostic_records
             WHERE rowid IN (
               SELECT rowid FROM diagnostic_records
                WHERE account_owner_hash = ?
                ORDER BY observed_at DESC, diagnostic_id DESC
                LIMIT -1 OFFSET ?
             );`,
          accountOwnerHash,
          maxRecords,
        );
      });
    },
    quarantine: async (accountOwnerHash, entries) => {
      assertAccountOwnerHash(accountOwnerHash);
      const sanitized = entries.map((entry): DriverDiagnosticQuarantineEntry => {
        const record = sanitizeDriverDiagnosticRecord(entry.record);
        if (
          record === null || !isDriverDiagnosticPermanentRejectionCode(entry.code)
          || !isTimestamp(entry.quarantinedAt)
        ) throw new Error('Cannot quarantine invalid diagnostic rejection.');
        return { code: entry.code, quarantinedAt: new Date(entry.quarantinedAt).toISOString(), record };
      });
      if (sanitized.length === 0) return;
      await inEncryptedTransaction(async (transaction) => {
        for (const entry of sanitized) {
          await transaction.runAsync(
            `INSERT OR IGNORE INTO diagnostic_quarantine
              (account_owner_hash, diagnostic_id, quarantined_at, rejection_code, payload)
             VALUES (?, ?, ?, ?, ?);`,
            accountOwnerHash,
            entry.record.diagnosticId,
            entry.quarantinedAt,
            entry.code,
            JSON.stringify(entry.record),
          );
          await transaction.runAsync(
            'DELETE FROM diagnostic_records WHERE account_owner_hash = ? AND diagnostic_id = ?;',
            accountOwnerHash,
            entry.record.diagnosticId,
          );
        }
        const cutoff = new Date(now().getTime() - retentionMs).toISOString();
        await transaction.runAsync(
          'DELETE FROM diagnostic_quarantine WHERE account_owner_hash = ? AND quarantined_at < ?;',
          accountOwnerHash,
          cutoff,
        );
        await transaction.runAsync(
          `DELETE FROM diagnostic_quarantine
             WHERE rowid IN (
               SELECT rowid FROM diagnostic_quarantine
                WHERE account_owner_hash = ?
                ORDER BY quarantined_at DESC, diagnostic_id DESC
                LIMIT -1 OFFSET ?
             );`,
          accountOwnerHash,
          maxRecords,
        );
      });
    },
    read: async (accountOwnerHash) => {
      assertAccountOwnerHash(accountOwnerHash);
      const rows = await database.getAllAsync<StoredDiagnosticRow>(
        `SELECT diagnostic_id AS diagnosticId, payload
           FROM diagnostic_records
          WHERE account_owner_hash = ?
          ORDER BY observed_at, diagnostic_id;`,
        accountOwnerHash,
      );
      const valid: DriverDiagnosticRecord[] = [];
      const malformedIds: string[] = [];
      for (const row of rows) {
        const parsedJson = parseJson(row.payload);
        const record = sanitizeDriverDiagnosticRecord(parsedJson);
        if (record === null || record.diagnosticId !== row.diagnosticId) {
          malformedIds.push(row.diagnosticId);
        } else {
          valid.push(record);
        }
      }
      await removeRows(accountOwnerHash, malformedIds);
      return valid;
    },
    remove: async (accountOwnerHash, diagnosticIds) => {
      assertAccountOwnerHash(accountOwnerHash);
      diagnosticIds.forEach(assertDiagnosticId);
      await removeRows(accountOwnerHash, diagnosticIds);
    },
  };
}

function assertAccountOwnerHash(value: string) {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error('Diagnostic storage requires a lowercase SHA-256 account owner hash.');
}

function assertDiagnosticId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error('Diagnostic acknowledgement contains an invalid identifier.');
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40
    && isoTimestampPattern.test(value) && Number.isFinite(Date.parse(value));
}

function bytesToHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
