import { OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY, type OfflineSubmissionQueueStorage } from '../../../domain/offline/offlineSubmissionQueue';

export const DRIVER_EVIDENCE_DATABASE_NAME = 'clever_driver_evidence_v2.db';
export const DRIVER_EVIDENCE_KEY_STORAGE_KEY = 'clever.driverEvidence.sqlcipherKey.v2';
export const DRIVER_EVIDENCE_SCHEMA_VERSION = 2;

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

type StoredRow = { payload: string; recordKey: string };

const RECORD_TABLES = [
  'workflow_evidence',
  'sensitive_evidence',
  'migration_quarantine',
  'location_batches',
] as const;

export async function createEncryptedEvidenceStore(input: {
  databaseName?: string;
  keyStore: KeyStore;
  legacyStorage?: LegacyStorage;
  openDatabaseAsync: (databaseName: string) => Promise<EvidenceDatabase>;
  randomBytes: (length: number) => Promise<Uint8Array>;
  sha256?: (value: Uint8Array) => Promise<Uint8Array>;
}): Promise<OfflineSubmissionQueueStorage & { exportDiagnostics(): Promise<string> }> {
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
    await migrateLegacyQueue(database, input.legacyStorage, key, input.sha256);
  }

  return {
    exportDiagnostics: async () => {
      const rows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM diagnostic_records ORDER BY created_at, record_key;',
      );
      return JSON.stringify({ records: rows.map((row) => JSON.parse(row.payload) as unknown), schemaVersion: 2 });
    },
    getItem: async (storageKey) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return null;
      const rows = (await Promise.all(RECORD_TABLES.map((table) => database.getAllAsync<StoredRow>(
        `SELECT record_key AS recordKey, payload FROM ${table} ORDER BY created_at, record_key;`,
      )))).flat();
      if (rows.length === 0) return null;
      const items = rows
        .filter((row) => !row.recordKey.startsWith('legacy-corrupt:'))
        .map((row) => JSON.parse(row.payload) as unknown);
      return JSON.stringify({ items, version: 1 });
    },
    removeItem: async (storageKey) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const table of RECORD_TABLES) await transaction.execAsync(`DELETE FROM ${table};`);
      });
    },
    setItem: async (storageKey, value) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return;
      const items = parseLegacyItems(value);
      if (items === null) throw new Error('Offline evidence payload is invalid and was not written.');
      await replaceQueueRows(database, items);
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
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sensitive_evidence (
      record_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS migration_quarantine (
      record_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS location_batches (
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
) {
  const raw = await legacyStorage?.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? null;
  const parsedItems = raw === null ? null : parseLegacyItems(raw);
  const manifest = parsedItems === null || sha256 === undefined
    ? null
    : await createMigrationHmacManifest(parsedItems, hexToBytes(key), sha256);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (raw !== null) {
      const items = parsedItems;
      if (items === null) {
        await transaction.runAsync(
          'INSERT OR REPLACE INTO migration_quarantine (record_key, payload) VALUES (?, ?);',
          `legacy-corrupt:${Date.now()}`,
          JSON.stringify({ encryptedLegacyPayload: raw, reason: 'corrupt_legacy_queue' }),
        );
        await transaction.runAsync(
          'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
          'migration-corrupt-legacy',
          JSON.stringify({ code: 'CORRUPT_LEGACY_QUEUE', preserved: true }),
        );
      } else {
        await writeQueueRows(transaction, items);
        const persistedCount = (await Promise.all(RECORD_TABLES.map((table) => transaction.getAllAsync<StoredRow>(
          `SELECT record_key AS recordKey, payload FROM ${table};`,
        )))).flat().length;
        if (persistedCount !== items.length) throw new Error('Legacy evidence migration verification failed.');
        if (manifest === null) throw new Error('Legacy evidence migration HMAC manifest is unavailable.');
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

async function replaceQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[]) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const table of RECORD_TABLES) await transaction.execAsync(`DELETE FROM ${table};`);
    await writeQueueRows(transaction, items);
  });
}

async function writeQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[]) {
  for (const item of items) {
    const recordKey = typeof item.queueItemId === 'string' ? item.queueItemId : `invalid:${Date.now()}`;
    const table = classifyItem(item);
    await database.runAsync(
      `INSERT OR REPLACE INTO ${table} (record_key, payload) VALUES (?, ?);`,
      recordKey,
      JSON.stringify(item),
    );
  }
}

function classifyItem(item: Record<string, unknown>): (typeof RECORD_TABLES)[number] {
  if (item.reconciliation !== undefined) return 'migration_quarantine';
  if (item.kind === 'proof_media') return 'sensitive_evidence';
  const event = typeof item.event === 'object' && item.event !== null ? item.event as Record<string, unknown> : null;
  return event?.eventType === 'LOCATION_UPDATED' ? 'location_batches' : 'workflow_evidence';
}

function parseLegacyItems(raw: string): Record<string, unknown>[] | null {
  try {
    const parsed = JSON.parse(raw) as { items?: unknown; version?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return null;
    if (!parsed.items.every((item) => typeof item === 'object' && item !== null)) return null;
    return parsed.items as Record<string, unknown>[];
  } catch {
    return null;
  }
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
  const clientIds = items.map((item) => {
    const event = typeof item.event === 'object' && item.event !== null
      ? item.event as Record<string, unknown>
      : null;
    return typeof event?.clientEventId === 'string' ? event.clientEventId : String(item.queueItemId ?? '');
  }).sort();
  const blockSize = 64;
  const normalizedKey = key.length > blockSize ? await sha256(key) : key;
  const keyBlock = new Uint8Array(blockSize);
  keyBlock.set(normalizedKey.slice(0, blockSize));
  const innerPad = keyBlock.map((byte) => byte ^ 0x36);
  const outerPad = keyBlock.map((byte) => byte ^ 0x5c);
  const message = encoder.encode(JSON.stringify(clientIds));
  const innerHash = await sha256(concatBytes(innerPad, message));
  const hmac = await sha256(concatBytes(outerPad, innerHash));
  return {
    algorithm: 'HMAC-SHA256',
    clientIdHmac: bytesToHex(hmac),
    itemCount: items.length,
  };
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
