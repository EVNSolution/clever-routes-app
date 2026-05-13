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
  it('starts with a Canada and South Korea allowlist with visible dialing labels', () => {
    assert.deepEqual(
      DRIVER_PHONE_COUNTRIES.map((country) => getDriverPhoneCountryLabel(country)),
      ['Canada · CA · +1', 'South Korea · KR · +82'],
    );
  });

  it('searches countries by name, ISO code, and calling code', () => {
    assert.deepEqual(searchDriverPhoneCountries('south').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('kr').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('+82').map((country) => country.iso2), ['KR']);
    assert.deepEqual(searchDriverPhoneCountries('can').map((country) => country.iso2), ['CA']);
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
      normalizeDriverPhoneEntry({ countryIso2: 'US', nationalPhoneInput: '4165550123' }),
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
