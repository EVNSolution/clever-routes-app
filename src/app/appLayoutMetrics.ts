export const MIN_BOTTOM_CHROME_PADDING = 8;

export function getBottomChromePadding(bottomInset: number): number {
  return Math.max(MIN_BOTTOM_CHROME_PADDING, Math.ceil(bottomInset));
}

export function getBottomChromeOffset(bottomInset: number, offset: number): number {
  return getBottomChromePadding(bottomInset) + offset;
}
