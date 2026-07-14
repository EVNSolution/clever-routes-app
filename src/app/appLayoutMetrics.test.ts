import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  BOTTOM_NAV_MIN_HEIGHT,
  getBottomChromeOffset,
  getBottomChromePadding,
  getBottomTabPadding,
  getScrollContentBottomPadding,
} from './appLayoutMetrics';

describe('app layout metrics', () => {
  it('uses the real native bottom inset with a small fallback', () => {
    assert.equal(getBottomChromePadding(0), 8);
    assert.equal(getBottomChromePadding(47.2), 48);
    assert.equal(getBottomChromeOffset(47.2, 58), 106);
    assert.equal(getBottomTabPadding(), 8);
  });

  it('keeps scroll content clear of bottom tabs plus native system chrome', () => {
    assert.equal(BOTTOM_NAV_MIN_HEIGHT, 62);
    assert.equal(getScrollContentBottomPadding(48), 142);
  });

  it('keeps bottom tabs stable instead of following variant-specific safe area insets', () => {
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx'), 'utf8');

    assert.match(appSource, /useSafeAreaInsets\(\)/u);
    assert.match(appSource, /getBottomTabPadding\(\)/u);
  });
});
