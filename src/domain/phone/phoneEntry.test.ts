import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_PHONE_COUNTRIES,
  formatDriverNationalPhoneInput,
  getDriverPhoneCountryLabel,
  normalizeDriverPhoneEntry,
  searchDriverPhoneCountries,
} from './phoneEntry';

describe('driver phone country entry', () => {
  it('ships a broad driver country catalog with visible localized dialing labels', () => {
    const requiredCountries = [
      'AE', 'AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'JP', 'KR',
      'MX', 'NL', 'NZ', 'PH', 'SA', 'SG', 'TH', 'US', 'VN', 'ZA',
    ];

    assert.ok(DRIVER_PHONE_COUNTRIES.length >= 60);

    assert.deepEqual(
      requiredCountries.filter((countryIso2) => DRIVER_PHONE_COUNTRIES.some((country) => country.iso2 === countryIso2)),
      requiredCountries,
    );

    assert.equal(getDriverPhoneCountryLabel(DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'KR')!, { locale: 'ko-KR' }), '대한민국 · KR · +82 · 한국어');
    assert.equal(getDriverPhoneCountryLabel(DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'CA')!, { locale: 'fr-CA' }), 'Canada · CA · +1 · anglais');
  });

  it('searches countries by name, localized/native name, ISO code, locale, language, and calling code', () => {
    assert.deepEqual(searchDriverPhoneCountries('south korea').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('kr').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('+82').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('ko-KR').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('한국어').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('대한민국').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('canada').map((country) => country.iso2), ['CA']);
  });

  it('carries language and culture metadata for localized driver UX', () => {
    const korea = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'KR')!;
    const emirates = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'AE')!;

    assert.equal(korea.defaultLocale, 'ko-KR');
    assert.equal(korea.nativeCountryName, '대한민국');
    assert.equal(korea.primaryLanguageCode, 'ko');
    assert.equal(korea.primaryLanguageName, 'Korean');
    assert.equal(korea.nativeLanguageName, '한국어');
    assert.equal(korea.textDirection, 'ltr');
    assert.equal(korea.measurementSystem, 'metric');
    assert.equal(korea.weekStartsOn, 'sunday');

    assert.equal(emirates.defaultLocale, 'ar-AE');
    assert.equal(emirates.primaryLanguageCode, 'ar');
    assert.equal(emirates.textDirection, 'rtl');
    assert.equal(emirates.weekStartsOn, 'monday');
  });

  it('formats Korean national input and normalizes it to E.164', () => {
    assert.equal(
      formatDriverNationalPhoneInput({ countryIso2: 'KR', nationalPhoneInput: '01089216198' }),
      '010-8921-6198',
    );

    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'KR', nationalPhoneInput: '01089216198' }),
      {
        ok: true,
        countryIso2: 'KR',
        displayNational: '010-8921-6198',
        phoneE164: '+821089216198',
      },
    );
  });

  it('formats Canadian national input and normalizes it to E.164', () => {
    assert.equal(
      formatDriverNationalPhoneInput({ countryIso2: 'CA', nationalPhoneInput: '4165550123' }),
      '(416) 555-0123',
    );

    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'CA', nationalPhoneInput: '4165550123' }),
      {
        ok: true,
        countryIso2: 'CA',
        displayNational: '(416) 555-0123',
        phoneE164: '+14165550123',
      },
    );
  });

  it('formats and normalizes representative national phone numbers across driver markets', () => {
    const examples = [
      { countryIso2: 'US', nationalPhoneInput: '2015550123', displayNational: '(201) 555-0123', phoneE164: '+12015550123' },
      { countryIso2: 'GB', nationalPhoneInput: '07400123456', displayNational: '07400 123456', phoneE164: '+447400123456' },
      { countryIso2: 'FR', nationalPhoneInput: '0612345678', displayNational: '06 12 34 56 78', phoneE164: '+33612345678' },
      { countryIso2: 'DE', nationalPhoneInput: '015123456789', displayNational: '01512 3456789', phoneE164: '+4915123456789' },
      { countryIso2: 'JP', nationalPhoneInput: '09012345678', displayNational: '090-1234-5678', phoneE164: '+819012345678' },
      { countryIso2: 'AU', nationalPhoneInput: '0412345678', displayNational: '0412 345 678', phoneE164: '+61412345678' },
      { countryIso2: 'BR', nationalPhoneInput: '11961234567', displayNational: '(11) 96123-4567', phoneE164: '+5511961234567' },
      { countryIso2: 'IN', nationalPhoneInput: '08123456789', displayNational: '081234 56789', phoneE164: '+918123456789' },
      { countryIso2: 'MX', nationalPhoneInput: '2221234567', displayNational: '222 123 4567', phoneE164: '+522221234567' },
      { countryIso2: 'PH', nationalPhoneInput: '09051234567', displayNational: '0905 123 4567', phoneE164: '+639051234567' },
      { countryIso2: 'VN', nationalPhoneInput: '0912345678', displayNational: '0912 345 678', phoneE164: '+84912345678' },
      { countryIso2: 'TH', nationalPhoneInput: '0812345678', displayNational: '081 234 5678', phoneE164: '+66812345678' },
      { countryIso2: 'SG', nationalPhoneInput: '81234567', displayNational: '8123 4567', phoneE164: '+6581234567' },
      { countryIso2: 'NZ', nationalPhoneInput: '0211234567', displayNational: '021 123 4567', phoneE164: '+64211234567' },
      { countryIso2: 'AE', nationalPhoneInput: '0501234567', displayNational: '050 123 4567', phoneE164: '+971501234567' },
      { countryIso2: 'SA', nationalPhoneInput: '0512345678', displayNational: '051 234 5678', phoneE164: '+966512345678' },
      { countryIso2: 'ZA', nationalPhoneInput: '0711234567', displayNational: '071 123 4567', phoneE164: '+27711234567' },
      { countryIso2: 'NL', nationalPhoneInput: '0612345678', displayNational: '06 12345678', phoneE164: '+31612345678' },
    ];

    for (const example of examples) {
      assert.equal(formatDriverNationalPhoneInput(example), example.displayNational);
      assert.deepEqual(normalizeDriverPhoneEntry(example), {
        ok: true,
        countryIso2: example.countryIso2,
        displayNational: example.displayNational,
        phoneE164: example.phoneE164,
      });
    }
  });

  it('rejects missing or invalid phone entries before route lookup', () => {
    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'KR', nationalPhoneInput: '' }),
      { ok: false, reason: 'phone_required' },
    );
    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'KR', nationalPhoneInput: '123' }),
      { ok: false, reason: 'phone_invalid' },
    );
    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'ZZ', nationalPhoneInput: '4165550123' }),
      { ok: false, reason: 'country_required' },
    );
  });

  it('rejects an international paste that does not match the selected country', () => {
    assert.deepEqual(
      normalizeDriverPhoneEntry({ countryIso2: 'CA', nationalPhoneInput: '+821089216198' }),
      { ok: false, reason: 'phone_invalid' },
    );
  });
});
