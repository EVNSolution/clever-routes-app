import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBatteryGuidanceStore, getBatteryGuidanceCopy } from './batteryGuidance';

describe('battery guidance', () => {
  it('is shown once per device', async () => {
    let stored: string | null = null;
    const store = createBatteryGuidanceStore({
      getItem: async () => stored,
      setItem: async (_key, value) => { stored = value; },
    });
    assert.equal(await store.isShown(), false);
    await store.markShown();
    assert.equal(await store.isShown(), true);
  });

  it('tells the driver which setting keeps tracking on, in Korean and English', () => {
    assert.match(getBatteryGuidanceCopy('ko-KR').message, /제한 없음/u);
    assert.match(getBatteryGuidanceCopy('en-CA').message, /Unrestricted/u);
  });
});
