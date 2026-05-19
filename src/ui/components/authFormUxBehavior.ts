export const CONSENT_CHECKMARK_SYMBOL = '✓';

export type KeyboardInputNavigationState<InputId extends string> = {
  activeIndex: number;
  canFocusNext: boolean;
  canFocusPrevious: boolean;
  nextInputId: InputId | null;
  positionLabel: string;
  previousInputId: InputId | null;
};

export function getKeyboardInputNavigationState<InputId extends string>(
  orderedInputIds: readonly InputId[],
  activeInputId: InputId | null,
): KeyboardInputNavigationState<InputId> {
  const activeIndex = activeInputId === null ? -1 : orderedInputIds.indexOf(activeInputId);
  const previousInputId = activeIndex > 0 ? orderedInputIds[activeIndex - 1] ?? null : null;
  const nextInputId = activeIndex >= 0 && activeIndex < orderedInputIds.length - 1
    ? orderedInputIds[activeIndex + 1] ?? null
    : null;

  return {
    activeIndex,
    canFocusNext: nextInputId !== null,
    canFocusPrevious: previousInputId !== null,
    nextInputId,
    positionLabel: activeIndex >= 0 ? `${activeIndex + 1} of ${orderedInputIds.length}` : `0 of ${orderedInputIds.length}`,
    previousInputId,
  };
}

export function getConsentCheckboxVisualState(checked: boolean): {
  accessibilityState: { checked: boolean };
  checkmark: typeof CONSENT_CHECKMARK_SYMBOL | null;
} {
  return {
    accessibilityState: { checked },
    checkmark: checked ? CONSENT_CHECKMARK_SYMBOL : null,
  };
}
