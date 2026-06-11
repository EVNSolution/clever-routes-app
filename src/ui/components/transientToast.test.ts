import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scheduleTransientToastDismiss,
  TRANSIENT_TOAST_ANDROID_ELEVATION,
  TRANSIENT_TOAST_ANDROID_TOP_OFFSET,
  TRANSIENT_TOAST_BORDER_ALPHA,
  TRANSIENT_TOAST_DISMISS_DELAY_MS,
  TRANSIENT_TOAST_SURFACE_ALPHA,
  TRANSIENT_TOAST_Z_INDEX,
} from './transientToastBehavior';

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

  it('uses an Android-safe lower offset and a softer transparent surface', () => {
    assert.equal(TRANSIENT_TOAST_ANDROID_TOP_OFFSET, 54);
    assert.equal(TRANSIENT_TOAST_ANDROID_ELEVATION, 24);
    assert.equal(TRANSIENT_TOAST_Z_INDEX, 10_000);
    assert.equal(TRANSIENT_TOAST_SURFACE_ALPHA, 0.58);
    assert.equal(TRANSIENT_TOAST_BORDER_ALPHA, 0.42);
  });

});
