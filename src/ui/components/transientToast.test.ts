import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  scheduleTransientToastDismiss,
  TRANSIENT_TOAST_ANDROID_ELEVATION,
  TRANSIENT_TOAST_BOTTOM_GAP,
  TRANSIENT_TOAST_DISMISS_DELAY_MS,
  TRANSIENT_TOAST_Z_INDEX,
} from './transientToastBehavior';

const toastComponentPath = join(dirname(fileURLToPath(import.meta.url)), 'TransientToast.tsx');

describe('transient toast dismissal', () => {
  it('dismisses a visible toast after two seconds', () => {
    const scheduled: { callback: () => void; delayMs: number; timerId: string }[] = [];
    let dismissed = false;

    scheduleTransientToastDismiss({
      dismiss: () => {
        dismissed = true;
      },
      message: 'Route started.',
      scheduler: {
        clearTimeout: () => undefined,
        setTimeout: (callback, delayMs) => {
          scheduled.push({ callback, delayMs, timerId: 'toast-1' });
          return 'toast-1';
        },
      },
    });

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]?.delayMs, TRANSIENT_TOAST_DISMISS_DELAY_MS);
    assert.equal(TRANSIENT_TOAST_DISMISS_DELAY_MS, 2_000);
    assert.equal(dismissed, false);

    scheduled[0]?.callback();

    assert.equal(dismissed, true);
  });

  it('does not reserve a dismissal timer when no toast is visible', () => {
    let scheduled = false;

    const cleanup = scheduleTransientToastDismiss({
      dismiss: () => undefined,
      message: null,
      scheduler: {
        clearTimeout: () => undefined,
        setTimeout: () => {
          scheduled = true;
          return 'toast-1';
        },
      },
    });

    cleanup();

    assert.equal(scheduled, false);
  });

  it('cancels the active dismissal timer when a replacement toast appears', () => {
    const clearedTimers: string[] = [];

    const cleanup = scheduleTransientToastDismiss({
      dismiss: () => undefined,
      message: 'First toast.',
      scheduler: {
        clearTimeout: (timerId) => clearedTimers.push(timerId),
        setTimeout: () => 'toast-1',
      },
    });

    cleanup();

    assert.deepEqual(clearedTimers, ['toast-1']);
  });

  it('uses a safe-area anchored opaque global notification surface', () => {
    const source = readFileSync(toastComponentPath, 'utf8');

    assert.equal(TRANSIENT_TOAST_BOTTOM_GAP, 16);
    assert.equal(TRANSIENT_TOAST_ANDROID_ELEVATION, 12);
    assert.equal(TRANSIENT_TOAST_Z_INDEX, 10_000);
    assert.match(source, /const \{ bottom: bottomInset \} = useSafeAreaInsets\(\)/u);
    assert.match(source, /bottom: bottomInset \+ TRANSIENT_TOAST_BOTTOM_GAP/u);
    assert.match(source, /backgroundColor: '#111827'/u);
    assert.match(source, /color: '#ffffff'/u);
    assert.match(source, /fontSize: 14/u);
    assert.match(source, /fontWeight: '600'/u);
    assert.match(source, /textAlign: 'left'/u);
    assert.match(source, /borderRadius: 14/u);
    assert.doesNotMatch(source, /rgba\(|borderRadius: 999|textAlign: 'center'|top: topInset/u);
  });

});
