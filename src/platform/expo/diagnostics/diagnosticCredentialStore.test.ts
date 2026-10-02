import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_DIAGNOSTIC_CREDENTIAL_KEY_PREFIX,
  createDiagnosticCredentialStore,
} from './diagnosticCredentialStore';

describe('diagnostic credential storage', () => {
  it('stores the write-only credential under an account-scoped diagnostic key', async () => {
    const values = new Map<string, string>();
    const store = createDiagnosticCredentialStore({
      storage: {
        deleteItemAsync: async (key) => { values.delete(key); },
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => { values.set(key, value); },
      },
    });
    const owner = 'aa'.repeat(32);
    const credential = { expiresAt: '2026-10-02T14:00:00.000Z', token: 'diagnostic-write-token' };

    await store.set(owner, credential);
    assert.deepEqual(await store.get(owner), credential);
    assert.deepEqual([...values.keys()], [`${DRIVER_DIAGNOSTIC_CREDENTIAL_KEY_PREFIX}${owner}`]);
    await store.remove(owner);
    assert.equal(await store.get(owner), null);
  });

  it('does not cross account boundaries', async () => {
    const values = new Map<string, string>();
    const store = createDiagnosticCredentialStore({
      storage: {
        deleteItemAsync: async (key) => { values.delete(key); },
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => { values.set(key, value); },
      },
    });
    const first = 'aa'.repeat(32);
    const second = 'bb'.repeat(32);
    await store.set(first, { expiresAt: '2026-10-02T14:00:00.000Z', token: 'first-token' });
    await store.set(second, { expiresAt: '2026-10-02T14:00:00.000Z', token: 'second-token' });
    await store.remove(first);

    assert.equal(await store.get(first), null);
    assert.equal((await store.get(second))?.token, 'second-token');
  });

  it('compare-deletes only the expected stale credential', async () => {
    const values = new Map<string, string>();
    const store = createDiagnosticCredentialStore({
      storage: {
        deleteItemAsync: async (key) => { values.delete(key); },
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => { values.set(key, value); },
      },
    });
    const owner = 'aa'.repeat(32);
    await store.set(owner, { expiresAt: '2026-10-02T14:00:00.000Z', token: 'old-token' });
    await store.set(owner, { expiresAt: '2026-10-02T15:00:00.000Z', token: 'new-token' });

    await store.remove(owner, 'old-token');
    assert.equal((await store.get(owner))?.token, 'new-token');
    await store.remove(owner, 'new-token');
    assert.equal(await store.get(owner), null);
  });

  it('serializes a late set before its matching compare-delete', async () => {
    const values = new Map<string, string>();
    let releaseSet!: () => void;
    const setGate = new Promise<void>((resolve) => { releaseSet = resolve; });
    const store = createDiagnosticCredentialStore({
      storage: {
        deleteItemAsync: async (key) => { values.delete(key); },
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => {
          await setGate;
          values.set(key, value);
        },
      },
    });
    const owner = 'aa'.repeat(32);
    const lateSet = store.set(owner, { expiresAt: '2026-10-02T14:00:00.000Z', token: 'late-token' });
    const cleanup = store.remove(owner, 'late-token');
    releaseSet();

    await Promise.all([lateSet, cleanup]);
    assert.equal(await store.get(owner), null);
  });

  it('deletes malformed values without returning or printing token material', async () => {
    const owner = 'aa'.repeat(32);
    const key = `${DRIVER_DIAGNOSTIC_CREDENTIAL_KEY_PREFIX}${owner}`;
    const values = new Map([[key, JSON.stringify({ expiresAt: 'not-a-date', token: 'must-not-escape' })]]);
    const deleted: string[] = [];
    const store = createDiagnosticCredentialStore({
      storage: {
        deleteItemAsync: async (storageKey) => {
          deleted.push(storageKey);
          values.delete(storageKey);
        },
        getItemAsync: async (storageKey) => values.get(storageKey) ?? null,
        setItemAsync: async (storageKey, value) => { values.set(storageKey, value); },
      },
    });

    assert.equal(await store.get(owner), null);
    assert.deepEqual(deleted, [key]);
    await assert.rejects(
      store.set(owner, { expiresAt: 'invalid', token: 'must-not-appear-in-error' }),
      (error: unknown) => error instanceof Error
        && /invalid diagnostic credential/iu.test(error.message)
        && !error.message.includes('must-not-appear-in-error'),
    );
  });
});
