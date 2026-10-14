import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getBatterySettingsCopy } from './batteryGuidance';

describe('battery settings line', () => {
  it('names the setting that keeps tracking on, in Korean and English', () => {
    assert.match(getBatterySettingsCopy('ko-KR').description, /제한 없음/u);
    assert.equal(getBatterySettingsCopy('ko-KR').label, '배터리 설정이 필요합니다');
    assert.match(getBatterySettingsCopy('en-CA').description, /Unrestricted/u);
  });
});
