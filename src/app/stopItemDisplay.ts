export type StopItemNameParts = {
  primary: string;
  secondary: string | null;
};

export function splitStopItemName(value: string): StopItemNameParts {
  const normalized = value.trim();
  if (!/[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(normalized)) {
    return {
      primary: normalized,
      secondary: null,
    };
  }
  const englishBoundary = /\s+(?=[A-Za-z])/u.exec(normalized);
  if (englishBoundary === null || englishBoundary.index === 0) {
    return {
      primary: normalized,
      secondary: null,
    };
  }

  const primary = normalized.slice(0, englishBoundary.index).trim();
  const remainder = normalized.slice(englishBoundary.index).trim();
  const variantBoundary = remainder.indexOf(' - ');
  const secondary = (variantBoundary < 0 ? remainder : remainder.slice(0, variantBoundary)).trim();
  if (primary === '' || secondary === '') {
    return {
      primary: normalized,
      secondary: null,
    };
  }

  return {
    primary,
    secondary,
  };
}
