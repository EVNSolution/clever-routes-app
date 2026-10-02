import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  getBottomChromeOffset,
  getBottomChromePadding,
} from './appLayoutMetrics';

describe('app layout metrics', () => {
  it('uses the real native bottom inset with a small fallback', () => {
    assert.equal(getBottomChromePadding(0), 8);
    assert.equal(getBottomChromePadding(47.2), 48);
    assert.equal(getBottomChromeOffset(47.2, 58), 106);
  });

  it('uses native insets only where full-screen chrome needs them', () => {
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx'), 'utf8');

    assert.match(appSource, /useSafeAreaInsets\(\)/u);
    assert.doesNotMatch(appSource, /BottomNavigation|getBottomTabPadding|getScrollContentBottomPadding/u);
  });
});
