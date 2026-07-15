import type { DriverPhoneCountry } from '../../domain/phone/phoneEntry';

type DisplayNamesConstructor = new (
  locales: string[],
  options: { type: 'region' },
) => { of(code: string): string | undefined };

const DISPLAY_NAMES: DisplayNamesConstructor | undefined = (Intl as typeof Intl & { DisplayNames?: DisplayNamesConstructor }).DisplayNames;

export function getSelectedCountryCardText(
  country: DriverPhoneCountry,
  options: { locale?: string } = {},
): { callingCode: string; title: string } {
  return {
    callingCode: country.callingCode,
    title: getLocalizedCountryName(country, options.locale),
  };
}

export function getCountrySelectorRowText(
  country: DriverPhoneCountry,
  options: { locale?: string } = {},
): { subtitle: string; title: string } {
  return {
    title: `${getLocalizedCountryName(country, options.locale)} · ${country.callingCode}`,
    subtitle: `${country.iso2} · ${country.defaultLocale} · ${country.nativeLanguageName}`,
  };
}

function getLocalizedCountryName(country: DriverPhoneCountry, locale = 'en-CA'): string {
  if (DISPLAY_NAMES === undefined) {
    return country.displayName;
  }

  try {
    const localizedName = new DISPLAY_NAMES([locale], { type: 'region' }).of(country.iso2);

    return isUsefulLocalizedCountryName(localizedName, country) ? localizedName : country.displayName;
  } catch {
    return country.displayName;
  }
}

function isUsefulLocalizedCountryName(
  localizedName: string | undefined,
  country: DriverPhoneCountry,
): localizedName is string {
  return localizedName !== undefined && localizedName.trim().toUpperCase() !== country.iso2;
}
