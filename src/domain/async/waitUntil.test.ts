import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { waitUntil } from './waitUntil';

describe('waitUntil', () => {
  it('returns true as soon as the check passes', async () => {
    let calls = 0;
    const result = await waitUntil(async () => ++calls >= 3, { pollMs: 1, timeoutMs: 1000 });
    assert.equal(result, true);
    assert.equal(calls, 3);
  });

  it('returns false when the check never passes within the time limit', async () => {
    const result = await waitUntil(async () => false, { pollMs: 5, timeoutMs: 30 });
    assert.equal(result, false);
  });

  it('treats a throwing check as not yet passed', async () => {
    let calls = 0;
    const result = await waitUntil(async () => {
      calls += 1;
      if (calls < 2) throw new Error('storage busy');
      return true;
    }, { pollMs: 1, timeoutMs: 1000 });
    assert.equal(result, true);
  });
});
