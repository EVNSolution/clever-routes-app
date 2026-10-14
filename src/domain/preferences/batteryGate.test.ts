import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getBatteryGateCopy, shouldBlockStartForBattery } from './batteryGate';

describe('battery gate before Start', () => {
  it('blocks Start only on Android while battery optimization is enabled', () => {
    assert.equal(shouldBlockStartForBattery({ optimizationEnabled: true, platform: 'android' }), true);
    assert.equal(shouldBlockStartForBattery({ optimizationEnabled: false, platform: 'android' }), false);
  });

  it('never blocks when the state is unknown or the platform is not Android', () => {
    assert.equal(shouldBlockStartForBattery({ optimizationEnabled: null, platform: 'android' }), false);
    assert.equal(shouldBlockStartForBattery({ optimizationEnabled: true, platform: 'ios' }), false);
  });

  it('tells the driver what to set, in Korean and English', () => {
    assert.match(getBatteryGateCopy('ko-KR').message, /제한 없음/u);
    assert.match(getBatteryGateCopy('en-CA').message, /Unrestricted/u);
  });
});
