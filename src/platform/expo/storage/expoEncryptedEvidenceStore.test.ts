import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_EVIDENCE_DATABASE_NAME,
  DRIVER_EVIDENCE_KEY_STORAGE_KEY,
  createEncryptedEvidenceStore,
  type EvidenceDatabase,
} from './expoEncryptedEvidenceStore';

function createDatabase(input?: { cipherVersion?: string | null; corruptReadPayload?: boolean; failOn?: string; userVersion?: number }) {
  const commands: string[] = [];
  const tables = new Map<string, Map<string, string>>();
  let userVersion = input?.userVersion ?? 0;
  const database: EvidenceDatabase = {
    execAsync: async (sql) => {
      commands.push(sql);
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      const version = /PRAGMA user_version = (\d+)/u.exec(sql)?.[1];
      if (version !== undefined) userVersion = Number(version);
      const deletedTable = /^DELETE FROM ([a-z_]+);$/iu.exec(sql.trim())?.[1];
      if (deletedTable !== undefined) tables.get(deletedTable)?.clear();
    },
    getAllAsync: async <T>(sql: string) => {
      const table = /FROM ([a-z_]+)/iu.exec(sql)?.[1] ?? '';
      return [...(tables.get(table)?.entries() ?? [])]
        .map(([recordKey, payload]) => {
          if (input?.corruptReadPayload !== true || table !== 'workflow_evidence') return { recordKey, payload };
          const parsed = JSON.parse(payload) as { event?: { clientEventId?: string } };
          if (parsed.event !== undefined) parsed.event.clientEventId = 'corrupted-after-write';
          return { recordKey, payload: JSON.stringify(parsed) };
        }) as T[];
    },
    getFirstAsync: async <T>(sql: string) => {
      commands.push(sql);
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      if (sql.includes('cipher_version')) return {
        cipher_version: input !== undefined && 'cipherVersion' in input ? input.cipherVersion : '4.5.6',
      } as T;
      if (sql.includes('user_version')) return { user_version: userVersion } as T;
      if (sql.includes('FROM diagnostic_records')) {
        const rows = tables.get('diagnostic_records');
        const recordKey = ['migration-hmac-v2', 'migration-corrupt-legacy'].find((key) => rows?.has(key));
        return recordKey === undefined ? null : { record_key: recordKey } as T;
      }
      return null;
    },
    runAsync: async (sql, ...params) => {
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      const table = /INTO ([a-z_]+)/iu.exec(sql)?.[1];
      if (table !== undefined && params.length >= 2) {
        const rows = tables.get(table) ?? new Map<string, string>();
        rows.set(String(params[0]), String(params.at(-1)));
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

  it('keeps workflow envelopes redacted while sensitive replay data remains separately encrypted', async () => {
    const db = createDatabase();
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '77'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    });
    const owner = 'aa'.repeat(32);
    const item = {
      accountOwnerHash: owner,
      attempts: 2,
      enqueuedAt: '2026-08-24T00:00:00.000Z',
      event: {
        address: 'private address',
        clientEventId: 'client-1',
        eventType: 'STOP_DELIVERED',
        occurredAt: '2026-08-24T00:00:00.000Z',
        payload: {
          media: ['file:///private.jpg'],
          note: 'private note',
          recipient: 'private recipient',
          signature: 'private signature',
        },
        routePlanId: 'route-1',
      },
      journal: [{ at: '2026-08-24T00:00:00.000Z', code: 'NETWORK_UNAVAILABLE', kind: 'ATTEMPT' }],
      kind: 'driver_event',
      lastError: 'raw stack and recipient',
      lastErrorCode: 'NETWORK_UNAVAILABLE',
      queueItemId: 'driver-event:client-1',
      queueSequence: 41,
      state: 'PENDING',
    };
    await store.setItem('@clever-routes/offline-submission-queue-v1', JSON.stringify({ items: [item], version: 2 }));

    const workflow = db.tables.get('workflow_evidence')?.values().next().value ?? '';
    const sensitive = db.tables.get('sensitive_evidence')?.values().next().value ?? '';
    assert.match(workflow, /NETWORK_UNAVAILABLE|client-1/u);
    assert.doesNotMatch(workflow, /private note|private recipient|private address|private signature|private\.jpg|raw stack/u);
    assert.match(sensitive, /private note|private recipient|private signature|private\.jpg/u);
    assert.doesNotMatch(sensitive, /queueSequence|lastError|accountOwnerHash/u);
    assert.equal(db.tables.get('evidence_journal')?.size, 1);

    const replay = await store.getItem('@clever-routes/offline-submission-queue-v1');
    assert.match(replay ?? '', /private note|private recipient|private signature|private\.jpg/u);
    assert.doesNotMatch(replay ?? '', /raw stack/u);
  });

  it('preserves quarantine and journal rows when replacing the active queue snapshot', async () => {
    const db = createDatabase();
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '88'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    });
    const item = {
      accountOwnerHash: 'bb'.repeat(32),
      attempts: 0,
      enqueuedAt: '2026-08-24T00:00:00.000Z',
      event: { clientEventId: 'blocked', eventType: 'STOP_FAILED', occurredAt: '2026-08-24T00:00:00.000Z', routePlanId: 'route-1' },
      journal: [{ at: '2026-08-24T00:00:00.000Z', code: 'ROUTE_NOT_IN_PROGRESS', kind: 'RECONCILIATION' }],
      kind: 'driver_event',
      queueItemId: 'driver-event:blocked',
      queueSequence: 1,
      reconciliation: { blockedAt: '2026-08-24T00:00:00.000Z', reason: 'route_not_in_progress' },
      state: 'QUARANTINED',
    };
    await store.setItem('@clever-routes/offline-submission-queue-v1', JSON.stringify({ items: [item], version: 2 }));
    await store.setItem('@clever-routes/offline-submission-queue-v1', JSON.stringify({ items: [], version: 2 }));

    assert.equal(db.tables.get('migration_quarantine')?.size, 1);
    assert.equal(db.tables.get('evidence_journal')?.size, 1);
  });

  it('bounds corrupt migration quarantine by encoded bytes', async () => {
    const db = createDatabase();
    const corrupt = `{"broken":"${'한'.repeat(30_000)}`;
    await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '99'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => corrupt, removeItem: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    const quarantined = db.tables.get('migration_quarantine')?.values().next().value ?? '{}';
    const parsed = JSON.parse(quarantined) as { encryptedLegacyPayload: string; originalByteLength: number; truncated: boolean };
    assert.equal(parsed.truncated, true);
    assert.ok(new TextEncoder().encode(parsed.encryptedLegacyPayload).byteLength <= 64 * 1024);
    assert.ok(parsed.originalByteLength > 64 * 1024);
  });

  it('retries legacy cleanup after a post-commit crash without remigrating rows', async () => {
    const db = createDatabase();
    const legacyPayload = JSON.stringify({ items: [], version: 1 });
    let removeAttempts = 0;
    const legacyStorage = {
      getItem: async () => legacyPayload,
      removeItem: async () => {
        removeAttempts += 1;
        if (removeAttempts === 1) throw new Error('crash after commit');
      },
    };
    const common = {
      keyStore: { getItemAsync: async () => 'ab'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    };
    await assert.rejects(createEncryptedEvidenceStore(common), /crash after commit/u);
    await createEncryptedEvidenceStore(common);
    assert.equal(removeAttempts, 2);
  });

  it('does not remove AsyncStorage evidence when encrypted row writes fail', async () => {
    const db = createDatabase({ failOn: 'INSERT OR REPLACE INTO workflow_evidence' });
    const removed: string[] = [];
    const legacyPayload = JSON.stringify({
      items: [{
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: { clientEventId: 'disk-full', eventType: 'STOP_DELIVERED', occurredAt: '2026-08-24T00:00:00.000Z' },
        kind: 'driver_event',
        queueItemId: 'driver-event:disk-full',
      }],
      version: 1,
    });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => 'cd'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => legacyPayload, removeItem: async (key) => { removed.push(key); } },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    }), /injected database failure/u);
    assert.deepEqual(removed, []);
  });

  it('rejects a migration whose reread client-id HMAC differs from the source manifest', async () => {
    const db = createDatabase({ corruptReadPayload: true });
    const removed: string[] = [];
    const legacyPayload = JSON.stringify({
      items: [{
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: { clientEventId: 'expected-id', eventType: 'STOP_DELIVERED', occurredAt: '2026-08-24T00:00:00.000Z' },
        kind: 'driver_event',
        queueItemId: 'driver-event:expected-id',
      }],
      version: 1,
    });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => 'ef'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => legacyPayload, removeItem: async (key) => { removed.push(key); } },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async (value) => {
        const result = new Uint8Array(32);
        result.fill(value.reduce((sum, byte) => (sum + byte) % 251, 0));
        return result;
      },
    }), /client-id manifest verification failed/u);
    assert.deepEqual(removed, []);
  });
});
