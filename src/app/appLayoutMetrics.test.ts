import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ANDROID_SYSTEM_BOTTOM_CLEARANCE,
  APP_OWNED_BOTTOM_CHROME_ANDROID_CLEARANCE,
  APP_CONTENT_BOTTOM_CLEARANCE,
  BOTTOM_NAV_MIN_HEIGHT,
} from './appLayoutMetrics';

describe('app layout metrics', () => {
  it('keeps scroll content clear of the bottom navigation on Android', () => {
    assert.equal(BOTTOM_NAV_MIN_HEIGHT, 62);
    assert.equal(ANDROID_SYSTEM_BOTTOM_CLEARANCE, 24);
    assert.equal(APP_OWNED_BOTTOM_CHROME_ANDROID_CLEARANCE, 56);
    assert.ok(APP_CONTENT_BOTTOM_CLEARANCE > BOTTOM_NAV_MIN_HEIGHT + ANDROID_SYSTEM_BOTTOM_CLEARANCE);
  });

  it('keeps app-owned bottom sheets above the Android system navigation area', () => {
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx'), 'utf8');

    assert.match(appSource, /photoActionSheetCard:[\s\S]*paddingBottom: Platform\.OS === 'android' \? APP_OWNED_BOTTOM_CHROME_ANDROID_CLEARANCE \+ 16 : 16/u);
  });
});
