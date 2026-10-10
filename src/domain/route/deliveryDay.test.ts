import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDeliveryDateToday } from './deliveryDay';

describe('delivery day', () => {
  it('compares the delivery date with today in the route timezone', () => {
    // 02:30 UTC on the 11th is still the 10th in Toronto.
    const now = new Date('2026-10-11T02:30:00.000Z');
    assert.equal(isDeliveryDateToday('2026-10-10', 'America/Toronto', now), true);
    assert.equal(isDeliveryDateToday('2026-10-11', 'America/Toronto', now), false);
    assert.equal(isDeliveryDateToday('2026-10-11', 'Asia/Seoul', now), true);
  });

  it('rejects a malformed date or an unknown timezone instead of guessing', () => {
    const now = new Date('2026-10-11T02:30:00.000Z');
    assert.equal(isDeliveryDateToday('10/10/2026', 'America/Toronto', now), false);
    assert.equal(isDeliveryDateToday('2026-10-10', 'Mars/Olympus', now), false);
  });
});
