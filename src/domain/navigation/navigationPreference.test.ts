import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createNavigationPreferenceStore,
  DEFAULT_NAVIGATION_PROVIDER,
  NAVIGATION_PROVIDER_STORAGE_KEY,
} from './navigationPreference';

describe('navigation preference storage', () => {
  it('defaults to Google Maps when no saved preference exists', async () => {
    const store = createNavigationPreferenceStore({
      getItem: async () => null,
      setItem: async () => undefined,
    });

    assert.equal(await store.load(), DEFAULT_NAVIGATION_PROVIDER);
  });

  it('restores and saves only supported providers', async () => {
    const writes: [string, string][] = [];
    const store = createNavigationPreferenceStore({
      getItem: async (key) => key === NAVIGATION_PROVIDER_STORAGE_KEY ? 'waze' : null,
      setItem: async (key, value) => { writes.push([key, value]); },
    });

    assert.equal(await store.load(), 'waze');
    await store.save('google');
    assert.deepEqual(writes, [[NAVIGATION_PROVIDER_STORAGE_KEY, 'google']]);
  });

  it('fails closed to Google Maps for an unknown saved value', async () => {
    const store = createNavigationPreferenceStore({
      getItem: async () => 'unknown-provider',
      setItem: async () => undefined,
    });

    assert.equal(await store.load(), 'google');
  });

  it('serializes rapid provider writes in tap order', async () => {
    const calls: string[] = [];
    let releaseFirstWrite: () => void = () => undefined;
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const store = createNavigationPreferenceStore({
      getItem: async () => null,
      setItem: async (_key, value) => {
        calls.push(`start:${value}`);
        if (value === 'waze') await firstWriteGate;
        calls.push(`finish:${value}`);
      },
    });

    const first = store.save('waze');
    const second = store.save('google');
    await Promise.resolve();
    assert.deepEqual(calls, ['start:waze']);
    releaseFirstWrite();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['start:waze', 'finish:waze', 'start:google', 'finish:google']);
  });

  it('keeps the last durable provider when the newest serialized write fails', async () => {
    let persistedProvider = 'google';
    const store = createNavigationPreferenceStore({
      getItem: async () => persistedProvider,
      setItem: async (_key, value) => {
        if (value === 'google') throw new Error('storage unavailable');
        persistedProvider = value;
      },
    });

    const first = store.save('waze');
    const second = store.save('google');
    await first;
    await assert.rejects(second, /storage unavailable/u);
    assert.equal(await store.load(), 'waze');
  });
});
