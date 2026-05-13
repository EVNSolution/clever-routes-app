import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

export type DriverPhoneCountryIso2 = 'CA' | 'KR';

export type DriverPhoneCountry = {
  callingCode: `+${string}`;
  displayName: string;
  iso2: DriverPhoneCountryIso2;
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

export const DRIVER_PHONE_COUNTRIES: DriverPhoneCountry[] = [
  { callingCode: '+1', displayName: 'Canada', iso2: 'CA' },
  { callingCode: '+82', displayName: 'South Korea', iso2: 'KR' },
];

export const DEFAULT_DRIVER_PHONE_COUNTRY = DRIVER_PHONE_COUNTRIES[0];

export function getDriverPhoneCountryLabel(country: DriverPhoneCountry): string {
  return `${country.displayName} · ${country.iso2} · ${country.callingCode}`;
}

export function findDriverPhoneCountry(countryIso2: string): DriverPhoneCountry | null {
  const normalizedIso = countryIso2.trim().toUpperCase();
  return DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === normalizedIso) ?? null;
}

export function searchDriverPhoneCountries(query: string): DriverPhoneCountry[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return DRIVER_PHONE_COUNTRIES;
  }

  return DRIVER_PHONE_COUNTRIES.filter((country) => {
    const searchableText = [
      country.displayName,
      country.iso2,
      country.callingCode,
      country.callingCode.replace('+', ''),
    ].join(' ').toLowerCase();

    return searchableText.includes(normalizedQuery.replace(/^\+/u, '')) || searchableText.includes(normalizedQuery);
  });
}

export function formatDriverNationalPhoneInput(input: DriverPhoneEntryInput): string {
  const country = findDriverPhoneCountry(input.countryIso2);
  const rawInput = input.nationalPhoneInput.trim();

  if (country === null || rawInput.length === 0) {
    return rawInput;
  }

  return new AsYouType(country.iso2 as CountryCode, metadata).input(rawInput);
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

  const phoneNumber = parsePhoneNumberFromString(nationalPhoneInput, country.iso2 as CountryCode, metadata);

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
