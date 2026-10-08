import { normalizeCashAmount, type StopCompletion, type StopCompletionInput, type StopPayment } from '../domain/stop/stopCompletion';

/** QA opt-in plus a server payment contract; old caches never enable v1. */
export function supportsSingleCompletion(input: {
  enabled?: boolean; mode: string; shopDomain?: string; driverContractVersion?: number; payment?: StopPayment | null;
}): boolean {
  return input.enabled === true && input.mode === 'live' && input.driverContractVersion === 2
    && input.shopDomain?.trim().toLowerCase() === '7hrud1-xq.myshopify.com' && input.payment != null;
}

export function getSingleCompletionAction(input: {
  payment: StopPayment; completion?: StopCompletion | null; pending?: boolean;
}): 'recorded' | 'pending' | 'cash' | 'submit' {
  if (input.completion != null) return 'recorded';
  if (input.pending === true) return 'pending';
  return input.payment.requiresCashInput ? 'cash' : 'submit';
}

export function buildCashCompletion(value: string, payment: StopPayment): StopCompletionInput {
  if (value.trim() === '') throw new Error('Enter the amount received. Enter 0 if no cash was received.');
  const amount = normalizeCashAmount(value.trim());
  if (amount === null) throw new Error('Enter a nonnegative amount with up to two decimal places.');
  if (payment.currencyCode === null) throw new Error('Currency unknown. Ask dispatch to correct the payment currency.');
  return { version: 1, cashReceived: { amount, currency: payment.currencyCode } };
}

export function formatCompletionAmount(amount: string | null, currency: string | null, missing = 'Not recorded'): string {
  if (amount === null) return missing;
  return currency === null ? `${amount} · Currency unknown` : `${currency} ${amount}`;
}
