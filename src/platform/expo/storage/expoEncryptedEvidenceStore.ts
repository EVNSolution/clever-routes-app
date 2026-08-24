import {
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  normalizePersistedOfflineSubmissionQueue,
  type OfflineSubmissionQueueStorage,
} from '../../../domain/offline/offlineSubmissionQueue';

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
}): Promise<OfflineSubmissionQueueStorage & { exportDiagnostics(): Promise<string> }> {
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
  await purgeExpiredEvidence(database, now());

  return {
    exportDiagnostics: async () => {
      const rows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM diagnostic_records ORDER BY created_at, record_key;',
      );
      return JSON.stringify({ records: rows.map((row) => JSON.parse(row.payload) as unknown), schemaVersion: 2 });
    },
    getItem: async (storageKey) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return null;
      await purgeExpiredEvidence(database, now());
      const rows = (await Promise.all(RECORD_TABLES.map((table) => database.getAllAsync<StoredRow>(
        `SELECT record_key AS recordKey, payload FROM ${table} ORDER BY created_at, record_key;`,
      )))).flat();
      const sensitiveRows = await database.getAllAsync<StoredRow>(
        'SELECT record_key AS recordKey, payload FROM sensitive_evidence WHERE expires_at > ? ORDER BY created_at, record_key;',
        now().toISOString(),
      );
      const sensitiveByKey = new Map(sensitiveRows.map((row) => [row.recordKey, row.payload]));
      if (rows.length === 0) return null;
      const items = rows
        .filter((row) => !row.recordKey.startsWith('legacy-corrupt:'))
        .map((row) => {
          const envelope = JSON.parse(row.payload) as Record<string, unknown>;
          const normalizedEnvelope: Record<string, unknown> = {
            ...envelope,
            journal: normalizeJournalEntries(envelope.journal, now()),
          };
          const sensitive = sensitiveByKey.get(row.recordKey);
          if (sensitive !== undefined) return hydrateSensitiveReplay(normalizedEnvelope, JSON.parse(sensitive) as unknown);
          if (normalizedEnvelope.sensitiveReplay !== true) return normalizedEnvelope;
          const request = typeof normalizedEnvelope.request === 'object' && normalizedEnvelope.request !== null
            ? normalizedEnvelope.request as Record<string, unknown>
            : null;
          return {
            ...normalizedEnvelope,
            ...(request === null ? {} : { request: { ...request, fileName: 'expired', uri: 'expired://' } }),
            state: 'DISCARDED',
          };
        })
        .sort((left, right) => readQueueSequence(left) - readQueueSequence(right));
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
    setItem: async (storageKey, value) => {
      if (storageKey !== OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) return;
      const items = parseLegacyItems(value);
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
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (raw !== null) {
      const items = parsedItems;
      if (items === null) {
        const encodedRaw = new TextEncoder().encode(raw);
        const boundedRaw = new TextDecoder().decode(encodedRaw.slice(0, CORRUPT_LEGACY_QUARANTINE_MAX_BYTES - 4));
        await transaction.runAsync(
          'INSERT OR REPLACE INTO migration_quarantine (record_key, account_owner_hash, queue_sequence, payload) VALUES (?, ?, ?, ?);',
          `legacy-corrupt:${Date.now()}`,
          'legacy-unbound-owner',
          0,
          JSON.stringify({
            encryptedLegacyPayload: boundedRaw,
            originalByteLength: encodedRaw.byteLength,
            reason: 'corrupt_legacy_queue',
            truncated: encodedRaw.byteLength > CORRUPT_LEGACY_QUARANTINE_MAX_BYTES,
          }),
        );
        await transaction.runAsync(
          'INSERT OR REPLACE INTO diagnostic_records (record_key, payload) VALUES (?, ?);',
          'migration-corrupt-legacy',
          JSON.stringify({ code: 'CORRUPT_LEGACY_QUEUE', preserved: true }),
        );
        const quarantined = await transaction.getFirstAsync<StoredRow>(
          'SELECT record_key AS recordKey, payload FROM migration_quarantine WHERE record_key LIKE ? LIMIT 1;',
          'legacy-corrupt:%',
        );
        if (quarantined === null || quarantined.payload !== JSON.stringify({
          encryptedLegacyPayload: boundedRaw,
          originalByteLength: encodedRaw.byteLength,
          reason: 'corrupt_legacy_queue',
          truncated: encodedRaw.byteLength > CORRUPT_LEGACY_QUARANTINE_MAX_BYTES,
        })) {
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
        if (rereadManifest.clientIdHmac !== manifest.clientIdHmac || rereadManifest.itemCount !== manifest.itemCount) {
          throw new Error('Legacy evidence migration client-id manifest verification failed.');
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

async function purgeExpiredEvidence(database: EvidenceDatabase, now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const table of RECORD_TABLES) {
      const rows = await transaction.getAllAsync<StoredRow>(
        `SELECT record_key AS recordKey, payload FROM ${table};`,
      );
      for (const row of rows) {
        if (row.recordKey.startsWith('legacy-corrupt:')) continue;
        const item = JSON.parse(row.payload) as Record<string, unknown>;
        if (!isExpiredTerminalEvidence(item, now)) continue;
        await transaction.runAsync(`DELETE FROM ${table} WHERE record_key = ?;`, row.recordKey);
        await transaction.runAsync('DELETE FROM sensitive_evidence WHERE record_key = ?;', row.recordKey);
      }
    }
    await transaction.runAsync('DELETE FROM evidence_journal WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM sensitive_evidence WHERE expires_at <= ?;', now.toISOString());
  });
}

async function replaceQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[], now: Date) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const retainedItems = items.filter((item) => !isExpiredTerminalEvidence(item, now));
    const expiredItems = items.filter((item) => isExpiredTerminalEvidence(item, now));
    const retainedRecordKeys = new Set(retainedItems.map(getRecordKey));
    const existingSensitiveRows = await transaction.getAllAsync<StoredRow>(
      'SELECT record_key AS recordKey, payload FROM sensitive_evidence;',
    );
    await transaction.execAsync('DELETE FROM workflow_evidence;');
    await transaction.execAsync('DELETE FROM location_batches;');
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
    await writeQueueRows(transaction, retainedItems, now);
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await transaction.runAsync('DELETE FROM evidence_journal WHERE created_at < ?;', cutoff);
    await transaction.runAsync('DELETE FROM sensitive_evidence WHERE expires_at <= ?;', now.toISOString());
  });
}

async function writeQueueRows(database: EvidenceDatabase, items: Record<string, unknown>[], now: Date) {
  for (const item of items) {
    const queueItemId = typeof item.queueItemId === 'string' ? item.queueItemId : `invalid:${Date.now()}`;
    const ownerHash = typeof item.accountOwnerHash === 'string' ? item.accountOwnerHash : 'legacy-unbound-owner';
    const recordKey = `${ownerHash}:${queueItemId}`;
    const table = classifyItem(item);
    const journal = normalizeJournalEntries(item.journal, now);
    const normalizedItem = { ...item, journal };
    const envelope = redactReplayPayload(normalizedItem);
    const sequence = readQueueSequence(item);
    const createdAt = readIsoTimestamp(item.enqueuedAt) ?? now.toISOString();
    await database.runAsync(
      `INSERT OR REPLACE INTO ${table} (record_key, account_owner_hash, queue_sequence, payload, created_at) VALUES (?, ?, ?, ?, ?);`,
      recordKey,
      ownerHash,
      sequence,
      JSON.stringify(envelope),
      createdAt,
    );
    if (hasSensitiveReplayPayload(normalizedItem)) {
      await database.runAsync(
        'INSERT OR IGNORE INTO sensitive_evidence (record_key, account_owner_hash, queue_sequence, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?);',
        recordKey,
        ownerHash,
        sequence,
        JSON.stringify(extractSensitiveReplay(normalizedItem)),
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt,
      );
    }
    for (const [index, entry] of journal.entries()) {
      await database.runAsync(
        'INSERT OR IGNORE INTO evidence_journal (record_key, account_owner_hash, queue_sequence, payload, created_at) VALUES (?, ?, ?, ?, ?);',
        `${recordKey}:${index}:${typeof (entry as Record<string, unknown>).at === 'string' ? (entry as Record<string, unknown>).at : ''}`,
        ownerHash,
        sequence,
        JSON.stringify(entry),
        (entry as Record<string, unknown>).at,
      );
    }
  }
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
  if (item.state !== 'ACKNOWLEDGED' && item.state !== 'DISCARDED') return false;
  const journal = Array.isArray(item.journal) ? item.journal : [];
  const terminalAt = [...journal].reverse().find((entry) => (
    typeof entry === 'object'
    && entry !== null
    && ((entry as Record<string, unknown>).kind === 'ACK' || (entry as Record<string, unknown>).kind === 'DISCARD')
  ));
  const terminalTimestamp = terminalAt === undefined
    ? readIsoTimestamp(item.enqueuedAt)
    : readIsoTimestamp((terminalAt as Record<string, unknown>).at);
  return terminalTimestamp !== null
    && now.getTime() - Date.parse(terminalTimestamp) > 30 * 24 * 60 * 60 * 1000;
}

function normalizeJournalEntries(value: unknown, now: Date) {
  if (!Array.isArray(value)) return [];
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return value.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const timestamp = readIsoTimestamp((entry as Record<string, unknown>).at);
    return timestamp !== null && Date.parse(timestamp) >= cutoff;
  }).slice(-64) as Record<string, unknown>[];
}

function readIsoTimestamp(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
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
      clientEventId: event.clientEventId,
      ...(event.deliveryStopId === undefined ? {} : { deliveryStopId: event.deliveryStopId }),
      eventType: event.eventType,
      ...(event.latitude === undefined ? {} : { latitude: event.latitude }),
      ...(event.longitude === undefined ? {} : { longitude: event.longitude }),
      occurredAt: event.occurredAt,
      ...(event.routePlanId === undefined ? {} : { routePlanId: event.routePlanId }),
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
