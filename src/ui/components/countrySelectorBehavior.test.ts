import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRIVER_PHONE_COUNTRIES } from '../../domain/phone/phoneEntry';
import {
  COUNTRY_SELECTOR_OVERLAY_BEHAVIOR,
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

  it('keeps searchable row metadata in the overlay list rather than the selected card', () => {
    const korea = DRIVER_PHONE_COUNTRIES.find((country) => country.iso2 === 'KR')!;

    assert.deepEqual(getCountrySelectorRowText(korea, { locale: 'ko-KR' }), {
      title: '대한민국 · +82',
      subtitle: 'KR · ko-KR · 한국어',
    });
  });

  it('defines the opened list as a layered overlay that does not reserve layout height', () => {
    assert.deepEqual(COUNTRY_SELECTOR_OVERLAY_BEHAVIOR, {
      elevation: 24,
      maxVisibleRows: 6,
      position: 'absolute',
      zIndex: 1000,
    });
  });
});
