import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DriverDiagnosticRecord } from '../../../domain/diagnostics/driverDiagnosticContract';
import {
  DRIVER_DIAGNOSTIC_DATABASE_NAME,
  DRIVER_DIAGNOSTIC_DATABASE_KEY_STORAGE_KEY,
  createDiagnosticStorage,
  type DiagnosticDatabase,
} from './diagnosticStorage';

type Row = {
  accountOwnerHash: string;
  diagnosticId: string;
  observedAt: string;
  payload: string;
};

function sampleRecord(input: { diagnosticId: string; observedAt?: string; sequence?: number }): DriverDiagnosticRecord {
  const observedAt = input.observedAt ?? '2026-10-01T14:04:03.000Z';
  return {
    bootId: '11111111-1111-4111-8111-111111111111',
    context: {
      appVersion: '1.3.3',
      deviceInstanceHash: 'ab'.repeat(32),
      os: 'ANDROID',
      osVersion: '16',
      routePlanId: '22222222-2222-4222-8222-222222222222',
      sessionGeneration: '2',
      versionCode: 39,
    },
    diagnosticId: input.diagnosticId,
    kind: 'STATE_CHANGE',
    observedAt,
    sequence: input.sequence ?? 1,
    snapshot: {
      businessQueue: {
        nextRetryAt: null,
        observedAt: null,
        oldestAgeMs: null,
        oldestQueuedAt: null,
        queueDepth: 0,
        retryCount: 0,
      },
      lastGpsCallbackAt: null,
      lastGpsCollectedAt: null,
      lastGpsPersistedAt: null,
      lastGpsSendAcknowledgedAt: null,
      lastGpsSendAttemptAt: null,
      lifecycle: 'FOREGROUND',
      locationPermission: 'GRANTED_ALWAYS',
      locationService: 'ENABLED',
      locationTask: 'STARTED',
      locationTaskExpected: true,
      network: 'ONLINE',
      snapshotObservedAt: observedAt,
      stateObservedAt: {
        lifecycle: observedAt,
        locationPermission: observedAt,
        locationService: observedAt,
        locationTask: observedAt,
        network: observedAt,
      },
    },
  };
}

function createDatabase() {
  const commands: string[] = [];
  const rows: Row[] = [];
  const transactionCommands: string[] = [];
  const database: DiagnosticDatabase = {
    execAsync: async (sql) => {
      commands.push(sql);
      if (sql.startsWith('PRAGMA key = ')) return;
    },
    getAllAsync: async <T>(sql: string, ...params: unknown[]) => {
      if (!sql.includes('FROM diagnostic_records')) return [];
      const owner = String(params[0]);
      return rows
        .filter((row) => row.accountOwnerHash === owner)
        .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
        .map((row) => ({
          diagnosticId: row.diagnosticId,
          payload: row.payload,
        })) as T[];
    },
    getFirstAsync: async <T>(sql: string) => {
      commands.push(sql);
      if (sql.includes('cipher_version')) return { cipher_version: '4.5.6' } as T;
      if (sql.includes('user_version')) return { user_version: 1 } as T;
      return null;
    },
    runAsync: async (sql, ...params) => {
      if (sql.includes('INSERT OR IGNORE INTO diagnostic_records')) {
        const [accountOwnerHash, diagnosticId, observedAt, payload] = params.map(String);
        if (!rows.some((row) => row.accountOwnerHash === accountOwnerHash && row.diagnosticId === diagnosticId)) {
          rows.push({ accountOwnerHash, diagnosticId, observedAt, payload });
        }
      } else if (sql.includes('DELETE FROM diagnostic_records') && sql.includes('diagnostic_id = ?')) {
        const owner = String(params[0]);
        const id = String(params[1]);
        const index = rows.findIndex((row) => row.accountOwnerHash === owner && row.diagnosticId === id);
        if (index >= 0) rows.splice(index, 1);
      } else if (sql.includes('observed_at < ?')) {
        const owner = String(params[0]);
        const cutoff = String(params[1]);
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index]?.accountOwnerHash === owner && (rows[index]?.observedAt ?? '') < cutoff) rows.splice(index, 1);
        }
      } else if (sql.includes('OFFSET ?')) {
        const owner = String(params[0]);
        const keep = Number(params[1]);
        const owned = rows
          .filter((row) => row.accountOwnerHash === owner)
          .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
        const removals = new Set(owned.slice(keep).map((row) => row.diagnosticId));
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index]?.accountOwnerHash === owner && removals.has(rows[index]?.diagnosticId ?? '')) rows.splice(index, 1);
        }
      }
    },
    withExclusiveTransactionAsync: async (operation) => {
      const transaction: DiagnosticDatabase = {
        ...database,
        execAsync: async (sql) => {
          transactionCommands.push(sql);
        },
      };
      await operation(transaction);
    },
  };
  return { commands, database, rows, transactionCommands };
}

describe('Expo diagnostic storage', () => {
  it('uses a dedicated SQLCipher database and key before schema access', async () => {
    const db = createDatabase();
    const opened: string[] = [];
    const keyReads: string[] = [];
    const storage = await createDiagnosticStorage({
      keyStore: {
        getItemAsync: async (key) => {
          keyReads.push(key);
          return '11'.repeat(32);
        },
        setItemAsync: async () => undefined,
      },
      openDatabaseAsync: async (name) => {
        opened.push(name);
        return db.database;
      },
      randomBytes: async () => new Uint8Array(32),
    });

    assert.equal(typeof storage.read, 'function');
    assert.deepEqual(opened, [DRIVER_DIAGNOSTIC_DATABASE_NAME]);
    assert.deepEqual(keyReads, [DRIVER_DIAGNOSTIC_DATABASE_KEY_STORAGE_KEY]);
    assert.match(db.commands[0] ?? '', /^PRAGMA key = "x'[0-9a-f]{64}'";$/u);
    assert.equal(db.commands.some((command) => command.includes('clever_driver_evidence_v2')), false);
  });

  it('reapplies the SQLCipher key inside transactions', async () => {
    const db = createDatabase();
    const storage = await createDiagnosticStorage({
      keyStore: { getItemAsync: async () => '22'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    await storage.append('aa'.repeat(32), [sampleRecord({ diagnosticId: '33333333-3333-4333-8333-333333333333' })]);
    assert.match(db.transactionCommands[0] ?? '', /^PRAGMA key = "x'[0-9a-f]{64}'";$/u);
  });

  it('stores records idempotently and removes acknowledgements only from the matching account', async () => {
    const db = createDatabase();
    const storage = await createDiagnosticStorage({
      keyStore: { getItemAsync: async () => '33'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const firstOwner = 'aa'.repeat(32);
    const secondOwner = 'bb'.repeat(32);
    const record = sampleRecord({ diagnosticId: '44444444-4444-4444-8444-444444444444' });

    await storage.append(firstOwner, [record, record]);
    await storage.append(secondOwner, [record]);
    assert.equal(db.rows.length, 2);
    await storage.remove(firstOwner, [record.diagnosticId]);
    assert.deepEqual(await storage.read(firstOwner), []);
    assert.equal((await storage.read(secondOwner)).length, 1);
  });

  it('rejects malformed writes and drops malformed persisted rows on read', async () => {
    const db = createDatabase();
    const storage = await createDiagnosticStorage({
      keyStore: { getItemAsync: async () => '44'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const owner = 'aa'.repeat(32);

    await assert.rejects(storage.append(owner, [{ secret: 'pin-1234' } as never]), /invalid diagnostic record/iu);
    db.rows.push({ accountOwnerHash: owner, diagnosticId: '55555555-5555-4555-8555-555555555555', observedAt: '2026-10-01T14:04:03.000Z', payload: '{' });
    db.rows.push({ accountOwnerHash: owner, diagnosticId: '66666666-6666-4666-8666-666666666666', observedAt: '2026-10-01T14:04:04.000Z', payload: JSON.stringify({ secret: 'token' }) });
    assert.deepEqual(await storage.read(owner), []);
    assert.deepEqual(db.rows, []);
  });

  it('enforces account-scoped age and count retention after appending', async () => {
    const db = createDatabase();
    const storage = await createDiagnosticStorage({
      keyStore: { getItemAsync: async () => '55'.repeat(32), setItemAsync: async () => undefined },
      maxRecords: 2,
      now: () => new Date('2026-10-08T14:04:03.001Z'),
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      retentionMs: 7 * 24 * 60 * 60 * 1_000,
    });
    const owner = 'aa'.repeat(32);
    const other = 'bb'.repeat(32);
    await storage.append(other, [sampleRecord({ diagnosticId: '77777777-7777-4777-8777-777777777777', observedAt: '2026-10-08T14:04:00.000Z' })]);
    await storage.append(owner, [
      sampleRecord({ diagnosticId: '88888888-8888-4888-8888-888888888888', observedAt: '2026-10-01T14:04:03.000Z', sequence: 1 }),
      sampleRecord({ diagnosticId: '99999999-9999-4999-8999-999999999999', observedAt: '2026-10-08T14:04:01.000Z', sequence: 2 }),
      sampleRecord({ diagnosticId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', observedAt: '2026-10-08T14:04:02.000Z', sequence: 3 }),
      sampleRecord({ diagnosticId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', observedAt: '2026-10-08T14:04:03.000Z', sequence: 4 }),
    ]);

    assert.deepEqual((await storage.read(owner)).map((value) => (value as DriverDiagnosticRecord).diagnosticId), [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    assert.equal((await storage.read(other)).length, 1);
  });
});
