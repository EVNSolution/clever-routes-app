export const BOTTOM_NAV_MIN_HEIGHT = 62;
export const BOTTOM_TAB_PADDING = 8;
export const MIN_BOTTOM_CHROME_PADDING = 8;
export const APP_CONTENT_BOTTOM_MARGIN = 24;

export function getBottomChromePadding(bottomInset: number): number {
  return Math.max(MIN_BOTTOM_CHROME_PADDING, Math.ceil(bottomInset));
}

export function getBottomChromeOffset(bottomInset: number, offset: number): number {
  return getBottomChromePadding(bottomInset) + offset;
}

export function getBottomTabPadding(): number {
  return BOTTOM_TAB_PADDING;
}

export function getScrollContentBottomPadding(bottomInset: number): number {
  return BOTTOM_NAV_MIN_HEIGHT + getBottomTabPadding() + APP_CONTENT_BOTTOM_MARGIN + Math.ceil(bottomInset);
}
