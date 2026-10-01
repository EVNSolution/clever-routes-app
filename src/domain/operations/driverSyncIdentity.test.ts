import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverSyncIdentity } from './driverSyncIdentity';

describe('driver sync identity', () => {
  it('persists the device hash and monotonic per-session sequence before restart', async () => {
    let stored: string | null = null;
    const storage = {
      getItemAsync: async () => stored,
      setItemAsync: async (_key: string, value: string) => { stored = value; },
    };
    const create = () => createDriverSyncIdentity({
      createDeviceInstanceHash: async () => 'b'.repeat(64),
      now: () => new Date('2026-08-22T12:00:00.000Z'),
      storage,
    });
    assert.deepEqual(await create().next('owner:route:generation-7'), {
      deviceInstanceHash: 'b'.repeat(64), heartbeatSequence: 1, sessionGeneration: '2026-08-22T12:00:00.000Z',
    });
    assert.deepEqual(await create().next('owner:route:generation-7'), {
      deviceInstanceHash: 'b'.repeat(64), heartbeatSequence: 2, sessionGeneration: '2026-08-22T12:00:00.000Z',
    });
  });

  it('shares a newly persisted device hash between diagnostics and the first heartbeat', async () => {
    let stored: string | null = null;
    let createCount = 0;
    const identity = createDriverSyncIdentity({
      createDeviceInstanceHash: async () => { createCount += 1; return 'c'.repeat(64); },
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      storage: {
        getItemAsync: async () => stored,
        setItemAsync: async (_key, value) => { stored = value; },
      },
    });

    assert.equal(await identity.getDeviceInstanceHash(), 'c'.repeat(64));
    assert.deepEqual(await identity.next('owner:route:generation-1'), {
      deviceInstanceHash: 'c'.repeat(64), heartbeatSequence: 1, sessionGeneration: '2026-10-01T14:04:03.000Z',
    });
    assert.equal(createCount, 1);
  });

  it('returns the heartbeat-created device hash to diagnostics without creating another identity', async () => {
    let stored: string | null = null;
    let createCount = 0;
    const identity = createDriverSyncIdentity({
      createDeviceInstanceHash: async () => { createCount += 1; return 'd'.repeat(64); },
      storage: {
        getItemAsync: async () => stored,
        setItemAsync: async (_key, value) => { stored = value; },
      },
    });

    const heartbeat = await identity.next('owner:route:generation-1');

    assert.equal(await identity.getDeviceInstanceHash(), heartbeat.deviceInstanceHash);
    assert.equal(createCount, 1);
  });

  it('uses one initialization while repeated diagnostic getters wait for the first write', async () => {
    let createCount = 0;
    let persistCount = 0;
    let releasePersistence: (() => void) | undefined;
    const identity = createDriverSyncIdentity({
      createDeviceInstanceHash: async () => { createCount += 1; return 'e'.repeat(64); },
      storage: {
        getItemAsync: async () => null,
        setItemAsync: async () => {
          persistCount += 1;
          await new Promise<void>((resolve) => { releasePersistence = resolve; });
        },
      },
    });

    const first = identity.getDeviceInstanceHash();
    const second = identity.getDeviceInstanceHash();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(createCount, 1);
    assert.equal(persistCount, 1);
    releasePersistence?.();
    assert.deepEqual(await Promise.all([first, second]), ['e'.repeat(64), 'e'.repeat(64)]);
  });

  it('retries identity initialization after native storage rejects', async () => {
    let createCount = 0;
    let persistCount = 0;
    const identity = createDriverSyncIdentity({
      createDeviceInstanceHash: async () => { createCount += 1; return 'a'.repeat(64); },
      storage: {
        getItemAsync: async () => null,
        setItemAsync: async () => {
          persistCount += 1;
          if (persistCount === 1) throw new Error('native store unavailable');
        },
      },
    });

    await assert.rejects(identity.getDeviceInstanceHash(), /native store unavailable/u);
    assert.equal(await identity.getDeviceInstanceHash(), 'a'.repeat(64));
    assert.equal(createCount, 2);
    assert.equal(persistCount, 2);
  });

  it('does not advance a heartbeat session when diagnostics only reads the device hash', async () => {
    let stored: string | null = null;
    const identity = createDriverSyncIdentity({
      createDeviceInstanceHash: async () => 'f'.repeat(64),
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      storage: {
        getItemAsync: async () => stored,
        setItemAsync: async (_key, value) => { stored = value; },
      },
    });

    const first = await identity.next('owner:route:generation-1');
    await identity.getDeviceInstanceHash();
    const second = await identity.next('owner:route:generation-1');

    assert.equal(first.heartbeatSequence, 1);
    assert.equal(second.heartbeatSequence, 2);
    assert.equal(second.sessionGeneration, first.sessionGeneration);
  });
});
