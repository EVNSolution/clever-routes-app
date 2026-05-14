import {
  AsYouType,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

export type DriverPhoneCountryIso2 = CountryCode;

export type DriverTextDirection = 'ltr' | 'rtl';
export type DriverMeasurementSystem = 'metric' | 'mixed' | 'us';
export type DriverWeekStartDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type DriverPhoneCountry = {
  callingCode: `+${string}`;
  defaultLocale: string;
  displayName: string;
  iso2: DriverPhoneCountryIso2;
  measurementSystem: DriverMeasurementSystem;
  nativeCountryName: string;
  nativeLanguageName: string;
  primaryLanguageCode: string;
  primaryLanguageName: string;
  textDirection: DriverTextDirection;
  weekStartsOn: DriverWeekStartDay;
};

export type DriverPhoneEntryInput = {
  countryIso2: string;
  nationalPhoneInput: string;
};

export type DriverPhoneEntryNormalizationResult =
  | {
      countryIso2: DriverPhoneCountryIso2;
      displayNational: string;
      ok: true;
      phoneE164: string;
    }
  | {
      ok: false;
      reason: 'country_required' | 'phone_required' | 'phone_invalid';
    };

type DisplayNamesConstructor = new (
  locales: string[],
  options: { type: 'language' | 'region' },
) => { of(code: string): string | undefined };

type IntlLocaleWithWeekInfo = {
  weekInfo?: {
    firstDay?: number;
  };
};

type IntlLocaleConstructor = new (locale: string) => IntlLocaleWithWeekInfo;

type DriverPhoneCountrySeed = {
  defaultLocale: string;
  iso2: DriverPhoneCountryIso2;
  measurementSystem?: DriverMeasurementSystem;
  primaryLanguageCode: string;
};

const DISPLAY_NAMES: DisplayNamesConstructor | undefined = (Intl as typeof Intl & { DisplayNames?: DisplayNamesConstructor }).DisplayNames;
const LOCALE: IntlLocaleConstructor | undefined = (Intl as typeof Intl & { Locale?: IntlLocaleConstructor }).Locale;

const RIGHT_TO_LEFT_LANGUAGE_CODES = new Set(['ar', 'fa', 'he', 'ur']);

const WEEK_START_BY_FIRST_DAY: Record<number, DriverWeekStartDay> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

const FALLBACK_REGION_NAMES: Partial<Record<DriverPhoneCountryIso2, string>> = {
  AE: 'United Arab Emirates',
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BH: 'Bahrain',
  BO: 'Bolivia',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CL: 'Chile',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  DO: 'Dominican Republic',
  EC: 'Ecuador',
  EG: 'Egypt',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GH: 'Ghana',
  GR: 'Greece',
  HK: 'Hong Kong',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IT: 'Italy',
  JM: 'Jamaica',
  JP: 'Japan',
  KE: 'Kenya',
  KH: 'Cambodia',
  KR: 'South Korea',
  KW: 'Kuwait',
  LA: 'Laos',
  LK: 'Sri Lanka',
  MA: 'Morocco',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MX: 'Mexico',
  MY: 'Malaysia',
  NG: 'Nigeria',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NZ: 'New Zealand',
  OM: 'Oman',
  PA: 'Panama',
  PE: 'Peru',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PT: 'Portugal',
  PY: 'Paraguay',
  QA: 'Qatar',
  RO: 'Romania',
  SA: 'Saudi Arabia',
  SE: 'Sweden',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Turkey',
  TW: 'Taiwan',
  US: 'United States',
  UY: 'Uruguay',
  VN: 'Vietnam',
  ZA: 'South Africa',
};

const FALLBACK_LANGUAGE_NAMES: Partial<Record<string, string>> = {
  am: 'Amharic',
  ar: 'Arabic',
  bn: 'Bengali',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  km: 'Khmer',
  ko: 'Korean',
  lo: 'Lao',
  mn: 'Mongolian',
  ms: 'Malay',
  my: 'Burmese',
  nb: 'Norwegian Bokmål',
  ne: 'Nepali',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  si: 'Sinhala',
  sv: 'Swedish',
  sw: 'Swahili',
  th: 'Thai',
  tr: 'Turkish',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

const DRIVER_PHONE_COUNTRY_SEEDS: DriverPhoneCountrySeed[] = [
  { iso2: 'CA', defaultLocale: 'en-CA', primaryLanguageCode: 'en', measurementSystem: 'mixed' },
  { iso2: 'KR', defaultLocale: 'ko-KR', primaryLanguageCode: 'ko' },
  { iso2: 'US', defaultLocale: 'en-US', primaryLanguageCode: 'en', measurementSystem: 'us' },
  { iso2: 'GB', defaultLocale: 'en-GB', primaryLanguageCode: 'en', measurementSystem: 'mixed' },
  { iso2: 'FR', defaultLocale: 'fr-FR', primaryLanguageCode: 'fr' },
  { iso2: 'DE', defaultLocale: 'de-DE', primaryLanguageCode: 'de' },
  { iso2: 'JP', defaultLocale: 'ja-JP', primaryLanguageCode: 'ja' },
  { iso2: 'AU', defaultLocale: 'en-AU', primaryLanguageCode: 'en', measurementSystem: 'mixed' },
  { iso2: 'BR', defaultLocale: 'pt-BR', primaryLanguageCode: 'pt' },
  { iso2: 'IN', defaultLocale: 'hi-IN', primaryLanguageCode: 'hi' },
  { iso2: 'MX', defaultLocale: 'es-MX', primaryLanguageCode: 'es' },
  { iso2: 'PH', defaultLocale: 'fil-PH', primaryLanguageCode: 'fil' },
  { iso2: 'VN', defaultLocale: 'vi-VN', primaryLanguageCode: 'vi' },
  { iso2: 'TH', defaultLocale: 'th-TH', primaryLanguageCode: 'th' },
  { iso2: 'SG', defaultLocale: 'en-SG', primaryLanguageCode: 'en' },
  { iso2: 'NZ', defaultLocale: 'en-NZ', primaryLanguageCode: 'en', measurementSystem: 'mixed' },
  { iso2: 'AE', defaultLocale: 'ar-AE', primaryLanguageCode: 'ar' },
  { iso2: 'SA', defaultLocale: 'ar-SA', primaryLanguageCode: 'ar' },
  { iso2: 'ZA', defaultLocale: 'en-ZA', primaryLanguageCode: 'en' },
  { iso2: 'NL', defaultLocale: 'nl-NL', primaryLanguageCode: 'nl' },
  { iso2: 'CN', defaultLocale: 'zh-CN', primaryLanguageCode: 'zh' },
  { iso2: 'TW', defaultLocale: 'zh-TW', primaryLanguageCode: 'zh' },
  { iso2: 'HK', defaultLocale: 'zh-HK', primaryLanguageCode: 'zh' },
  { iso2: 'ID', defaultLocale: 'id-ID', primaryLanguageCode: 'id' },
  { iso2: 'MY', defaultLocale: 'ms-MY', primaryLanguageCode: 'ms' },
  { iso2: 'ES', defaultLocale: 'es-ES', primaryLanguageCode: 'es' },
  { iso2: 'IT', defaultLocale: 'it-IT', primaryLanguageCode: 'it' },
  { iso2: 'PT', defaultLocale: 'pt-PT', primaryLanguageCode: 'pt' },
  { iso2: 'IE', defaultLocale: 'en-IE', primaryLanguageCode: 'en' },
  { iso2: 'BE', defaultLocale: 'nl-BE', primaryLanguageCode: 'nl' },
  { iso2: 'CH', defaultLocale: 'de-CH', primaryLanguageCode: 'de' },
  { iso2: 'AT', defaultLocale: 'de-AT', primaryLanguageCode: 'de' },
  { iso2: 'SE', defaultLocale: 'sv-SE', primaryLanguageCode: 'sv' },
  { iso2: 'NO', defaultLocale: 'nb-NO', primaryLanguageCode: 'nb' },
  { iso2: 'DK', defaultLocale: 'da-DK', primaryLanguageCode: 'da' },
  { iso2: 'FI', defaultLocale: 'fi-FI', primaryLanguageCode: 'fi' },
  { iso2: 'PL', defaultLocale: 'pl-PL', primaryLanguageCode: 'pl' },
  { iso2: 'CZ', defaultLocale: 'cs-CZ', primaryLanguageCode: 'cs' },
  { iso2: 'HU', defaultLocale: 'hu-HU', primaryLanguageCode: 'hu' },
  { iso2: 'RO', defaultLocale: 'ro-RO', primaryLanguageCode: 'ro' },
  { iso2: 'GR', defaultLocale: 'el-GR', primaryLanguageCode: 'el' },
  { iso2: 'TR', defaultLocale: 'tr-TR', primaryLanguageCode: 'tr' },
  { iso2: 'IL', defaultLocale: 'he-IL', primaryLanguageCode: 'he' },
  { iso2: 'QA', defaultLocale: 'ar-QA', primaryLanguageCode: 'ar' },
  { iso2: 'KW', defaultLocale: 'ar-KW', primaryLanguageCode: 'ar' },
  { iso2: 'BH', defaultLocale: 'ar-BH', primaryLanguageCode: 'ar' },
  { iso2: 'OM', defaultLocale: 'ar-OM', primaryLanguageCode: 'ar' },
  { iso2: 'EG', defaultLocale: 'ar-EG', primaryLanguageCode: 'ar' },
  { iso2: 'MA', defaultLocale: 'ar-MA', primaryLanguageCode: 'ar' },
  { iso2: 'KE', defaultLocale: 'sw-KE', primaryLanguageCode: 'sw' },
  { iso2: 'NG', defaultLocale: 'en-NG', primaryLanguageCode: 'en' },
  { iso2: 'GH', defaultLocale: 'en-GH', primaryLanguageCode: 'en' },
  { iso2: 'ET', defaultLocale: 'am-ET', primaryLanguageCode: 'am' },
  { iso2: 'AR', defaultLocale: 'es-AR', primaryLanguageCode: 'es' },
  { iso2: 'CL', defaultLocale: 'es-CL', primaryLanguageCode: 'es' },
  { iso2: 'CO', defaultLocale: 'es-CO', primaryLanguageCode: 'es' },
  { iso2: 'PE', defaultLocale: 'es-PE', primaryLanguageCode: 'es' },
  { iso2: 'EC', defaultLocale: 'es-EC', primaryLanguageCode: 'es' },
  { iso2: 'CR', defaultLocale: 'es-CR', primaryLanguageCode: 'es' },
  { iso2: 'PA', defaultLocale: 'es-PA', primaryLanguageCode: 'es' },
  { iso2: 'DO', defaultLocale: 'es-DO', primaryLanguageCode: 'es' },
  { iso2: 'JM', defaultLocale: 'en-JM', primaryLanguageCode: 'en' },
  { iso2: 'UY', defaultLocale: 'es-UY', primaryLanguageCode: 'es' },
  { iso2: 'PY', defaultLocale: 'es-PY', primaryLanguageCode: 'es' },
  { iso2: 'BO', defaultLocale: 'es-BO', primaryLanguageCode: 'es' },
  { iso2: 'PK', defaultLocale: 'ur-PK', primaryLanguageCode: 'ur' },
  { iso2: 'BD', defaultLocale: 'bn-BD', primaryLanguageCode: 'bn' },
  { iso2: 'LK', defaultLocale: 'si-LK', primaryLanguageCode: 'si' },
  { iso2: 'NP', defaultLocale: 'ne-NP', primaryLanguageCode: 'ne' },
  { iso2: 'KH', defaultLocale: 'km-KH', primaryLanguageCode: 'km' },
  { iso2: 'LA', defaultLocale: 'lo-LA', primaryLanguageCode: 'lo' },
  { iso2: 'MM', defaultLocale: 'my-MM', primaryLanguageCode: 'my' },
  { iso2: 'MN', defaultLocale: 'mn-MN', primaryLanguageCode: 'mn' },
];

export const DRIVER_PHONE_COUNTRIES: DriverPhoneCountry[] = DRIVER_PHONE_COUNTRY_SEEDS.map((seed) => {
  const displayName = getDisplayName({ code: seed.iso2, locale: 'en-CA', type: 'region' });
  const nativeCountryName = getDisplayName({ code: seed.iso2, locale: seed.defaultLocale, type: 'region' });
  const primaryLanguageName = getDisplayName({ code: seed.primaryLanguageCode, locale: 'en-CA', type: 'language' });
  const nativeLanguageName = getDisplayName({ code: seed.primaryLanguageCode, locale: seed.defaultLocale, type: 'language' });

  return {
    ...seed,
    callingCode: `+${getCountryCallingCode(seed.iso2, metadata)}`,
    displayName,
    measurementSystem: seed.measurementSystem ?? 'metric',
    nativeCountryName,
    nativeLanguageName,
    primaryLanguageName,
    textDirection: RIGHT_TO_LEFT_LANGUAGE_CODES.has(seed.primaryLanguageCode) ? 'rtl' : 'ltr',
    weekStartsOn: getWeekStartsOn(seed.defaultLocale),
  };
});

export const DEFAULT_DRIVER_PHONE_COUNTRY = DRIVER_PHONE_COUNTRIES[0];

export function getDriverPhoneCountryLabel(
  country: DriverPhoneCountry,
  options: { locale?: string } = {},
): string {
  const locale = options.locale ?? 'en-CA';
  const countryName = getDisplayName({ code: country.iso2, locale, type: 'region' });
  const languageName = getDisplayName({ code: country.primaryLanguageCode, locale, type: 'language' });

  return `${countryName} · ${country.iso2} · ${country.callingCode} · ${languageName}`;
}

export function findDriverPhoneCountry(countryIso2: string): DriverPhoneCountry | null {
  const normalizedIso = countryIso2.trim().toUpperCase();
  return DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === normalizedIso) ?? null;
}

export function searchDriverPhoneCountries(query: string): DriverPhoneCountry[] {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length === 0) {
    return DRIVER_PHONE_COUNTRIES;
  }

  const queryWithoutPlus = normalizeSearchText(query.replace(/^\+/u, ''));

  return DRIVER_PHONE_COUNTRIES.filter((country) => {
    const searchableText = normalizeSearchText([
      country.displayName,
      country.nativeCountryName,
      country.iso2,
      country.callingCode,
      country.callingCode.replace('+', ''),
      country.defaultLocale,
      country.primaryLanguageCode,
      country.primaryLanguageName,
      country.nativeLanguageName,
      getDriverPhoneCountryLabel(country, { locale: country.defaultLocale }),
      getDriverPhoneCountryLabel(country, { locale: 'en-CA' }),
    ].join(' '));

    return searchableText.includes(normalizedQuery) || searchableText.includes(queryWithoutPlus);
  });
}

export function formatDriverNationalPhoneInput(input: DriverPhoneEntryInput): string {
  const country = findDriverPhoneCountry(input.countryIso2);
  const rawInput = input.nationalPhoneInput.trim();

  if (country === null || rawInput.length === 0) {
    return rawInput;
  }

  return new AsYouType(country.iso2, metadata).input(rawInput);
}

export function normalizeDriverPhoneEntry(input: DriverPhoneEntryInput): DriverPhoneEntryNormalizationResult {
  const country = findDriverPhoneCountry(input.countryIso2);

  if (country === null) {
    return { ok: false, reason: 'country_required' };
  }

  const nationalPhoneInput = input.nationalPhoneInput.trim();

  if (nationalPhoneInput.length === 0) {
    return { ok: false, reason: 'phone_required' };
  }

  const phoneNumber = parsePhoneNumberFromString(nationalPhoneInput, country.iso2, metadata);

  if (phoneNumber === undefined || !phoneNumber.isValid() || phoneNumber.country !== country.iso2) {
    return { ok: false, reason: 'phone_invalid' };
  }

  return {
    ok: true,
    countryIso2: country.iso2,
    displayNational: phoneNumber.formatNational(),
    phoneE164: phoneNumber.number,
  };
}

function getDisplayName({
  code,
  locale,
  type,
}: {
  code: string;
  locale: string;
  type: 'language' | 'region';
}): string {
  try {
    if (DISPLAY_NAMES !== undefined) {
      const displayName = new DISPLAY_NAMES([locale], { type }).of(code);

      if (isUsefulDisplayName(displayName, code)) {
        return displayName;
      }
    }
  } catch {
    // Fall through to deterministic fallback names below.
  }

  return getFallbackDisplayName({ code, type });
}

function isUsefulDisplayName(displayName: string | undefined, code: string): displayName is string {
  return displayName !== undefined && displayName.trim().toLowerCase() !== code.toLowerCase();
}

function getFallbackDisplayName({
  code,
  type,
}: {
  code: string;
  type: 'language' | 'region';
}): string {
  if (type === 'region') {
    return FALLBACK_REGION_NAMES[code as DriverPhoneCountryIso2] ?? code;
  }

  return FALLBACK_LANGUAGE_NAMES[code] ?? code;
}

function getWeekStartsOn(locale: string): DriverWeekStartDay {
  if (LOCALE === undefined) {
    return 'monday';
  }

  try {
    const firstDay = new LOCALE(locale).weekInfo?.firstDay;

    if (typeof firstDay === 'number') {
      return WEEK_START_BY_FIRST_DAY[firstDay] ?? 'monday';
    }
  } catch {
    return 'monday';
  }

  return 'monday';
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}
