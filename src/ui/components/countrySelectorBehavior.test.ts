import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRIVER_PHONE_COUNTRIES } from '../../domain/phone/phoneEntry';
import {
  getCountrySelectorRowText,
  getSelectedCountryCardText,
} from './countrySelectorBehavior';

describe('country selector UI behavior', () => {
  it('keeps the selected card compact with only country name and calling code', () => {
    const korea = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'KR')!;
    const canada = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'CA')!;

    assert.deepEqual(getSelectedCountryCardText(korea, { locale: 'ko-KR' }), {
      title: '대한민국',
      callingCode: '+82',
    });
    assert.deepEqual(getSelectedCountryCardText(canada, { locale: 'en-CA' }), {
      title: 'Canada',
      callingCode: '+1',
    });
  });

  it('keeps searchable row metadata in the selection list rather than the selected card', () => {
    const korea = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'KR')!;

    assert.deepEqual(getCountrySelectorRowText(korea, { locale: 'ko-KR' }), {
      title: '대한민국 · +82',
      subtitle: 'KR · ko-KR · 한국어',
    });
  });
});
