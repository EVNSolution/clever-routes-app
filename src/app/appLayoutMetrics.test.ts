import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANDROID_SYSTEM_BOTTOM_CLEARANCE,
  APP_CONTENT_BOTTOM_CLEARANCE,
  BOTTOM_NAV_MIN_HEIGHT,
} from './appLayoutMetrics';

describe('app layout metrics', () => {
  it('keeps scroll content clear of the bottom navigation on Android', () => {
    assert.equal(BOTTOM_NAV_MIN_HEIGHT, 62);
    assert.equal(ANDROID_SYSTEM_BOTTOM_CLEARANCE, 24);
    assert.ok(APP_CONTENT_BOTTOM_CLEARANCE > BOTTOM_NAV_MIN_HEIGHT + ANDROID_SYSTEM_BOTTOM_CLEARANCE);
  });
});
