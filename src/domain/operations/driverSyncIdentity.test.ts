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
});
