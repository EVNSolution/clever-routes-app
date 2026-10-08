import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCashCompletion, formatCompletionAmount, getSingleCompletionAction, supportsSingleCompletion } from './kfoodSingleCompletion';
import type { StopCompletion, StopPayment } from '../domain/stop/stopCompletion';

const payment: StopPayment = { method: 'CASH', methodTitle: 'Cash', gatewayNames: ['Cash'], financialStatus: 'PENDING', expectedAmount: '122.25', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING', requiresCashInput: true };
const supported = { enabled: true, mode: 'live' as const, shopDomain: '7hrud1-xq.myshopify.com', driverContractVersion: 2, payment };
describe('KFood single completion', () => {
  it('requires explicit activation, live KFood v2, and server payment support', () => {
    assert.equal(supportsSingleCompletion(supported), true);
    for (const override of [{ enabled: false }, { mode: 'mock' }, { shopDomain: 'dsv' }, { driverContractVersion: 1 }, { payment: undefined }, { payment: null }]) {
      assert.equal(supportsSingleCompletion({ ...supported, ...override }), false);
    }
  });
  it('uses Cash input only on the server requirement and submits other methods immediately', () => {
    assert.equal(getSingleCompletionAction({ payment }), 'cash');
    for (const method of ['ETRANSFER', 'UNKNOWN', 'CASH'] as const) {
      assert.equal(getSingleCompletionAction({ payment: { ...payment, method, requiresCashInput: false } }), 'submit');
    }
  });
  it('never recollects accepted or pending completion', () => {
    assert.equal(getSingleCompletionAction({ payment, completion: {} as StopCompletion }), 'recorded');
    assert.equal(getSingleCompletionAction({ payment, pending: true }), 'pending');
  });
  it('preserves exact amounts, including zero and the largest supported input', () => {
    for (const [value, amount] of [['122', '122.00'], ['122.25', '122.25'], ['123', '123.00'], ['0', '0.00'], ['9999999999999999.99', '9999999999999999.99']]) {
      assert.deepEqual(buildCashCompletion(value!, payment), { version: 1, cashReceived: { amount, currency: 'CAD' } });
    }
  });
  it('rejects empty, invalid, and unknown currency without inventing source values', () => {
    for (const value of ['', ' ', '-1', '1.234', '1e2', 'NaN']) assert.throws(() => buildCashCompletion(value, payment));
    assert.throws(() => buildCashCompletion('0', { ...payment, currencyCode: null }));
    assert.deepEqual(buildCashCompletion('22', { ...payment, expectedAmount: null }), { version: 1, cashReceived: { amount: '22.00', currency: 'CAD' } });
  });
  it('keeps unrecorded money distinct from zero', () => {
    assert.equal(formatCompletionAmount(null, 'CAD'), 'Not recorded');
    assert.equal(formatCompletionAmount('0.00', 'CAD'), 'CAD 0.00');
    assert.equal(formatCompletionAmount('122.25', null), '122.25 · Currency unknown');
  });
});
