import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_CHECKMARK_SYMBOL,
  getConsentCheckboxVisualState,
  getKeyboardNavigationAccessoryControls,
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

  it('uses icon identifiers for keyboard movement controls without text arrow glyphs or position chrome', () => {
    const navigationState = getKeyboardInputNavigationState(['verificationCode', 'firstName', 'lastName'], 'firstName');
    const controls = getKeyboardNavigationAccessoryControls(navigationState);
    const serializedControls = JSON.stringify(controls);

    assert.deepEqual(controls, {
      done: {
        accessibilityLabel: 'Done entering text',
        disabled: false,
        label: '완료',
      },
      next: {
        accessibilityLabel: 'Next text box',
        disabled: false,
        icon: 'keyboard_arrow_down',
      },
      previous: {
        accessibilityLabel: 'Previous text box',
        disabled: false,
        icon: 'keyboard_arrow_up',
      },
    });
    assert.equal(serializedControls.includes('2 of 3'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(controls.previous, 'label'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(controls.next, 'label'), false);
    assert.equal(serializedControls.includes('^'), false);
    assert.equal(serializedControls.includes('⌃'), false);
    assert.equal(serializedControls.includes('⌄'), false);
    assert.equal(serializedControls.includes('˄'), false);
    assert.equal(serializedControls.includes('˅'), false);
    assert.equal(serializedControls.includes('['), false);
    assert.equal(serializedControls.includes(']'), false);
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
