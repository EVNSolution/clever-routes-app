import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  OFFLINE_EVIDENCE_AUDIT_RETENTION_MS,
  isOfflineTerminalEvidenceExpired,
  normalizePersistedOfflineSubmissionQueue,
  retainOfflineEvidenceJournal,
  type OfflineEvidenceJournalEntry,
  type OfflineEvidenceState,
  type OfflineSubmissionQueueStorage,
} from '../../../domain/offline/offlineSubmissionQueue';
import type { DriverEventType } from '../../../domain/events/driverEvents';

export const DRIVER_EVIDENCE_DATABASE_NAME = 'clever_driver_evidence_v2.db';
export const DRIVER_EVIDENCE_KEY_STORAGE_KEY = 'clever.driverEvidence.sqlcipherKey.v2';
export const DRIVER_EVIDENCE_SCHEMA_VERSION = 2;
export const LEGACY_CORRUPT_QUARANTINE_RETENTION_MS = OFFLINE_EVIDENCE_AUDIT_RETENTION_MS;

export type SupportQuarantineExport = {
  exportedAt: string;
  exportToken: string;
  records: { payload: unknown; recordKey: string }[];
  scope: 'account' | 'global';
};

export type EncryptedEvidenceStore = OfflineSubmissionQueueStorage & {
  exportDiagnostics(): Promise<string>;
  exportSupportQuarantine(input?: { accountOwnerHash?: string }): Promise<SupportQuarantineExport>;
  purgeExportedSupportQuarantine(input: { accountOwnerHash?: string; exportToken: string }): Promise<number>;
};

export type EvidenceDatabase = {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  withExclusiveTransactionAsync(operation: (database: EvidenceDatabase) => Promise<void>): Promise<void>;
};

type KeyStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type LegacyStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

type StoredRow = { createdAt?: string; payload: string; recordKey: string };

const RECORD_TABLES = [
  'workflow_evidence',
  'migration_quarantine',
  'location_batches',
] as const;
const CORRUPT_LEGACY_QUARANTINE_MAX_BYTES = 64 * 1024;

export async function createEncryptedEvidenceStore(input: {
  databaseName?: string;
  keyStore: KeyStore;
  legacyStorage?: LegacyStorage;
  openDatabaseAsync: (databaseName: string) => Promise<EvidenceDatabase>;
  now?: () => Date;
  randomBytes: (length: number) => Promise<Uint8Array>;
  sha256?: (value: Uint8Array) => Promise<Uint8Array>;
}): Promise<EncryptedEvidenceStore> {
  const now = input.now ?? (() => new Date());
  const existingKey = await input.keyStore.getItemAsync(DRIVER_EVIDENCE_KEY_STORAGE_KEY);
  const generatedKey = existingKey === null;
  const key = existingKey ?? bytesToHex(await input.randomBytes(32));
  if (!/^[0-9a-f]{64}$/u.test(key)) {
    throw new Error('Encrypted evidence database key is missing or invalid. Preserve the database for support recovery.');
  }

  const database = await input.openDatabaseAsync(input.databaseName ?? DRIVER_EVIDENCE_DATABASE_NAME);
  await database.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await database.getFirstAsync<{ cipher_version?: string | null }>(
    'PRAGMA cipher_version;',
  );
  if (cipher?.cipher_version === null || cipher?.cipher_version === undefined || cipher.cipher_version.trim() === '') {
    throw new Error('SQLCipher is unavailable in this native build. Evidence storage remains read-only.');
  }

  try {
    await database.getFirstAsync('SELECT name FROM sqlite_master LIMIT 1;');
  } catch {
    throw new Error('Encrypted evidence database key is missing or invalid. Preserve the database for support recovery.');
  }
  if (generatedKey) {
    await input.keyStore.setItemAsync(DRIVER_EVIDENCE_KEY_STORAGE_KEY, key);
  }

  const versionRow = await database.getFirstAsync<{ user_version?: number }>('PRAGMA user_version;');
  const userVersion = versionRow?.user_version ?? 0;
  if (userVersion > DRIVER_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Encrypted evidence database uses newer schema version ${userVersion}; downgrade is blocked.`);
  }

  await createSchema(database);
  if (userVersion < DRIVER_EVIDENCE_SCHEMA_VERSION) {
    await migrateLegacyQueue(database, input.legacyStorage, key, input.sha256, now);
  } else {
    await cleanupCommittedLegacyQueue(database, input.legacyStorage);
  }
  await purgeExpiredEvidence(database, now(), hexToBytes(key), input.sha256);

  return {
    exportDiagnostics: async () => {
      const rows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM diagnostic_records ORDER BY created_at, record_key;',
      );
      return JSON.stringify({ records: rows.map((row) => JSON.parse(row.payload) as unknown), schemaVersion: 2 });
    },
    exportSupportQuarantine: async (exportInput = {}) => {
      const exportedAt = now().toISOString();
      const rows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM migration_quarantine ORDER BY created_at, record_key;',
      );
      const scopedRows = rows.filter((row) => matchesSupportScope(row, exportInput.accountOwnerHash));
      const exportToken = bytesToHex(await input.randomBytes(16));
      await database.runAsync(
        'INSERT OR REPLACE INTO support_export_markers (record_key, payload, created_at) VALUES (?, ?, ?);',
        exportToken,
        JSON.stringify({
          accountOwnerHash: exportInput.accountOwnerHash ?? null,
          exportedAt,
          recordKeys: scopedRows.map((row) => row.recordKey),
        }),
        exportedAt,
      );
      return {
        exportedAt,
        exportToken,
        records: scopedRows.map((row) => ({ payload: redactSupportQuarantinePayload(row), recordKey: row.recordKey })),
        scope: exportInput.accountOwnerHash === undefined ? 'global' : 'account',
      };
    },
    getItem: async (storageKey) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return null;
      const readAt = now();
      await purgeExpiredEvidence(database, readAt, hexToBytes(key), input.sha256);
      const rows = (await Promise.all(RECORD_TABLES.map(async (sourceTable) => (
        await database.getAllAsync<StoredRow>(
          `SELECT record_key AS recordKey, payload, created_at AS createdAt FROM ${sourceTable} ORDER BY created_at, record_key;`,
        )
      ).map((row) => ({ ...row, sourceTable }))))).flat();
      const sensitiveRows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM sensitive_evidence WHERE expires_at > ? ORDER BY created_at, record_key;',
        readAt.toISOString(),
      );
      const sensitiveByKey = new Map(sensitiveRows.map((row) => [row.recordKey, row.payload]));
      if (rows.length === 0) return null;
      const items: Record<string, unknown>[] = [];
      const invalidRows: typeof rows = [];
      for (const row of rows) {
        if (row.recordKey.startsWith('legacy-corrupt:')) continue;
        const envelope = parseJsonObject(row.payload);
        if (envelope === null) {
          invalidRows.push(row);
          continue;
        }
        const normalizedEnvelope: Record<string, unknown> = {
          ...envelope,
          journal: normalizeJournalEntries(envelope.journal, readAt),
        };
        const sensitive = sensitiveByKey.get(row.recordKey);
        const parsedSensitive = sensitive === undefined ? undefined : parseJsonObject(sensitive);
        if (sensitive !== undefined && parsedSensitive === null) {
          invalidRows.push(row);
          continue;
        }
        const hydrated = parsedSensitive === undefined
          ? expireMissingSensitiveReplay(normalizedEnvelope)
          : hydrateSensitiveReplay(normalizedEnvelope, parsedSensitive) as Record<string, unknown>;
        const normalizedItem = normalizeEvidenceRow(hydrated, row, readAt);
        if (normalizedItem === null) {
          invalidRows.push(row);
          continue;
        }
        items.push(normalizedItem);
      }
      if (invalidRows.length > 0) {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          for (const [index, row] of invalidRows.entries()) {
            await quarantineMalformedEvidenceRow(transaction, row.sourceTable, row, readAt, index + 1);
          }
        });
      }
      items.sort((left, right) => readQueueSequence(left) - readQueueSequence(right));
      return JSON.stringify({ items, version: 2 });
    },
    removeItem: async (storageKey) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync("UPDATE workflow_evidence SET payload = json_set(payload, '$.state', 'DISCARDED');");
        await transaction.execAsync("UPDATE sensitive_evidence SET expires_at = CURRENT_TIMESTAMP;");
        await transaction.execAsync("UPDATE location_batches SET payload = json_set(payload, '$.state', 'DISCARDED');");
      });
    },
    purgeExportedSupportQuarantine: async (purgeInput) => {
      let purged = 0;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        let purgedLegacyCorrupt = false;
        const marker = await transaction.getFirstAsync<StoredRow>(
          'SELECT record_key AS recordKey, payload FROM support_export_markers WHERE record_key = ? LIMIT 1;',
          purgeInput.exportToken,
        );
        if (marker === null) throw new Error('Support quarantine purge requires a durable export marker.');
        const parsedMarker = parseSupportExportMarker(marker.payload);
        const expectedOwner = purgeInput.accountOwnerHash ?? null;
        if (parsedMarker === null || parsedMarker.accountOwnerHash !== expectedOwner) {
          throw new Error('Support quarantine purge scope does not match the exported evidence.');
        }
        const currentRows = await transaction.getAllAsync<StoredRow>(
          'SELECT record_key AS recordKey, payload FROM migration_quarantine ORDER BY created_at, record_key;',
        );
        const currentByKey = new Map(currentRows.map((row) => [row.recordKey, row]));
        for (const recordKey of parsedMarker.recordKeys) {
          const row = currentByKey.get(recordKey);
          if (row === undefined || !matchesSupportScope(row, purgeInput.accountOwnerHash)) continue;
          await transaction.runAsync('DELETE FROM migration_quarantine WHERE record_key = ?;', recordKey);
          await transaction.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', recordKey);
          if (recordKey.startsWith('legacy-corrupt:')) purgedLegacyCorrupt = true;
          purged += 1;
        }
        const purgedAt = now().toISOString();
        await transaction.runAsync(
          'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
          `support-quarantine-purge:${purgeInput.exportToken}`,
          JSON.stringify({
            code: 'SUPPORT_QUARANTINE_EXPORTED_AND_PURGED',
            purgedAt,
            purgedBlobCount: purged,
            scope: expectedOwner === null ? 'global' : 'account',
          }),
        );
        if (purgedLegacyCorrupt) {
          await transaction.runAsync(
            'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
            'migration-corrupt-legacy',
            JSON.stringify({
              code: 'CORRUPT_LEGACY_QUEUE_BLOB_PURGED',
              purgeMode: 'support_export',
              purgedAt,
              purgedBlobCount: 1,
            }),
          );
        }
        await transaction.runAsync('DELETE FROM support_export_markers WHERE record_key = ?;', purgeInput.exportToken);
      });
      return purged;
    },
    setItem: async (storageKey, value) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return;
      const items = parseLegacyItems(value, now);
      if (items === null) throw new Error('Offline evidence payload is invalid and was not written.');
      await replaceQueueRows(database, items, now());
    },
  };
}

async function createSchema(database: EvidenceDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS diagnostic_records (
      record_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workflow_evidence (
      record_key TEXT PRIMARY KEY NOT NULL,
      account_owner_hash TEXT NOT NULL,
      queue_sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sensitive_evidence (
      record_key TEXT PRIMARY KEY NOT NULL,
      account_owner_hash TEXT NOT NULL,
      queue_sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS migration_quarantine (
      record_key TEXT PRIMARY KEY NOT NULL,
      account_owner_hash TEXT NOT NULL,
      queue_sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS location_batches (
      record_key TEXT PRIMARY KEY NOT NULL,
      account_owner_hash TEXT NOT NULL,
      queue_sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS evidence_journal (
      record_key TEXT PRIMARY KEY NOT NULL,
      account_owner_hash TEXT NOT NULL,
      queue_sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS support_export_markers (
      record_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function migrateLegacyQueue(
  database: EvidenceDatabase,
  legacyStorage: LegacyStorage | undefined,
  key: string,
  sha256: ((value: Uint8Array) => Promise<Uint8Array>) | undefined,
  now: () => Date,
) {
  const raw = await legacyStorage?.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? null;
  const parsedItems = raw === null ? null : parseLegacyItems(raw, now);
  const manifest = parsedItems === null || sha256 === undefined
    ? null
    : await createMigrationHmacManifest(parsedItems, hexToBytes(key), sha256);
  let corruptQuarantinedAt: Date | null = null;
  let corruptManifest: string | null = null;
  if (raw !== null && parsedItems === null) {
    corruptQuarantinedAt = now();
    corruptManifest = await createRedactedCorruptLegacyPayload({
      key: hexToBytes(key),
      quarantinedAt: corruptQuarantinedAt,
      raw,
      sha256,
    });
  }
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (raw !== null) {
      const items = parsedItems;
      if (items === null) {
        if (corruptManifest === null || corruptQuarantinedAt === null) {
          throw new Error('Corrupt legacy evidence manifest is unavailable.');
        }
        await transaction.runAsync(
          'INSERT OR REPLACE INTO migration_quarantine (record_key, account_owner_hash, queue_sequence, payload) VALUES (?, ?, ?, ?);',
          `legacy-corrupt:${corruptQuarantinedAt.getTime()}`,
          'legacy-unbound-owner',
          0,
          corruptManifest,
        );
        await transaction.runAsync(
          'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
          'migration-corrupt-legacy',
          JSON.stringify({ code: 'CORRUPT_LEGACY_QUEUE', redactedManifestPreserved: true }),
        );
        const quarantined = await transaction.getFirstAsync<StoredRow>(
          'SELECT record_key AS recordKey, payload FROM migration_quarantine WHERE record_key LIKE ? LIMIT 1;',
          'legacy-corrupt:%',
        );
        if (quarantined === null || quarantined.payload !== corruptManifest) {
          throw new Error('Corrupt legacy evidence quarantine verification failed.');
        }
      } else {
        await writeQueueRows(transaction, items, now());
        const persistedCount = (await Promise.all(RECORD_TABLES.map((table) => transaction.getAllAsync<StoredRow>(
          `SELECT record_key AS recordKey, payload FROM ${table};`,
        )))).flat().length;
        if (persistedCount !== items.length) throw new Error('Legacy evidence migration verification failed.');
        if (manifest === null) throw new Error('Legacy evidence migration HMAC manifest is unavailable.');
        const rereadItems = await readHydratedItems(transaction, now().toISOString());
        const hydratedEnvelope = JSON.stringify({ items: rereadItems, version: 2 });
        if (normalizePersistedOfflineSubmissionQueue(hydratedEnvelope, now) === null) {
          throw new Error('Legacy evidence migration public hydration verification failed.');
        }
        const rereadManifest = await createMigrationHmacManifest(rereadItems, hexToBytes(key), sha256!);
        if (
          rereadManifest.canonicalEvidenceHmac !== manifest.canonicalEvidenceHmac
          || rereadManifest.itemCount !== manifest.itemCount
        ) {
          throw new Error('Legacy evidence migration client-id manifest verification failed (canonical lineage mismatch).');
        }
        await transaction.runAsync(
          'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
          'migration-hmac-v2',
          JSON.stringify(manifest),
        );
      }
    }
    await transaction.execAsync(`PRAGMA user_version = ${DRIVER_EVIDENCE_SCHEMA_VERSION};`);
  });
  if (raw !== null) await legacyStorage?.removeItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY);
}

async function cleanupCommittedLegacyQueue(
  database: EvidenceDatabase,
  legacyStorage: LegacyStorage | undefined,
) {
  if (legacyStorage === undefined) return;
  const raw = await legacyStorage.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY);
  if (raw === null) return;
  const marker = await database.getFirstAsync<{ record_key?: string }>(
    "SELECT record_key FROM diagnostic_records WHERE record_key IN ('migration-hmac-v2', 'migration-corrupt-legacy') LIMIT 1;",
  );
  if (marker?.record_key !== undefined) {
    await legacyStorage.removeItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY);
  }
}

async function readHydratedItems(database: EvidenceDatabase, nowIso: string) {
  const rows = (await Promise.all(RECORD_TABLES.map((table) => database.getAllAsync<StoredRow>(
    `SELECT record_key AS recordKey, payload FROM ${table} ORDER BY created_at, record_key;`,
  )))).flat();
  const sensitiveRows = await database.getAllAsync<StoredRow>(
    'SELECT record_key AS recordKey, payload FROM sensitive_evidence WHERE expires_at > ? ORDER BY created_at, record_key;',
    nowIso,
  );
  const sensitiveByKey = new Map(sensitiveRows.map((row) => [row.recordKey, row.payload]));
  return rows
    .filter((row) => !row.recordKey.startsWith('legacy-corrupt:'))
    .map((row) => {
      const envelope = JSON.parse(row.payload) as Record<string, unknown>;
      const normalizedEnvelope: Record<string, unknown> = {
        ...envelope,
        journal: normalizeJournalEntries(envelope.journal, new Date(nowIso)),
      };
      const sensitive = sensitiveByKey.get(row.recordKey);
      return sensitive === undefined
        ? normalizedEnvelope
        : hydrateSensitiveReplay(normalizedEnvelope, JSON.parse(sensitive) as unknown) as Record<string, unknown>;
    })
    .sort((left, right) => readQueueSequence(left) - readQueueSequence(right));
}

async function purgeExpiredEvidence(
  database: EvidenceDatabase,
  now: Date,
  key: Uint8Array,
  sha256: ((value: Uint8Array) => Promise<Uint8Array>) | undefined,
) {
  const cutoff = new Date(now.getTime() - OFFLINE_EVIDENCE_AUDIT_RETENTION_MS).toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    let malformedRowIndex = 0;
    for (const table of RECORD_TABLES) {
      const rows = await transaction.getAllAsync<StoredRow>(
        `SELECT record_key AS recordKey, payload, created_at AS createdAt FROM ${table};`,
      );
      for (const row of rows) {
        if (row.recordKey.startsWith('legacy-corrupt:')) {
          const retention = readLegacyCorruptRetention(row, now);
          const normalizedPayload = retention.legacyRawPayload === null
            ? retention.normalizedPayload
            : await createRedactedCorruptLegacyPayload({
              digestScope: retention.truncated === true ? 'retained-fragment' : 'full-source',
              key,
              originalByteLength: retention.originalByteLength,
              quarantinedAt: retention.quarantinedAt,
              raw: retention.legacyRawPayload,
              retainedUntil: retention.retainedUntil,
              sha256,
              truncated: retention.truncated ?? false,
            });
          if (normalizedPayload !== null) {
            await transaction.runAsync(
              'INSERT OR REPLACE INTO migration_quarantine (record_key, account_owner_hash, queue_sequence, payload) VALUES (?, ?, ?, ?);',
              row.recordKey,
              'legacy-unbound-owner',
              0,
              normalizedPayload,
            );
          }
          if (now.getTime() < retention.retainedUntil.getTime()) continue;
          await writeCorruptEvidencePurgeDiagnostic(transaction, retention, now);
          await transaction.runAsync(`DELETE FROM ${table} WHERE record_key = ?;`, row.recordKey);
          continue;
        }
        const item = parseJsonObject(row.payload);
        if (item === null) {
          malformedRowIndex += 1;
          await quarantineMalformedEvidenceRow(transaction, table, row, now, malformedRowIndex);
          continue;
        }
        if (!isExpiredTerminalEvidence(item, now)) continue;
        await transaction.runAsync(`DELETE FROM ${table} WHERE record_key = ?;`, row.recordKey);
        await transaction.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', row.recordKey);
      }
    }
    await transaction.runAsync('DELETE FROM evidence_journal WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM support_export_markers WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM sensitive_evidence WHERE expires_at <= ?;', now.toISOString());
  });
}

async function replaceQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[], now: Date) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const retainedItems = items.filter((item) => !isExpiredTerminalEvidence(item, now));
    const expiredItems = items.filter((item) => isExpiredTerminalEvidence(item, now));
    const retainedRows = retainedItems.map((item) => serializeQueueRow(item, now));
    const retainedRecordKeys = new Set(retainedRows.map((row) => row.recordKey));
    const retainedRowsByRecordKey = new Map(retainedRows.map((row) => [row.recordKey, row]));
    const existingRecordRows = new Map<string, StoredRow>();
    for (const table of RECORD_TABLES) {
      const rows = await transaction.getAllAsync<StoredRow>(
        `SELECT record_key AS recordKey, payload FROM ${table};`,
      );
      for (const row of rows) existingRecordRows.set(`${table}:${row.recordKey}`, row);
    }
    const existingSensitiveRows = await transaction.getAllAsync<StoredRow>(
      'SELECT record_key AS recordKey, payload FROM sensitive_evidence;',
    );
    const existingSensitiveRecordKeys = new Set(existingSensitiveRows.map((row) => row.recordKey));
    const existingJournalRows = await transaction.getAllAsync<StoredRow>(
      'SELECT record_key AS recordKey, payload FROM evidence_journal;',
    );
    const existingJournalRecordKeys = new Set(existingJournalRows.map((row) => row.recordKey));
    for (const table of ['workflow_evidence', 'location_batches'] as const) {
      for (const [existingKey, existingRow] of existingRecordRows) {
        if (!existingKey.startsWith(`${table}:`)) continue;
        const retainedRow = retainedRowsByRecordKey.get(existingRow.recordKey);
        if (retainedRow?.table === table) continue;
        await transaction.runAsync(`DELETE FROM ${table} WHERE record_key = ?;`, existingRow.recordKey);
      }
    }
    for (const row of existingSensitiveRows) {
      if (!retainedRecordKeys.has(row.recordKey)) {
        await transaction.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', row.recordKey);
      }
    }
    for (const item of expiredItems) {
      const recordKey = getRecordKey(item);
      await transaction.runAsync('DELETE FROM migration_quarantine WHERE record_key = ?;', recordKey);
      await transaction.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', recordKey);
    }
    for (const row of retainedRows) {
      if (existingRecordRows.get(`${row.table}:${row.recordKey}`)?.payload !== row.payload) {
        await writeQueueRecord(transaction, row);
      }
      if (row.sensitivePayload !== null && !existingSensitiveRecordKeys.has(row.recordKey)) {
        await transaction.runAsync(
          'INSERT OR IGNORE INTO sensitive_evidence (record_key, account_owner_hash, queue_sequence, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?);',
          row.recordKey,
          row.ownerHash,
          row.sequence,
          row.sensitivePayload,
          new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          row.createdAt,
        );
      }
      for (const journalEntry of row.journalEntries) {
        if (existingJournalRecordKeys.has(journalEntry.recordKey)) continue;
        await transaction.runAsync(
          'INSERT OR IGNORE INTO evidence_journal (record_key, account_owner_hash, queue_sequence, payload, created_at) VALUES (?, ?, ?, ?, ?);',
          journalEntry.recordKey,
          row.ownerHash,
          row.sequence,
          journalEntry.payload,
          journalEntry.createdAt,
        );
        existingJournalRecordKeys.add(journalEntry.recordKey);
      }
    }
    const cutoff = new Date(now.getTime() - OFFLINE_EVIDENCE_AUDIT_RETENTION_MS).toISOString();
    await transaction.runAsync('DELETE FROM evidence_journal WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM support_export_markers WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM sensitive_evidence WHERE expires_at <= ?;', now.toISOString());
  });
}

async function writeQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[], now: Date) {
  for (const item of items) {
    const row = serializeQueueRow(item, now);
    await writeQueueRecord(database, row);
    if (row.sensitivePayload !== null) {
      await database.runAsync(
        'INSERT OR IGNORE INTO sensitive_evidence (record_key, account_owner_hash, queue_sequence, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?);',
        row.recordKey,
        row.ownerHash,
        row.sequence,
        row.sensitivePayload,
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        row.createdAt,
      );
    }
    for (const journalEntry of row.journalEntries) {
      await database.runAsync(
        'INSERT OR IGNORE INTO evidence_journal (record_key, account_owner_hash, queue_sequence, payload, created_at) VALUES (?, ?, ?, ?, ?);',
        journalEntry.recordKey,
        row.ownerHash,
        row.sequence,
        journalEntry.payload,
        journalEntry.createdAt,
      );
    }
  }
}

type SerializedQueueRow = {
  createdAt: string;
  journalEntries: { createdAt: string; payload: string; recordKey: string }[];
  ownerHash: string;
  payload: string;
  recordKey: string;
  sensitivePayload: string | null;
  sequence: number;
  table: (typeof RECORD_TABLES)[number];
};

function serializeQueueRow(item: Record<string, unknown>, now: Date): SerializedQueueRow {
  const queueItemId = typeof item.queueItemId === 'string' ? item.queueItemId : `invalid:${Date.now()}`;
  const ownerHash = typeof item.accountOwnerHash === 'string' ? item.accountOwnerHash : 'legacy-unbound-owner';
  const recordKey = `${ownerHash}:${queueItemId}`;
  const journal = normalizeJournalEntries(item.journal, now);
  const normalizedItem = { ...item, journal };
  return {
    createdAt: readIsoTimestamp(item.enqueuedAt) ?? now.toISOString(),
    journalEntries: journal.map((entry, index) => {
      const createdAt = typeof (entry as Record<string, unknown>).at === 'string'
        ? (entry as Record<string, unknown>).at as string
        : now.toISOString();
      return {
        createdAt,
        payload: JSON.stringify(entry),
        recordKey: `${recordKey}:${index}:${createdAt}`,
      };
    }),
    ownerHash,
    payload: JSON.stringify(redactReplayPayload(normalizedItem)),
    recordKey,
    sensitivePayload: hasSensitiveReplayPayload(normalizedItem)
      ? JSON.stringify(extractSensitiveReplay(normalizedItem))
      : null,
    sequence: readQueueSequence(item),
    table: classifyItem(item),
  };
}

async function writeQueueRecord(database: EvidenceDatabase, row: SerializedQueueRow) {
  await database.runAsync(
    `INSERT OR REPLACE INTO ${row.table} (record_key, account_owner_hash, queue_sequence, payload, created_at) VALUES (?, ?, ?, ?, ?);`,
    row.recordKey,
    row.ownerHash,
    row.sequence,
    row.payload,
    row.createdAt,
  );
}

function classifyItem(item: Record<string, unknown>): (typeof RECORD_TABLES)[number] {
  if (item.reconciliation !== undefined) return 'migration_quarantine';
  const event = typeof item.event === 'object' && item.event !== null ? item.event as Record<string, unknown> : null;
  return event?.eventType === 'LOCATION_UPDATED' ? 'location_batches' : 'workflow_evidence';
}

function getRecordKey(item: Record<string, unknown>) {
  const ownerHash = typeof item.accountOwnerHash === 'string' ? item.accountOwnerHash : 'legacy-unbound-owner';
  const queueItemId = typeof item.queueItemId === 'string' ? item.queueItemId : 'invalid';
  return `${ownerHash}:${queueItemId}`;
}

function isExpiredTerminalEvidence(item: Record<string, unknown>, now: Date) {
  if (
    typeof item.enqueuedAt !== 'string'
    || (item.state !== 'ACKNOWLEDGED' && item.state !== 'DISCARDED')
  ) return false;
  const event = typeof item.event === 'object' && item.event !== null
    ? item.event as Record<string, unknown>
    : undefined;
  return isOfflineTerminalEvidenceExpired({
    enqueuedAt: item.enqueuedAt,
    ...(typeof event?.eventType === 'string' ? { event: { eventType: event.eventType as DriverEventType } } : {}),
    journal: readJournalEntries(item.journal),
    ...(item.kind === 'driver_event' || item.kind === 'proof_media' ? { kind: item.kind } : {}),
    state: item.state as OfflineEvidenceState,
  }, now);
}

function normalizeJournalEntries(value: unknown, now: Date) {
  return retainOfflineEvidenceJournal(readJournalEntries(value), now);
}

function readJournalEntries(value: unknown): OfflineEvidenceJournalEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.at !== 'string'
      || typeof candidate.code !== 'string'
      || !['ACK', 'ATTEMPT', 'DISCARD', 'ENQUEUED', 'HEARTBEAT', 'RECONCILIATION'].includes(String(candidate.kind))
    ) return [];
    return [{
      at: candidate.at,
      code: candidate.code,
      kind: candidate.kind as OfflineEvidenceJournalEntry['kind'],
    }];
  });
}

function readIsoTimestamp(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function matchesSupportScope(row: StoredRow, accountOwnerHash: string | undefined) {
  if (accountOwnerHash === undefined) return true;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    const ownerHash = typeof payload.accountOwnerHash === 'string'
      ? payload.accountOwnerHash
      : row.recordKey.startsWith('legacy-corrupt:')
        ? 'legacy-unbound-owner'
        : null;
    return ownerHash === accountOwnerHash;
  } catch {
    return false;
  }
}

function redactSupportQuarantinePayload(row: StoredRow) {
  const payload = parseJsonObject(row.payload);
  if (payload === null) {
    return {
      code: 'CORRUPT_SUPPORT_QUARANTINE_RECORD',
      originalByteLength: new TextEncoder().encode(row.payload).byteLength,
      rawPayloadRetained: false,
    };
  }
  if (!row.recordKey.startsWith('legacy-corrupt:')) return redactReplayPayload(payload);
  const payloadHmac = typeof payload.payloadHmac === 'string' && /^[0-9a-f]{64}$/u.test(payload.payloadHmac)
    ? payload.payloadHmac
    : null;
  return {
    accountOwnerHash: 'legacy-unbound-owner',
    algorithm: payloadHmac === null ? null : 'HMAC-SHA256',
    code: 'CORRUPT_LEGACY_QUEUE',
    digestDomain: 'clever-driver-corrupt-legacy-v1',
    digestScope: payload.digestScope === 'retained-fragment' ? 'retained-fragment' : 'full-source',
    originalByteLength: typeof payload.originalByteLength === 'number'
      && Number.isSafeInteger(payload.originalByteLength)
      && payload.originalByteLength >= 0
      ? payload.originalByteLength
      : null,
    payloadHmac,
    quarantinedAt: readIsoTimestamp(payload.quarantinedAt),
    rawPayloadRetained: false,
    reason: 'corrupt_legacy_queue',
    retainedUntil: readIsoTimestamp(payload.retainedUntil),
    truncated: typeof payload.truncated === 'boolean' ? payload.truncated : null,
  };
}

function parseSupportExportMarker(value: string): { accountOwnerHash: string | null; recordKeys: string[] } | null {
  try {
    const marker = JSON.parse(value) as Record<string, unknown>;
    if (
      marker.accountOwnerHash !== null
      && typeof marker.accountOwnerHash !== 'string'
    ) return null;
    if (readIsoTimestamp(marker.exportedAt) === null) return null;
    if (!Array.isArray(marker.recordKeys) || !marker.recordKeys.every((recordKey) => typeof recordKey === 'string')) {
      return null;
    }
    return {
      accountOwnerHash: marker.accountOwnerHash,
      recordKeys: marker.recordKeys,
    };
  } catch {
    return null;
  }
}

function readLegacyCorruptRetention(row: StoredRow, now: Date): {
  legacyRawPayload: string | null;
  originalByteLength: number | null;
  quarantinedAt: Date;
  retainedUntil: Date;
  truncated: boolean | null;
  normalizedPayload: string | null;
} {
  const parsedPayload = parseJsonObject(row.payload);
  const payload = parsedPayload ?? {};
  const keyTimestampText = /^legacy-corrupt:(\d+)/u.exec(row.recordKey)?.[1];
  const keyTimestamp = keyTimestampText === undefined ? Number.NaN : Number(keyTimestampText);
  const keyDate = Number.isFinite(keyTimestamp) && keyTimestamp >= 0 ? new Date(keyTimestamp) : null;
  const validKeyDate = keyDate !== null && !Number.isNaN(keyDate.getTime()) ? keyDate : null;
  const explicitQuarantinedAt = readIsoTimestamp(payload.quarantinedAt);
  const createdAt = readIsoTimestamp(row.createdAt);
  const quarantinedAt = explicitQuarantinedAt === null
    ? validKeyDate !== null
      ? validKeyDate
      : createdAt === null ? now : new Date(createdAt)
    : new Date(explicitQuarantinedAt);
  const explicitRetainedUntil = readIsoTimestamp(payload.retainedUntil);
  const maximumRetainedUntil = new Date(quarantinedAt.getTime() + LEGACY_CORRUPT_QUARANTINE_RETENTION_MS);
  const candidateRetainedUntil = explicitRetainedUntil === null ? maximumRetainedUntil : new Date(explicitRetainedUntil);
  const retainedUntil = candidateRetainedUntil.getTime() < quarantinedAt.getTime()
    || candidateRetainedUntil.getTime() > maximumRetainedUntil.getTime()
    ? maximumRetainedUntil
    : candidateRetainedUntil;
  const originalByteLength = typeof payload.originalByteLength === 'number'
    && Number.isSafeInteger(payload.originalByteLength)
    && payload.originalByteLength >= 0
    ? payload.originalByteLength
    : new TextEncoder().encode(row.payload).byteLength;
  const truncated = typeof payload.truncated === 'boolean' ? payload.truncated : null;
  const legacyRawPayload = typeof payload.encryptedLegacyPayload === 'string'
    ? payload.encryptedLegacyPayload
    : null;
  const metadataIsValid = parsedPayload !== null
    && (explicitQuarantinedAt !== null || validKeyDate !== null)
    && legacyRawPayload === null;
  return {
    legacyRawPayload,
    normalizedPayload: metadataIsValid ? null : createCorruptEvidenceSummary({
      originalByteLength,
      quarantinedAt,
      retainedUntil,
      sourceTable: 'migration_quarantine',
      truncated,
    }),
    originalByteLength,
    quarantinedAt,
    retainedUntil,
    truncated,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function createCorruptEvidenceSummary(input: {
  originalByteLength: number | null;
  quarantinedAt: Date;
  retainedUntil: Date;
  sourceTable: (typeof RECORD_TABLES)[number];
  truncated: boolean | null;
}) {
  return JSON.stringify({
    accountOwnerHash: 'legacy-unbound-owner',
    code: 'CORRUPT_ENCRYPTED_EVIDENCE_ROW',
    originalByteLength: input.originalByteLength,
    quarantinedAt: input.quarantinedAt.toISOString(),
    reason: 'malformed_encrypted_evidence_row',
    retainedUntil: input.retainedUntil.toISOString(),
    sourceTable: input.sourceTable,
    truncated: input.truncated,
  });
}

async function quarantineMalformedEvidenceRow(
  database: EvidenceDatabase,
  table: (typeof RECORD_TABLES)[number],
  row: StoredRow,
  now: Date,
  index: number,
) {
  const createdAt = readIsoTimestamp(row.createdAt);
  const quarantinedAt = createdAt === null ? now : new Date(createdAt);
  const retention = {
    normalizedPayload: null,
    originalByteLength: new TextEncoder().encode(row.payload).byteLength,
    quarantinedAt,
    retainedUntil: new Date(quarantinedAt.getTime() + LEGACY_CORRUPT_QUARANTINE_RETENTION_MS),
    truncated: null,
  };
  if (now.getTime() >= retention.retainedUntil.getTime()) {
    await writeCorruptEvidencePurgeDiagnostic(database, retention, now);
  } else {
    await database.runAsync(
      'INSERT OR REPLACE INTO migration_quarantine (record_key, account_owner_hash, queue_sequence, payload) VALUES (?, ?, ?, ?);',
      `legacy-corrupt:${quarantinedAt.getTime()}:${table}:${stableNonSensitiveKey(row.recordKey)}:${index}`,
      'legacy-unbound-owner',
      0,
      createCorruptEvidenceSummary({
        originalByteLength: retention.originalByteLength,
        quarantinedAt,
        retainedUntil: retention.retainedUntil,
        sourceTable: table,
        truncated: null,
      }),
    );
  }
  await database.runAsync(`DELETE FROM ${table} WHERE record_key = ?;`, row.recordKey);
  await database.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', row.recordKey);
}

function stableNonSensitiveKey(value: string) {
  let hash = 2_166_136_261;
  for (const codePoint of value) {
    hash ^= codePoint.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function writeCorruptEvidencePurgeDiagnostic(
  database: EvidenceDatabase,
  retention: {
    originalByteLength: number | null;
    quarantinedAt: Date;
    retainedUntil: Date;
    truncated: boolean | null;
  },
  now: Date,
) {
  await database.runAsync(
    'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
    'migration-corrupt-legacy',
    JSON.stringify({
      code: 'CORRUPT_LEGACY_QUEUE_BLOB_PURGED',
      originalByteLength: retention.originalByteLength,
      purgedAt: now.toISOString(),
      purgedBlobCount: 1,
      quarantinedAt: retention.quarantinedAt.toISOString(),
      retainedUntil: retention.retainedUntil.toISOString(),
      truncated: retention.truncated,
    }),
  );
}

async function createRedactedCorruptLegacyPayload(input: {
  digestScope?: 'full-source' | 'retained-fragment';
  key: Uint8Array;
  originalByteLength?: number | null;
  quarantinedAt: Date;
  raw: string;
  retainedUntil?: Date;
  sha256: ((value: Uint8Array) => Promise<Uint8Array>) | undefined;
  truncated?: boolean;
}) {
  const encoder = new TextEncoder();
  const encodedRaw = encoder.encode(input.raw);
  const digestDomain = 'clever-driver-corrupt-legacy-v1';
  const payloadHmac = input.sha256 === undefined
    ? null
    : bytesToHex(await hmacSha256(
      concatBytes(encoder.encode(`${digestDomain}\0`), encodedRaw),
      input.key,
      input.sha256,
    ));
  return JSON.stringify({
    accountOwnerHash: 'legacy-unbound-owner',
    algorithm: payloadHmac === null ? null : 'HMAC-SHA256',
    code: 'CORRUPT_LEGACY_QUEUE',
    digestDomain,
    digestScope: input.digestScope ?? 'full-source',
    originalByteLength: input.originalByteLength ?? encodedRaw.byteLength,
    payloadHmac,
    quarantinedAt: input.quarantinedAt.toISOString(),
    rawPayloadRetained: false,
    reason: 'corrupt_legacy_queue',
    retainedUntil: (input.retainedUntil ?? new Date(
      input.quarantinedAt.getTime() + LEGACY_CORRUPT_QUARANTINE_RETENTION_MS,
    )).toISOString(),
    truncated: input.truncated ?? encodedRaw.byteLength > CORRUPT_LEGACY_QUARANTINE_MAX_BYTES,
  });
}

function redactReplayPayload(item: Record<string, unknown>) {
  const identity = pickEvidenceIdentity(item);
  if (item.kind === 'proof_media') {
    const request = typeof item.request === 'object' && item.request !== null ? item.request as Record<string, unknown> : {};
    return {
      ...identity,
      request: {
        deliveryStopId: request.deliveryStopId,
        routePlanId: request.routePlanId,
        source: request.source,
      },
      sensitiveReplay: true,
    };
  }
  const event = typeof item.event === 'object' && item.event !== null ? item.event as Record<string, unknown> : null;
  if (event === null) return identity;
  return {
    ...identity,
    event: {
      ...(event.accuracyMeters === undefined ? {} : { accuracyMeters: event.accuracyMeters }),
      ...(event.appVersion === undefined ? {} : { appVersion: event.appVersion }),
      ...(event.assignmentGeneration === undefined ? {} : { assignmentGeneration: event.assignmentGeneration }),
      clientEventId: event.clientEventId,
      ...(event.deliveryStopId === undefined ? {} : { deliveryStopId: event.deliveryStopId }),
      ...(event.driverContractVersion === undefined ? {} : { driverContractVersion: event.driverContractVersion }),
      eventType: event.eventType,
      ...(event.expectedRouteVersionId === undefined ? {} : { expectedRouteVersionId: event.expectedRouteVersionId }),
      ...(event.latitude === undefined ? {} : { latitude: event.latitude }),
      ...(event.longitude === undefined ? {} : { longitude: event.longitude }),
      occurredAt: event.occurredAt,
      ...(event.routePlanId === undefined ? {} : { routePlanId: event.routePlanId }),
      ...(event.versionCode === undefined ? {} : { versionCode: event.versionCode }),
    },
    ...(event.payload === undefined ? {} : { sensitiveReplay: true }),
  };
}

function pickEvidenceIdentity(item: Record<string, unknown>) {
  return {
    accountOwnerHash: item.accountOwnerHash,
    attempts: item.attempts,
    enqueuedAt: item.enqueuedAt,
    ...(item.firstErrorCode === undefined ? {} : { firstErrorCode: item.firstErrorCode }),
    journal: item.journal,
    kind: item.kind,
    ...(item.lastErrorCode === undefined ? {} : { lastErrorCode: item.lastErrorCode }),
    queueItemId: item.queueItemId,
    queueSequence: item.queueSequence,
    ...(item.reconciliation === undefined ? {} : { reconciliation: item.reconciliation }),
    state: item.state,
  };
}

function hasSensitiveReplayPayload(item: Record<string, unknown>) {
  if (item.kind === 'proof_media') return true;
  const event = typeof item.event === 'object' && item.event !== null ? item.event as Record<string, unknown> : null;
  return event?.payload !== undefined;
}

function extractSensitiveReplay(item: Record<string, unknown>) {
  if (item.kind === 'proof_media') {
    const request = typeof item.request === 'object' && item.request !== null ? item.request as Record<string, unknown> : {};
    return { fileName: request.fileName, kind: 'proof_media', uri: request.uri };
  }
  const event = typeof item.event === 'object' && item.event !== null ? item.event as Record<string, unknown> : {};
  return { kind: 'driver_event', payload: event.payload };
}

function hydrateSensitiveReplay(envelope: Record<string, unknown>, sensitiveValue: unknown) {
  if (typeof sensitiveValue !== 'object' || sensitiveValue === null) return envelope;
  const sensitive = sensitiveValue as Record<string, unknown>;
  if (sensitive.kind === 'proof_media') {
    const request = typeof envelope.request === 'object' && envelope.request !== null
      ? envelope.request as Record<string, unknown>
      : {};
    return { ...envelope, request: { ...request, fileName: sensitive.fileName, uri: sensitive.uri } };
  }
  if (sensitive.kind === 'driver_event') {
    const event = typeof envelope.event === 'object' && envelope.event !== null
      ? envelope.event as Record<string, unknown>
      : {};
    return { ...envelope, event: { ...event, payload: sensitive.payload } };
  }
  return envelope;
}

function expireMissingSensitiveReplay(envelope: Record<string, unknown>) {
  if (envelope.sensitiveReplay !== true) return envelope;
  const request = typeof envelope.request === 'object' && envelope.request !== null
    ? envelope.request as Record<string, unknown>
    : null;
  return {
    ...envelope,
    ...(request === null ? {} : { request: { ...request, fileName: 'expired', uri: 'expired://' } }),
    state: 'DISCARDED',
  };
}

function normalizeEvidenceRow(
  hydrated: Record<string, unknown>,
  row: StoredRow & { sourceTable: (typeof RECORD_TABLES)[number] },
  now: Date,
) {
  const normalized = normalizePersistedOfflineSubmissionQueue(
    JSON.stringify({ items: [hydrated], version: 2 }),
    () => now,
  );
  if (normalized === null) return null;
  const item = (JSON.parse(normalized) as { items: Record<string, unknown>[] }).items[0];
  if (item === undefined || getRecordKey(item) !== row.recordKey || classifyItem(item) !== row.sourceTable) {
    return null;
  }
  return item;
}

function readQueueSequence(item: unknown) {
  if (typeof item !== 'object' || item === null) return Number.MAX_SAFE_INTEGER;
  const sequence = (item as Record<string, unknown>).queueSequence;
  return typeof sequence === 'number' && Number.isInteger(sequence) ? sequence : Number.MAX_SAFE_INTEGER;
}

function parseLegacyItems(raw: string, now: () => Date = () => new Date()): Record<string, unknown>[] | null {
  const normalized = normalizePersistedOfflineSubmissionQueue(raw, now);
  if (normalized === null) return null;
  return (JSON.parse(normalized) as { items: Record<string, unknown>[] }).items;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  return Uint8Array.from(value.match(/.{2}/gu)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

async function createMigrationHmacManifest(
  items: Record<string, unknown>[],
  key: Uint8Array,
  sha256: (value: Uint8Array) => Promise<Uint8Array>,
) {
  const encoder = new TextEncoder();
  const canonicalEvidence = items.map((item) => {
    const event = typeof item.event === 'object' && item.event !== null
      ? item.event as Record<string, unknown>
      : null;
    return {
      event: event === null ? null : {
        appVersion: event.appVersion ?? null,
        assignmentGeneration: event.assignmentGeneration ?? null,
        clientEventId: event.clientEventId ?? null,
        driverContractVersion: event.driverContractVersion ?? null,
        eventType: event.eventType ?? null,
        expectedRouteVersionId: event.expectedRouteVersionId ?? null,
        routePlanId: event.routePlanId ?? null,
        versionCode: event.versionCode ?? null,
      },
      kind: item.kind ?? null,
      queueItemId: item.queueItemId ?? null,
      queueSequence: item.queueSequence ?? null,
    };
  }).sort((left, right) => {
    const sequenceDifference = readQueueSequence(left) - readQueueSequence(right);
    if (sequenceDifference !== 0) return sequenceDifference;
    return String(left.queueItemId).localeCompare(String(right.queueItemId));
  });
  const message = encoder.encode(JSON.stringify(canonicalEvidence));
  const hmac = await hmacSha256(message, key, sha256);
  return {
    algorithm: 'HMAC-SHA256',
    canonicalEvidenceHmac: bytesToHex(hmac),
    itemCount: items.length,
  };
}

async function hmacSha256(
  message: Uint8Array,
  key: Uint8Array,
  sha256: (value: Uint8Array) => Promise<Uint8Array>,
) {
  const blockSize = 64;
  const normalizedKey = key.length > blockSize ? await sha256(key) : key;
  const keyBlock = new Uint8Array(blockSize);
  keyBlock.set(normalizedKey.slice(0, blockSize));
  const innerPad = keyBlock.map((byte) => byte ^ 0x36);
  const outerPad = keyBlock.map((byte) => byte ^ 0x5c);
  const innerHash = await sha256(concatBytes(innerPad, message));
  return sha256(concatBytes(outerPad, innerHash));
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
