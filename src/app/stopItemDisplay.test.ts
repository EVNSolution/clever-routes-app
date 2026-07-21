import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitStopItemName } from './stopItemDisplay';

describe('stop item bilingual display', () => {
  it('splits Korean and English menu names into separate display lines', () => {
    assert.deepEqual(splitStopItemName('닭가슴살 두부 스테이크 Chicken Breast Tofu Steak'), {
      primary: '닭가슴살 두부 스테이크',
      secondary: 'Chicken Breast Tofu Steak',
    });
  });

  it('removes the duplicated variant suffix from the English menu line', () => {
    assert.deepEqual(splitStopItemName('양념 돼지불고기 PORK BULGOGI - 야채팩 추가 ADD VEGETABLE PACK'), {
      primary: '양념 돼지불고기',
      secondary: 'PORK BULGOGI',
    });
  });

  it('keeps single-language menu names intact', () => {
    assert.deepEqual(splitStopItemName('Plain Item Name'), {
      primary: 'Plain Item Name',
      secondary: null,
    });
  });
});
