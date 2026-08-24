import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_EVIDENCE_DATABASE_NAME,
  DRIVER_EVIDENCE_KEY_STORAGE_KEY,
  createEncryptedEvidenceStore,
  type EvidenceDatabase,
} from './expoEncryptedEvidenceStore';

function createDatabase(input?: { cipherVersion?: string | null; failOn?: string; userVersion?: number }) {
  const commands: string[] = [];
  const tables = new Map<string, Map<string, string>>();
  const database: EvidenceDatabase = {
    execAsync: async (sql) => {
      commands.push(sql);
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      const deletedTable = /DELETE FROM ([a-z_]+)/iu.exec(sql)?.[1];
      if (deletedTable !== undefined) tables.get(deletedTable)?.clear();
    },
    getAllAsync: async <T>(sql: string) => {
      const table = /FROM ([a-z_]+)/iu.exec(sql)?.[1] ?? '';
      return [...(tables.get(table)?.entries() ?? [])]
        .map(([recordKey, payload]) => ({ recordKey, payload })) as T[];
    },
    getFirstAsync: async <T>(sql: string) => {
      commands.push(sql);
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      if (sql.includes('cipher_version')) return {
        cipher_version: input !== undefined && 'cipherVersion' in input ? input.cipherVersion : '4.5.6',
      } as T;
      if (sql.includes('user_version')) return { user_version: input?.userVersion ?? 0 } as T;
      return null;
    },
    runAsync: async (sql, ...params) => {
      const table = /INTO ([a-z_]+)/iu.exec(sql)?.[1];
      if (table !== undefined && params.length >= 2) {
        const rows = tables.get(table) ?? new Map<string, string>();
        rows.set(String(params[0]), String(params[1]));
        tables.set(table, rows);
      }
    },
    withExclusiveTransactionAsync: async (operation) => operation(database),
  };
  return { commands, database, tables };
}

describe('encrypted driver evidence store', () => {
  it('sets PRAGMA key before reading cipher or schema metadata', async () => {
    const db = createDatabase();
    await createEncryptedEvidenceStore({
      databaseName: DRIVER_EVIDENCE_DATABASE_NAME,
      keyStore: {
        getItemAsync: async () => '11'.repeat(32),
        setItemAsync: async () => undefined,
      },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    });

    assert.match(db.commands[0] ?? '', /^PRAGMA key = "x'[0-9a-f]{64}'";$/u);
    assert.match(db.commands[1] ?? '', /cipher_version/u);
  });

  it('rejects a build without SQLCipher and refuses a newer schema downgrade', async () => {
    const withoutCipher = createDatabase({ cipherVersion: null });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '22'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => withoutCipher.database,
      randomBytes: async () => new Uint8Array(32),
    }), /SQLCipher is unavailable/u);

    const newer = createDatabase({ userVersion: 3 });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '33'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => newer.database,
      randomBytes: async () => new Uint8Array(32),
    }), /newer schema version 3/u);
  });

  it('does not replace a missing key when an existing database cannot be opened', async () => {
    const db = createDatabase({ failOn: 'sqlite_master' });
    let storedKey: string | null = null;
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: {
        getItemAsync: async () => null,
        setItemAsync: async (key, value) => {
          assert.equal(key, DRIVER_EVIDENCE_KEY_STORAGE_KEY);
          storedKey = value;
        },
      },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32).fill(7),
    }), /key is missing or invalid/u);
    assert.equal(storedKey, null);
  });

  it('leaves legacy AsyncStorage authoritative when migration commit fails', async () => {
    const db = createDatabase({ failOn: 'user_version = 2' });
    const removed: string[] = [];
    const legacyPayload = JSON.stringify({ items: [], version: 1 });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '44'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: {
        getItem: async () => legacyPayload,
        removeItem: async (key) => { removed.push(key); },
      },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    }), /injected database failure/u);
    assert.deepEqual(removed, []);
  });

  it('stores a keyed client-id manifest while diagnostic export excludes sensitive payloads', async () => {
    const db = createDatabase();
    const legacyPayload = JSON.stringify({
      items: [{
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: {
          clientEventId: 'secret-client-id',
          eventType: 'STOP_DELIVERED',
          occurredAt: '2026-08-24T00:00:00.000Z',
          payload: { note: 'private note', recipient: 'private recipient' },
          routePlanId: 'route-1',
        },
        kind: 'driver_event',
        queueItemId: 'driver-event:secret-client-id',
      }],
      version: 1,
    });
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '55'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => legacyPayload, removeItem: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async (value) => {
        const result = new Uint8Array(32);
        result.fill(value.reduce((sum, byte) => (sum + byte) % 256, 0));
        return result;
      },
    });

    const diagnostics = await store.exportDiagnostics();
    assert.match(diagnostics, /HMAC-SHA256/u);
    assert.doesNotMatch(diagnostics, /secret-client-id|private note|private recipient/u);
  });

  it('preserves a corrupt legacy blob only inside encrypted quarantine', async () => {
    const db = createDatabase();
    const corrupt = '{"note":"private migration evidence"';
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '66'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => corrupt, removeItem: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    assert.match(db.tables.get('migration_quarantine')?.values().next().value ?? '', /private migration evidence/u);
    assert.doesNotMatch(await store.exportDiagnostics(), /private migration evidence/u);
  });
});
