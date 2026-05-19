import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_CHECKMARK_SYMBOL,
  getConsentCheckboxVisualState,
  getKeyboardInputNavigationState,
} from './authFormUxBehavior';

describe('auth form UX helpers', () => {
  it('finds the previous and next text box around the focused field', () => {
    const state = getKeyboardInputNavigationState(['verificationCode', 'firstName', 'lastName'], 'firstName');

    assert.deepEqual(state, {
      activeIndex: 1,
      canFocusNext: true,
      canFocusPrevious: true,
      nextInputId: 'lastName',
      positionLabel: '2 of 3',
      previousInputId: 'verificationCode',
    });
  });

  it('does not offer movement past the first or last text box', () => {
    const first = getKeyboardInputNavigationState(['verificationCode', 'firstName', 'lastName'], 'verificationCode');
    const last = getKeyboardInputNavigationState(['verificationCode', 'firstName', 'lastName'], 'lastName');

    assert.equal(first.previousInputId, null);
    assert.equal(first.canFocusPrevious, false);
    assert.equal(first.nextInputId, 'firstName');
    assert.equal(last.previousInputId, 'firstName');
    assert.equal(last.nextInputId, null);
    assert.equal(last.canFocusNext, false);
  });

  it('shows a visible checkmark only when a consent checkbox is checked', () => {
    assert.equal(CONSENT_CHECKMARK_SYMBOL, '✓');
    assert.deepEqual(getConsentCheckboxVisualState(true), {
      accessibilityState: { checked: true },
      checkmark: '✓',
    });
    assert.deepEqual(getConsentCheckboxVisualState(false), {
      accessibilityState: { checked: false },
      checkmark: null,
    });
  });
});
