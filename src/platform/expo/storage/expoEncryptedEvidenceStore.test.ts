import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_EVIDENCE_DATABASE_NAME,
  DRIVER_EVIDENCE_KEY_STORAGE_KEY,
  createEncryptedEvidenceStore,
  type EvidenceDatabase,
} from './expoEncryptedEvidenceStore';
import {
  createPersistentOfflineSubmissionQueue,
  createRouteOrderedDriverEventService,
  OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY,
  retryOfflineSubmissions,
} from '../../../domain/offline/offlineSubmissionQueue';
import { createDriverApiClientsFromRouteAccess } from '../../../api/deliveryServer/driverApiClients';
import { finishDeliveryAfterActive } from '../../../domain/delivery/deliveryFinish';
import { sampleInvitedRouteAccess } from '../../../domain/routeAccess/routeAccess';

function createDatabase(input?: {
  cipherVersion?: string | null;
  corruptReadLineage?: boolean;
  corruptReadPayload?: boolean;
  failOn?: string;
  userVersion?: number;
}) {
  const commands: string[] = [];
  const createdAtByRecordKey = new Map<string, string>();
  const runCalls: { params: unknown[]; sql: string }[] = [];
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
          if ((input?.corruptReadPayload !== true && input?.corruptReadLineage !== true) || table !== 'workflow_evidence') {
            return { createdAt: createdAtByRecordKey.get(recordKey), recordKey, payload };
          }
          const parsed = JSON.parse(payload) as { event?: { clientEventId?: string } };
          if (parsed.event !== undefined) {
            if (input?.corruptReadPayload === true) parsed.event.clientEventId = 'corrupted-after-write';
            if (input?.corruptReadLineage === true) {
              (parsed.event as Record<string, unknown>).assignmentGeneration = '999';
            }
          }
          return { createdAt: createdAtByRecordKey.get(recordKey), recordKey, payload: JSON.stringify(parsed) };
        }) as T[];
    },
    getFirstAsync: async <T>(sql: string, ...params: unknown[]) => {
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
      if (sql.includes('FROM migration_quarantine')) {
        const entry = tables.get('migration_quarantine')?.entries().next().value as [string, string] | undefined;
        return entry === undefined ? null : { payload: entry[1], recordKey: entry[0] } as T;
      }
      if (sql.includes('FROM support_export_markers')) {
        const recordKey = String(params[0] ?? '');
        const payload = tables.get('support_export_markers')?.get(recordKey);
        return payload === undefined ? null : { payload, recordKey } as T;
      }
      return null;
    },
    runAsync: async (sql, ...params) => {
      runCalls.push({ params, sql });
      if (input?.failOn !== undefined && sql.includes(input.failOn)) {
        throw new Error('injected database failure');
      }
      const deletedTable = /DELETE FROM ([a-z_]+) WHERE record_key = \?/iu.exec(sql)?.[1];
      if (deletedTable !== undefined) {
        tables.get(deletedTable)?.delete(String(params[0]));
        return;
      }
      const table = /INTO ([a-z_]+)/iu.exec(sql)?.[1];
      if (table !== undefined && params.length >= 2) {
        const rows = tables.get(table) ?? new Map<string, string>();
        const columns = /\(([^)]+)\)\s+VALUES/iu.exec(sql)?.[1]?.split(',').map((column) => column.trim()) ?? [];
        const payloadIndex = columns.indexOf('payload');
        if (!sql.includes('INSERT OR IGNORE') || !rows.has(String(params[0]))) {
          rows.set(String(params[0]), String(params[payloadIndex]));
        }
        tables.set(table, rows);
      }
    },
    withExclusiveTransactionAsync: async (operation) => operation(database),
  };
  return { commands, createdAtByRecordKey, database, runCalls, tables };
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

  it('stores and exports only a keyed redacted manifest for corrupt legacy evidence', async () => {
    const db = createDatabase();
    const corrupt = '{"note":"private migration evidence","recipient":"secret recipient","uri":"file://proof.jpg"';
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '66'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => corrupt, removeItem: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async (value) => {
        const result = new Uint8Array(32);
        result.fill(value.reduce((sum, byte) => (sum + byte) % 256, 0));
        return result;
      },
    });

    const stored = db.tables.get('migration_quarantine')?.values().next().value ?? '';
    const exported = JSON.stringify(await store.exportSupportQuarantine());
    assert.match(stored, /"algorithm":"HMAC-SHA256"/u);
    assert.match(stored, /"payloadHmac":"[0-9a-f]{64}"/u);
    assert.match(stored, /"originalByteLength":/u);
    assert.match(stored, /"rawPayloadRetained":false/u);
    assert.doesNotMatch(`${stored}${exported}`, /private migration evidence|secret recipient|file:\/\/proof\.jpg/u);
    assert.doesNotMatch(await store.exportDiagnostics(), /private migration evidence/u);
  });

  it('keeps recent corrupt migration evidence but expires the encrypted blob after the support window', async () => {
    const db = createDatabase({ userVersion: 2 });
    const clock = new Date('2026-08-24T12:00:00.000Z');
    db.tables.set('migration_quarantine', new Map([
      ['legacy-corrupt:1751328000000', JSON.stringify({
        accountOwnerHash: 'legacy-unbound-owner',
        encryptedLegacyPayload: 'old private migration bytes',
        originalByteLength: 27,
        quarantinedAt: '2026-07-01T00:00:00.000Z',
        reason: 'corrupt_legacy_queue',
        retainedUntil: '2026-07-31T00:00:00.000Z',
        truncated: false,
      })],
      ['legacy-corrupt:1755648000000', JSON.stringify({
        accountOwnerHash: 'legacy-unbound-owner',
        encryptedLegacyPayload: 'recent private migration bytes',
        originalByteLength: 30,
        quarantinedAt: '2026-08-20T00:00:00.000Z',
        reason: 'corrupt_legacy_queue',
        retainedUntil: '2026-09-19T00:00:00.000Z',
        truncated: false,
      })],
    ]));
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '68'.repeat(32), setItemAsync: async () => undefined },
      now: () => clock,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    assert.deepEqual([...(db.tables.get('migration_quarantine')?.keys() ?? [])], ['legacy-corrupt:1755648000000']);
    const retainedManifest = [...(db.tables.get('migration_quarantine')?.values() ?? [])].join('');
    assert.match(retainedManifest, /"rawPayloadRetained":false/u);
    assert.doesNotMatch(retainedManifest, /old private migration bytes|recent private migration bytes/u);
    assert.doesNotMatch(
      JSON.stringify(await store.exportSupportQuarantine()),
      /old private migration bytes|recent private migration bytes/u,
    );
    const diagnostics = await store.exportDiagnostics();
    assert.match(diagnostics, /CORRUPT_LEGACY_QUEUE_BLOB_PURGED|"purgedBlobCount":1/u);
    assert.doesNotMatch(diagnostics, /old private|recent private/u);
  });

  it('infers the support horizon for pre-policy corrupt rows and does not retain them forever', async () => {
    const db = createDatabase({ userVersion: 2 });
    const quarantinedAt = new Date('2026-07-01T00:00:00.000Z');
    db.tables.set('migration_quarantine', new Map([[
      `legacy-corrupt:${quarantinedAt.getTime()}`,
      JSON.stringify({
        encryptedLegacyPayload: 'old-format private bytes',
        originalByteLength: 24,
        reason: 'corrupt_legacy_queue',
        truncated: false,
      }),
    ]]));
    await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '69'.repeat(32), setItemAsync: async () => undefined },
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    assert.equal(db.tables.get('migration_quarantine')?.size ?? 0, 0);
    const summary = [...(db.tables.get('diagnostic_records')?.values() ?? [])].join('');
    assert.match(summary, /CORRUPT_LEGACY_QUEUE_BLOB_PURGED/u);
    assert.doesNotMatch(summary, /old-format private bytes/u);
  });

  it('requires a durable support export before account or global quarantine purge', async () => {
    const db = createDatabase({ userVersion: 2 });
    const ownerA = 'a1'.repeat(32);
    const ownerB = 'b2'.repeat(32);
    db.tables.set('migration_quarantine', new Map([
      [`${ownerA}:driver-event:a`, JSON.stringify({
        accountOwnerHash: ownerA,
        event: { clientEventId: 'a', payload: { note: 'owner A private note' } },
        kind: 'driver_event',
        queueItemId: 'driver-event:a',
        queueSequence: 1,
        reconciliation: { blockedAt: '2026-08-24T00:00:00.000Z', reason: 'route_not_in_progress' },
        state: 'QUARANTINED',
      })],
      [`${ownerB}:driver-event:b`, JSON.stringify({
        accountOwnerHash: ownerB,
        event: { clientEventId: 'b', payload: { note: 'owner B private note' } },
        kind: 'driver_event',
        queueItemId: 'driver-event:b',
        queueSequence: 2,
        reconciliation: { blockedAt: '2026-08-24T00:00:00.000Z', reason: 'route_not_in_progress' },
        state: 'QUARANTINED',
      })],
    ]));
    let tokenByte = 1;
    const openStore = () => createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '6a'.repeat(32), setItemAsync: async () => undefined },
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      openDatabaseAsync: async () => db.database,
      randomBytes: async (length) => new Uint8Array(length).fill(tokenByte++),
    });
    const store = await openStore();

    await assert.rejects(store.purgeExportedSupportQuarantine({
      accountOwnerHash: ownerA,
      exportToken: 'not-exported',
    }), /requires a durable export marker/u);
    const accountExport = await store.exportSupportQuarantine({ accountOwnerHash: ownerA });
    assert.equal(accountExport.scope, 'account');
    assert.deepEqual(accountExport.records.map((record) => record.recordKey), [`${ownerA}:driver-event:a`]);
    assert.doesNotMatch(JSON.stringify(accountExport), /owner A private note/u);
    const restarted = await openStore();
    await assert.rejects(restarted.purgeExportedSupportQuarantine({
      accountOwnerHash: ownerB,
      exportToken: accountExport.exportToken,
    }), /scope does not match/u);
    assert.equal(await restarted.purgeExportedSupportQuarantine({
      accountOwnerHash: ownerA,
      exportToken: accountExport.exportToken,
    }), 1);
    assert.deepEqual([...(db.tables.get('migration_quarantine')?.keys() ?? [])], [`${ownerB}:driver-event:b`]);

    const globalExport = await restarted.exportSupportQuarantine();
    assert.equal(globalExport.scope, 'global');
    assert.equal(await restarted.purgeExportedSupportQuarantine({ exportToken: globalExport.exportToken }), 1);
    assert.equal(db.tables.get('migration_quarantine')?.size ?? 0, 0);
    const diagnostics = await restarted.exportDiagnostics();
    assert.match(diagnostics, /SUPPORT_QUARANTINE_EXPORTED_AND_PURGED/u);
    assert.doesNotMatch(diagnostics, /private note|driver-event:a|driver-event:b/u);
  });

  it('does not purge recent corrupt evidence when the device clock rolls backward', async () => {
    const db = createDatabase();
    let clock = new Date('2026-08-24T12:00:00.000Z');
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '6b'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: {
        getItem: async () => '{"private":"clock rollback evidence"',
        removeItem: async () => undefined,
      },
      now: () => clock,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const beforeRollback = db.tables.get('migration_quarantine')?.size;
    clock = new Date('2026-08-01T12:00:00.000Z');
    await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY);

    assert.equal(beforeRollback, 1);
    assert.equal(db.tables.get('migration_quarantine')?.size, 1);
    assert.doesNotMatch(await store.exportDiagnostics(), /clock rollback evidence/u);
  });

  it('repairs malformed corrupt-retention metadata without retaining private bytes forever', async () => {
    const db = createDatabase({ userVersion: 2 });
    let clock = new Date('2026-08-24T12:00:00.000Z');
    const corruptKey = 'legacy-corrupt:999999999999999999999';
    db.tables.set('migration_quarantine', new Map([[corruptKey, '{"private":"tampered retention bytes"']]));
    db.createdAtByRecordKey.set(corruptKey, '2026-08-20T00:00:00.000Z');
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '6c'.repeat(32), setItemAsync: async () => undefined },
      now: () => clock,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    const repaired = db.tables.get('migration_quarantine')?.values().next().value ?? '';
    assert.match(repaired, /CORRUPT_ENCRYPTED_EVIDENCE_ROW/u);
    assert.doesNotMatch(repaired, /tampered retention bytes/u);
    await assert.rejects(store.purgeExportedSupportQuarantine({ exportToken: 'not-exported' }), /durable export marker/u);
    const exported = await store.exportSupportQuarantine();
    assert.equal(exported.records.length, 1);
    assert.doesNotMatch(JSON.stringify(exported.records), /tampered retention bytes/u);
    clock = new Date('2026-09-20T00:00:00.001Z');
    assert.equal(await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY), null);
    assert.equal(db.tables.get('migration_quarantine')?.size ?? 0, 0);
    const diagnostics = await store.exportDiagnostics();
    assert.match(diagnostics, /CORRUPT_LEGACY_QUEUE_BLOB_PURGED/u);
    assert.doesNotMatch(diagnostics, /tampered retention bytes/u);
  });

  it('quarantines malformed evidence rows while valid queue reads continue', async () => {
    const db = createDatabase({ userVersion: 2 });
    let clock = new Date('2026-08-24T12:00:00.000Z');
    const owner = '6d'.repeat(32);
    db.tables.set('workflow_evidence', new Map([
      [`${owner}:driver-event:valid`, JSON.stringify({
        accountOwnerHash: owner,
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: { clientEventId: 'valid', eventType: 'STOP_DELIVERED', occurredAt: '2026-08-24T00:00:00.000Z' },
        journal: [],
        kind: 'driver_event',
        queueItemId: 'driver-event:valid',
        queueSequence: 2,
        state: 'PENDING',
      })],
      [`${owner}:driver-event:tampered`, '{"private":"hostile row bytes"'],
    ]));
    db.createdAtByRecordKey.set(`${owner}:driver-event:tampered`, '2026-08-20T00:00:00.000Z');
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '6e'.repeat(32), setItemAsync: async () => undefined },
      now: () => clock,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });

    const hydrated = JSON.parse(await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items?: { queueItemId?: string }[];
    };
    assert.deepEqual(hydrated.items?.map((item) => item.queueItemId), ['driver-event:valid']);
    assert.equal(db.tables.get('workflow_evidence')?.has(`${owner}:driver-event:tampered`), false);
    const quarantine = [...(db.tables.get('migration_quarantine')?.values() ?? [])].join('');
    assert.match(quarantine, /CORRUPT_ENCRYPTED_EVIDENCE_ROW/u);
    assert.doesNotMatch(quarantine, /hostile row bytes/u);
    assert.doesNotMatch(await store.exportDiagnostics(), /hostile row bytes/u);
    clock = new Date('2026-09-20T00:00:00.001Z');
    const afterRetention = JSON.parse(await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items?: { queueItemId?: string }[];
    };
    assert.deepEqual(afterRetention.items?.map((item) => item.queueItemId), ['driver-event:valid']);
    assert.equal(db.tables.get('migration_quarantine')?.size ?? 0, 0);
  });

  it('isolates JSON-valid schema-invalid rows without discarding valid replay evidence', async () => {
    const db = createDatabase({ userVersion: 2 });
    const owner = '6f'.repeat(32);
    const now = () => new Date('2026-08-24T12:00:00.000Z');
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '70'.repeat(32), setItemAsync: async () => undefined },
      now,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const validKey = `${owner}:driver-event:valid-schema`;
    await store.setItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY, JSON.stringify({
      items: [
        {
          accountOwnerHash: owner,
          attempts: 0,
          enqueuedAt: now().toISOString(),
          event: {
            clientEventId: 'valid-schema',
            eventType: 'STOP_DELIVERED',
            occurredAt: now().toISOString(),
            payload: { note: 'private valid replay note' },
            routePlanId: 'route-schema',
          },
          journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
          kind: 'driver_event',
          queueItemId: 'driver-event:valid-schema',
          queueSequence: 1,
          state: 'PENDING',
        },
        {
          accountOwnerHash: owner,
          attempts: 0,
          enqueuedAt: now().toISOString(),
          event: {
            accuracyMeters: 8,
            clientEventId: 'valid-location',
            eventType: 'LOCATION_UPDATED',
            latitude: 43.4516,
            longitude: -80.4925,
            occurredAt: now().toISOString(),
            routePlanId: 'route-schema',
          },
          journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
          kind: 'driver_event',
          queueItemId: 'driver-event:valid-location',
          queueSequence: 2,
          state: 'PENDING',
        },
      ],
      version: 2,
    }));
    const validSensitiveBefore = db.tables.get('sensitive_evidence')?.get(validKey);
    const validLocationKey = `${owner}:driver-event:valid-location`;
    const validLocationBefore = db.tables.get('location_batches')?.get(validLocationKey);
    assert.notEqual(validSensitiveBefore, undefined);
    assert.notEqual(validLocationBefore, undefined);
    const invalidKey = `${owner}:driver-event:json-valid-invalid`;
    db.tables.get('workflow_evidence')?.set(invalidKey, '{}');
    db.tables.get('sensitive_evidence')?.set(invalidKey, JSON.stringify({
      kind: 'driver_event', payload: { note: 'private invalid replay note' },
    }));
    db.createdAtByRecordKey.set(invalidKey, now().toISOString());

    const queue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, now, storage: store });
    assert.deepEqual(queue.listPending().map((item) => item.queueItemId), [
      'driver-event:valid-schema',
      'driver-event:valid-location',
    ]);
    const restoredLocation = queue.listPending().find((item) => item.queueItemId === 'driver-event:valid-location');
    assert.equal(restoredLocation?.kind === 'driver_event' ? restoredLocation.event.accuracyMeters : null, 8);
    assert.equal(db.tables.get('workflow_evidence')?.has(invalidKey), false);
    assert.equal(db.tables.get('sensitive_evidence')?.has(invalidKey), false);
    assert.equal(db.tables.get('sensitive_evidence')?.get(validKey), validSensitiveBefore);
    assert.equal(db.tables.get('location_batches')?.get(validLocationKey), validLocationBefore);
    assert.match([...(db.tables.get('migration_quarantine')?.values() ?? [])].join(''), /CORRUPT_ENCRYPTED_EVIDENCE_ROW/u);
    assert.doesNotMatch(await store.exportDiagnostics(), /private valid replay note|private invalid replay note/u);
    assert.equal(db.runCalls.some(({ sql }) => sql.includes("json_set(payload, '$.state', 'DISCARDED')")), false);
    assert.equal(db.runCalls.some(({ sql }) => sql.includes('UPDATE sensitive_evidence SET expires_at')), false);

    const replayed: string[] = [];
    const result = await retryOfflineSubmissions({
      driverEventService: { recordDriverEvent: async (event) => {
        replayed.push(event.clientEventId);
        return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
      } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue,
    });
    assert.deepEqual(replayed, ['valid-schema', 'valid-location']);
    assert.equal(result.succeeded, 2);
  });

  it('restores a proof URI and reuses its idempotency key after an encrypted cold restart', async () => {
    const db = createDatabase({ userVersion: 2 });
    const owner = '71'.repeat(32);
    const now = () => new Date('2026-08-24T12:00:00.000Z');
    const openStore = () => createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '72'.repeat(32), setItemAsync: async () => undefined },
      now,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const queue = await createPersistentOfflineSubmissionQueue({
      accountOwnerHash: owner,
      now,
      storage: await openStore(),
    });
    const request = {
      deliveryStopId: 'proof-restart-stop',
      fileName: 'proof-restart.jpg',
      routePlanId: 'proof-restart-route',
      source: 'camera' as const,
      uri: 'file:///private/proof-restart.jpg',
    };
    const queued = queue.enqueueProofMediaUpload(request);
    await queue.whenPersisted();
    let beforeRestartKey: string | undefined;
    await retryOfflineSubmissions({
      driverEventService: { recordDriverEvent: async () => { throw new Error('unused'); } },
      proofMediaUploadService: {
        uploadProofMedia: async (_upload, options) => {
          beforeRestartKey = options?.idempotencyKey;
          throw new Error('response unavailable before restart');
        },
      },
      queue,
    });
    await queue.whenPersisted();
    assert.match(beforeRestartKey ?? '', /^proof-media-v1:[0-9a-f]{32}$/u);

    const recordKey = `${owner}:${queued.queueItemId}`;
    assert.doesNotMatch(db.tables.get('workflow_evidence')?.get(recordKey) ?? '', /private\/proof-restart/u);
    assert.match(db.tables.get('sensitive_evidence')?.get(recordKey) ?? '', /private\/proof-restart/u);

    const restartedQueue = await createPersistentOfflineSubmissionQueue({
      accountOwnerHash: owner,
      now,
      storage: await openStore(),
    });
    const restored = restartedQueue.listPending()[0];
    assert.equal(restored?.kind, 'proof_media');
    assert.equal(restored?.kind === 'proof_media' ? restored.request.uri : null, request.uri);
    let afterRestartKey: string | undefined;
    const replay = await retryOfflineSubmissions({
      driverEventService: { recordDriverEvent: async () => { throw new Error('unused'); } },
      proofMediaUploadService: {
        uploadProofMedia: async (upload, options) => {
          afterRestartKey = options?.idempotencyKey;
          return {
            contentType: 'image/jpeg',
            kind: 'photo',
            mediaId: 'proof-restart-media',
            source: upload.source,
            storageKey: 'driver-proof/proof-restart-media.jpg',
            uploadedAt: now().toISOString(),
          };
        },
      },
      queue: restartedQueue,
    });
    await restartedQueue.whenPersisted();

    assert.equal(afterRestartKey, beforeRestartKey);
    assert.equal(replay.succeeded, 1);
    assert.deepEqual(restartedQueue.listPending(), []);
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

  it('preserves the complete ordered-event lineage through the production encrypted serializer', async () => {
    const db = createDatabase({ userVersion: 2 });
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '71'.repeat(32), setItemAsync: async () => undefined },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const lineage = {
      appVersion: '2.8.0',
      assignmentGeneration: '11',
      driverContractVersion: 2,
      expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
      versionCode: 20800,
    } as const;
    await store.setItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY, JSON.stringify({
      items: [{
        accountOwnerHash: 'aa'.repeat(32),
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: {
          ...lineage,
          clientEventId: 'lineage-round-trip',
          eventType: 'ROUTE_COMPLETED',
          occurredAt: '2026-08-24T00:00:00.000Z',
          routePlanId: 'route-lineage',
        },
        journal: [{ at: '2026-08-24T00:00:00.000Z', code: 'ENQUEUED', kind: 'ENQUEUED' }],
        kind: 'driver_event',
        queueItemId: 'driver-event:lineage-round-trip',
        queueSequence: 1,
        state: 'PENDING',
      }],
      version: 2,
    }));

    const reread = JSON.parse(await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { event: Record<string, unknown> }[];
    };
    assert.deepEqual({
      appVersion: reread.items[0]?.event.appVersion,
      assignmentGeneration: reread.items[0]?.event.assignmentGeneration,
      driverContractVersion: reread.items[0]?.event.driverContractVersion,
      expectedRouteVersionId: reread.items[0]?.event.expectedRouteVersionId,
      versionCode: reread.items[0]?.event.versionCode,
    }, lineage);
    assert.match(db.tables.get('workflow_evidence')?.values().next().value ?? '', /assignmentGeneration/u);
    assert.equal(db.tables.get('sensitive_evidence')?.size ?? 0, 0);
  });

  it('recovers a response-lost delivery finish from real encrypted persistence after restart without replay', async () => {
    const db = createDatabase({ userVersion: 2 });
    const keyStore = { getItemAsync: async () => '72'.repeat(32), setItemAsync: async () => undefined };
    const openStore = () => createEncryptedEvidenceStore({
      keyStore,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const firstQueue = await createPersistentOfflineSubmissionQueue({ storage: await openStore() });
    const routePlanId = '11111111-1111-4111-8111-111111111111';
    const contract = {
      appVersion: '2.8.0',
      assignmentGeneration: sampleInvitedRouteAccess.routeAccess.assignmentGeneration,
      driverContractVersion: 2 as const,
      expectedRouteVersionId: sampleInvitedRouteAccess.routeAccess.expectedRouteVersionId,
      versionCode: 20800,
    };
    const live = createDriverApiClientsFromRouteAccess({
      appVersion: contract.appVersion,
      baseUrl: 'https://route.test',
      fetchImpl: async () => { throw new TypeError('response lost'); },
      refreshDriverAccess: async () => sampleInvitedRouteAccess.driverAccess,
      routeAccess: sampleInvitedRouteAccess,
      versionCode: contract.versionCode,
    }).driverEventService;
    const finish = await finishDeliveryAfterActive({
      deliveryStart: { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' },
      driverEventService: createRouteOrderedDriverEventService({
        driverEventService: live,
        queue: firstQueue,
        routePlanId,
      }),
      now: new Date('2026-08-22T19:42:10.000Z'),
      offlineQueue: firstQueue,
      routePlanId,
      streamService: {
        getBackgroundAvailability: async () => true,
        getBackgroundPermission: async () => 'granted',
        hasStartedLocationUpdates: async () => true,
        requestBackgroundPermission: async () => 'granted',
        startLocationUpdates: async () => undefined,
        stopLocationUpdates: async () => undefined,
      },
    });
    assert.equal(finish.kind, 'queued');

    const restarted = await createPersistentOfflineSubmissionQueue({ storage: await openStore() });
    const persisted = restarted.listPending()[0];
    assert.equal(persisted?.kind, 'driver_event');
    if (persisted?.kind !== 'driver_event') throw new Error('Expected persisted completion');
    assert.deepEqual({
      appVersion: persisted.event.appVersion,
      assignmentGeneration: persisted.event.assignmentGeneration,
      driverContractVersion: persisted.event.driverContractVersion,
      expectedRouteVersionId: persisted.event.expectedRouteVersionId,
      versionCode: persisted.event.versionCode,
    }, contract);

    let replayed = false;
    const recovery = await retryOfflineSubmissions({
      driverEventReceiptService: { lookupReceipt: async () => ({
        assignmentGeneration: contract.assignmentGeneration,
        clientEventId: persisted.event.clientEventId,
        errorCode: null,
        expectedRouteVersionId: contract.expectedRouteVersionId,
        routePlanId,
        routeStatus: 'COMPLETED',
        status: 'APPLIED',
      }) },
      driverEventService: { recordDriverEvent: async () => { replayed = true; throw new Error('must not replay'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unused'); } },
      queue: restarted,
    });
    await restarted.whenPersisted();
    assert.equal(replayed, false);
    assert.deepEqual(recovery.completionAcknowledgedRoutePlanIds, [routePlanId]);
    assert.deepEqual(restarted.listPending(), []);
  });

  it('keeps an acknowledged completion clear outbox past 30 days in encrypted storage', async () => {
    const db = createDatabase({ userVersion: 2 });
    let currentTime = new Date('2026-06-01T00:00:00.000Z');
    const keyStore = { getItemAsync: async () => '73'.repeat(32), setItemAsync: async () => undefined };
    const openStore = () => createEncryptedEvidenceStore({
      keyStore,
      now: () => currentTime,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const first = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage: await openStore() });
    const completion = first.enqueueDriverEvent({
      assignmentGeneration: '11', clientEventId: 'encrypted-long-lived-clear', driverContractVersion: 2,
      eventType: 'ROUTE_COMPLETED', occurredAt: currentTime, routePlanId: 'encrypted-route',
    });
    first.acknowledge(completion.queueItemId);
    await first.whenPersisted();

    currentTime = new Date('2026-07-05T00:00:00.000Z');
    const restarted = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage: await openStore() });
    const [entry] = restarted.listPendingCompletionClearEntries();
    assert.equal(entry?.completionClientEventId, 'encrypted-long-lived-clear');
    assert.equal(restarted.markCompletionClearHeartbeatDelivered(entry!), true);
    await restarted.whenPersisted();

    currentTime = new Date('2026-08-05T00:00:01.000Z');
    const expired = await createPersistentOfflineSubmissionQueue({ now: () => currentTime, storage: await openStore() });
    assert.equal(expired.getRouteCompletionTelemetry('encrypted-route').locallyFinished, false);
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
      sha256: async () => new Uint8Array(32).fill(7),
    });

    const quarantined = db.tables.get('migration_quarantine')?.values().next().value ?? '{}';
    const parsed = JSON.parse(quarantined) as {
      encryptedLegacyPayload?: string;
      originalByteLength: number;
      payloadHmac: string;
      rawPayloadRetained: boolean;
      truncated: boolean;
    };
    assert.equal(parsed.truncated, true);
    assert.ok(new TextEncoder().encode(quarantined).byteLength <= 64 * 1024);
    assert.equal(parsed.encryptedLegacyPayload, undefined);
    assert.equal(parsed.payloadHmac, '07'.repeat(32));
    assert.equal(parsed.rawPayloadRetained, false);
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

  it('rejects legacy cleanup when a reread changes ordered-event lineage covered by the keyed manifest', async () => {
    const db = createDatabase({ corruptReadLineage: true });
    const removed: string[] = [];
    const legacyPayload = JSON.stringify({
      items: [{
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: {
          appVersion: '2.8.0',
          assignmentGeneration: '11',
          clientEventId: 'lineage-manifest',
          driverContractVersion: 2,
          eventType: 'ROUTE_COMPLETED',
          expectedRouteVersionId: '22222222-2222-4222-8222-222222222222',
          occurredAt: '2026-08-24T00:00:00.000Z',
          routePlanId: 'route-lineage',
          versionCode: 20800,
        },
        kind: 'driver_event',
        queueItemId: 'driver-event:lineage-manifest',
      }],
      version: 1,
    });
    await assert.rejects(createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => 'f1'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: { getItem: async () => legacyPayload, removeItem: async (key) => { removed.push(key); } },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async (value) => {
        const result = new Uint8Array(32);
        result.fill(value.reduce((sum, byte) => (sum + byte) % 251, 0));
        return result;
      },
    }), /manifest verification failed/u);
    assert.deepEqual(removed, []);
  });

  it('hydrates a non-empty v1 queue through the public queue API before deleting AsyncStorage', async () => {
    const db = createDatabase();
    const removed: string[] = [];
    const now = () => new Date('2026-08-24T12:00:00.000Z');
    const legacyPayload = JSON.stringify({
      items: [
        {
          attempts: 1,
          enqueuedAt: '2026-08-24T10:00:00.000Z',
          event: {
            clientEventId: 'legacy-second-by-id',
            eventType: 'STOP_DELIVERED',
            occurredAt: '2026-08-24T10:00:00.000Z',
            payload: { note: 'private legacy note' },
            routePlanId: 'route-legacy',
          },
          kind: 'driver_event',
          queueItemId: 'driver-event:z-id',
        },
        {
          attempts: 0,
          enqueuedAt: '2026-08-24T09:00:00.000Z',
          kind: 'proof_media',
          queueItemId: 'proof-media:a-id',
          request: {
            deliveryStopId: 'stop-2',
            fileName: 'proof.jpg',
            routePlanId: 'route-legacy',
            source: 'camera',
            uri: 'file:///private-proof.jpg',
          },
        },
      ],
      version: 1,
    });
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '12'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: {
        getItem: async () => legacyPayload,
        removeItem: async (key) => { removed.push(key); },
      },
      now,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32),
    });

    assert.deepEqual(removed, [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]);
    const queue = await createPersistentOfflineSubmissionQueue({ storage: store, now });
    await queue.whenPersisted();
    const pending = queue.listPending();
    assert.deepEqual(pending.map((item) => item.queueItemId), ['driver-event:z-id', 'proof-media:a-id']);
    assert.deepEqual(pending.map((item) => item.queueSequence), [1, 2]);
    assert.ok(pending.every((item) => item.accountOwnerHash === 'test-account-owner' && item.state === 'PENDING'));
    assert.ok(pending.every((item) => item.journal[0]?.code === 'LEGACY_MIGRATED'));
    const legacyDriver = pending.find((item) => item.kind === 'driver_event');
    assert.equal(legacyDriver?.kind, 'driver_event');
    if (legacyDriver?.kind !== 'driver_event') throw new Error('Expected legacy driver event');
    assert.deepEqual({
      appVersion: legacyDriver.event.appVersion,
      assignmentGeneration: legacyDriver.event.assignmentGeneration,
      driverContractVersion: legacyDriver.event.driverContractVersion,
      expectedRouteVersionId: legacyDriver.event.expectedRouteVersionId,
      versionCode: legacyDriver.event.versionCode,
    }, {
      appVersion: undefined,
      assignmentGeneration: undefined,
      driverContractVersion: undefined,
      expectedRouteVersionId: undefined,
      versionCode: undefined,
    });
    assert.doesNotMatch(db.tables.get('workflow_evidence')?.values().next().value ?? '', /private legacy note/u);
    assert.match(db.tables.get('sensitive_evidence')?.values().next().value ?? '', /private legacy note/u);
    assert.ok([...(db.tables.get('sensitive_evidence')?.keys() ?? [])].every((key) => key.startsWith('test-account-owner:')));
  });

  it('quarantines structurally invalid v1 lineage before deleting the original', async () => {
    const db = createDatabase();
    const removed: string[] = [];
    const structurallyInvalid = JSON.stringify({
      items: [{
        attempts: 0,
        enqueuedAt: '2026-08-24T00:00:00.000Z',
        event: {
          assignmentGeneration: { tampered: true },
          clientEventId: 'tampered-lineage',
          driverContractVersion: 2,
          eventType: 'ROUTE_COMPLETED',
          occurredAt: '2026-08-24T00:00:00.000Z',
          routePlanId: 'route-tampered',
        },
        kind: 'driver_event',
        queueItemId: 'driver-event:tampered-lineage',
      }],
      version: 1,
    });
    await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '13'.repeat(32), setItemAsync: async () => undefined },
      legacyStorage: {
        getItem: async () => structurallyInvalid,
        removeItem: async (key) => { removed.push(key); },
      },
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
      sha256: async () => new Uint8Array(32).fill(8),
    });

    assert.deepEqual(removed, [OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY]);
    const quarantined = db.tables.get('migration_quarantine')?.values().next().value ?? '';
    assert.equal((JSON.parse(quarantined) as { payloadHmac: string }).payloadHmac, '08'.repeat(32));
    assert.doesNotMatch(quarantined, /tampered-lineage|route-tampered/u);
  });

  it('uses original audit timestamps, bounds journals, purges old terminal rows, and retains unresolved quarantine', async () => {
    const db = createDatabase({ userVersion: 2 });
    let clock = new Date('2026-08-24T12:00:00.000Z');
    const now = () => clock;
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '14'.repeat(32), setItemAsync: async () => undefined },
      now,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const owner = 'cc'.repeat(32);
    const recentAckAt = '2026-08-23T12:00:00.000Z';
    const journal = Array.from({ length: 70 }, (_, index) => ({
      at: new Date(clock.getTime() - (70 - index) * 60_000).toISOString(),
      code: `ATTEMPT_${index}`,
      kind: 'ATTEMPT',
    }));
    journal.push({ at: recentAckAt, code: 'SERVER_ACK', kind: 'ACK' });
    const envelope = {
      items: [
        {
          accountOwnerHash: owner,
          attempts: 70,
          enqueuedAt: '2026-08-01T12:00:00.000Z',
          event: { clientEventId: 'recent-ack', eventType: 'STOP_DELIVERED', occurredAt: recentAckAt, payload: { note: 'sensitive' }, routePlanId: 'route-1' },
          journal,
          kind: 'driver_event',
          queueItemId: 'driver-event:recent-ack',
          queueSequence: 1,
          state: 'ACKNOWLEDGED',
        },
        {
          accountOwnerHash: owner,
          attempts: 1,
          enqueuedAt: '2026-05-01T12:00:00.000Z',
          event: { clientEventId: 'unresolved', eventType: 'STOP_FAILED', occurredAt: '2026-05-01T12:00:00.000Z', routePlanId: 'route-1' },
          journal: [{ at: '2026-05-01T12:00:00.000Z', code: 'ROUTE_NOT_IN_PROGRESS', kind: 'RECONCILIATION' }],
          kind: 'driver_event',
          queueItemId: 'driver-event:unresolved',
          queueSequence: 2,
          reconciliation: { blockedAt: '2026-05-01T12:00:00.000Z', reason: 'route_not_in_progress' },
          state: 'QUARANTINED',
        },
      ],
      version: 2,
    };
    await store.setItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY, JSON.stringify(envelope));
    await store.setItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY, JSON.stringify(envelope));

    const journalInserts = db.runCalls.filter((call) => call.sql.includes('INTO evidence_journal'));
    assert.equal(db.tables.get('evidence_journal')?.size, 64);
    assert.ok(journalInserts.some((call) => call.params[4] === recentAckAt));
    assert.ok(journalInserts.every((call) => call.params[4] !== clock.toISOString()));

    clock = new Date('2026-09-24T12:00:00.000Z');
    await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY);
    assert.equal(db.tables.get('workflow_evidence')?.size ?? 0, 0);
    assert.equal(db.tables.get('sensitive_evidence')?.size ?? 0, 0);
    assert.equal(db.tables.get('migration_quarantine')?.size, 1);
  });

  it('purges a 31-day ACK identically before a new public queue write and encrypted reread', async () => {
    const db = createDatabase({ userVersion: 2 });
    let clock = new Date('2026-07-01T12:00:00.000Z');
    const now = () => clock;
    const store = await createEncryptedEvidenceStore({
      keyStore: { getItemAsync: async () => '15'.repeat(32), setItemAsync: async () => undefined },
      now,
      openDatabaseAsync: async () => db.database,
      randomBytes: async () => new Uint8Array(32),
    });
    const queue = await createPersistentOfflineSubmissionQueue({ now, storage: store });
    const acknowledged = queue.enqueueDriverEvent({
      clientEventId: 'acknowledged-before-retention-cutoff',
      eventType: 'STOP_DELIVERED',
      occurredAt: clock,
      routePlanId: 'route-retention',
    });
    await queue.whenPersisted();
    assert.equal(queue.acknowledge(acknowledged.queueItemId), true);
    await queue.whenPersisted();

    clock = new Date('2026-08-01T12:00:01.000Z');
    queue.enqueueDriverEvent({
      clientEventId: 'new-after-retention-cutoff',
      eventType: 'STOP_DELIVERED',
      occurredAt: clock,
      routePlanId: 'route-retention',
    });
    await queue.whenPersisted();

    assert.equal(queue.storageState(), 'READY');
    const reread = JSON.parse(await store.getItem(OFFLINE_SUBMISSION_QUEUE_STORAGE_KEY) ?? '{}') as {
      items: { queueItemId: string }[];
    };
    assert.deepEqual(reread.items.map((item) => item.queueItemId), ['driver-event:new-after-retention-cutoff']);
    assert.equal(db.tables.get('workflow_evidence')?.size, 1);
  });
});
