import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  matchesStopCompletionEvent,
  normalizeCashAmount,
  readStopCompletion,
  readStopCompletionInput,
  readStopPayment,
} from './stopCompletion';

const payment = {
  method: 'CASH', methodTitle: 'Cash', gatewayNames: ['Cash'], financialStatus: 'PENDING',
  expectedAmount: '122.25', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING',
  requiresCashInput: true,
};
const completion = {
  id: 'receipt-1', eventId: 'event-1', deliveryStopId: 'stop-1', routePlanId: 'route-1', driverId: 'driver-1',
  assignmentGeneration: '2', expectedRouteVersionId: 'version-1', method: 'CASH', payment,
  expectedAmount: '122.25', actualAmount: '122.00', differenceAmount: '-0.25', currencyCode: 'CAD',
  occurredAt: '2026-10-08T07:00:00.000Z', recordedAt: '2026-10-08T07:00:02.000Z',
};

describe('single stop completion contract', () => {
  it('normalizes exact Cash decimal strings and distinguishes zero from missing input', () => {
    for (const [raw, expected] of [
      ['122', '122.00'], ['122.0', '122.00'], ['122.25', '122.25'], ['123', '123.00'],
      ['0', '0.00'], ['0.01', '0.01'], ['9999999999999999.99', '9999999999999999.99'],
    ]) assert.equal(normalizeCashAmount(raw), expected);
    for (const raw of ['', ' ', ' 122', '122 ', '01', '00.00', '-1', '-0', '+1', '1e2', '.25', '1.',
      '1.234', '10000000000000000', 122, 0, null, undefined, NaN]) {
      assert.equal(normalizeCashAmount(raw), null, String(raw));
    }
  });

  it('accepts only the version and actual Cash fields and never manufactures zero', () => {
    assert.deepEqual(readStopCompletionInput({ version: 1 }), { version: 1 });
    assert.deepEqual(readStopCompletionInput({ version: 1, cashReceived: { amount: '0', currency: 'CAD' } }), {
      version: 1, cashReceived: { amount: '0.00', currency: 'CAD' },
    });
    for (const value of [null, {}, { version: 2 }, { version: 1, expectedAmount: '122.25' },
      { version: 1, cashReceived: null }, { version: 1, cashReceived: { amount: 122, currency: 'CAD' } },
      { version: 1, cashReceived: { amount: '122', currency: 'cad' } },
      { version: 1, cashReceived: { amount: '122', currency: 'CAD', differenceAmount: '-0.25' } }]) {
      assert.equal(readStopCompletionInput(value), null);
    }
  });

  it('keeps server payment classification, unknown balances, and unknown currency unchanged', () => {
    assert.deepEqual(readStopPayment(payment), payment);
    const unknown = { ...payment, method: 'UNKNOWN', methodTitle: 'Unlisted method',
      expectedAmount: null, currencyCode: null, expectedAmountSource: 'UNKNOWN', requiresCashInput: false };
    assert.deepEqual(readStopPayment(unknown), unknown);
    assert.equal(readStopPayment({ ...payment, expectedAmount: 122.25 }), null);
    assert.equal(readStopPayment({ ...payment, requiresCashInput: 'true' }), null);
    assert.equal(readStopPayment({ ...payment, method: 'CREDIT' }), null);
    assert.equal(readStopPayment({ ...payment, expectedAmount: '122.2' }), null);
  });

  it('copies and freezes the original completion and nested payment snapshot', () => {
    const original = structuredClone(completion);
    const result = readStopCompletion(original);
    assert.deepEqual(result, completion);
    assert.ok(result);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.payment), true);
    assert.equal(Object.isFrozen(result.payment.gatewayNames), true);
    original.payment.expectedAmount = '999.00';
    original.payment.gatewayNames.push('Changed');
    assert.equal(result.payment.expectedAmount, '122.25');
    assert.deepEqual(result.payment.gatewayNames, ['Cash']);
  });

  it('retains zero and missing actual amounts separately and rejects malformed receipts', () => {
    assert.equal(readStopCompletion({ ...completion, actualAmount: '0.00', differenceAmount: '-122.25' })?.actualAmount, '0.00');
    assert.equal(readStopCompletion({ ...completion, actualAmount: null, differenceAmount: null })?.actualAmount, null);
    for (const patch of [
      { actualAmount: 122 }, { actualAmount: '-1.00' }, { differenceAmount: '1e2' },
      { expectedAmount: '999.00' }, { currencyCode: 'USD' }, { assignmentGeneration: '0' },
      { occurredAt: 'not-a-date' }, { recordedAt: null }, { driverId: '' },
    ]) assert.equal(readStopCompletion({ ...completion, ...patch }), null);
  });

  it('matches the original stop, route, assignment, version, time, and Cash request', () => {
    const parsed = readStopCompletion(completion)!;
    const event = {
      deliveryStopId: 'stop-1', routePlanId: 'route-1', assignmentGeneration: '2',
      expectedRouteVersionId: 'version-1', occurredAt: new Date(completion.occurredAt),
      completion: { version: 1 as const, cashReceived: { amount: '122', currency: 'CAD' } },
    };
    assert.equal(matchesStopCompletionEvent(parsed, event), true);
    for (const patch of [{ deliveryStopId: 'other' }, { routePlanId: 'other' },
      { assignmentGeneration: '3' }, { expectedRouteVersionId: 'new-version' },
      { occurredAt: new Date('2026-10-08T07:01:00.000Z') },
      { completion: { version: 1 as const, cashReceived: { amount: '123', currency: 'CAD' } } },
      { completion: { version: 1 as const } }]) {
      assert.equal(matchesStopCompletionEvent(parsed, { ...event, ...patch }), false);
    }
  });
});
