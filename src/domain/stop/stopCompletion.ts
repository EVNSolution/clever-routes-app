export type StopPayment = Readonly<{
  method: 'CASH' | 'ETRANSFER' | 'OTHER' | 'UNKNOWN';
  methodTitle: string | null;
  gatewayNames: readonly string[];
  financialStatus: string | null;
  expectedAmount: string | null;
  currencyCode: string | null;
  expectedAmountSource: 'SHOPIFY_OUTSTANDING' | 'UNPAID_ORDER_TOTAL' | 'PAID' | 'UNKNOWN';
  requiresCashInput: boolean;
}>;

export type StopCompletionInput = Readonly<{
  version: 1;
  cashReceived?: Readonly<{ amount: string; currency: string }>;
}>;

export type StopCompletion = Readonly<{
  id: string;
  eventId: string;
  deliveryStopId: string;
  routePlanId: string;
  driverId: string;
  assignmentGeneration: string;
  expectedRouteVersionId: string;
  method: StopPayment['method'];
  payment: StopPayment;
  expectedAmount: string | null;
  actualAmount: string | null;
  differenceAmount: string | null;
  currencyCode: string | null;
  occurredAt: string;
  recordedAt: string;
}>;

/** PR489 decimal(18,2) input. Never convert exact Cash amounts to floating point. */
export function normalizeCashAmount(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function readStopCompletionInput(value: unknown): StopCompletionInput | null {
  const input = record(value);
  if (input === null || input.version !== 1
    || Object.keys(input).some((key) => !['version', 'cashReceived'].includes(key))) return null;
  if (input.cashReceived === undefined) return Object.freeze({ version: 1 });
  const cash = record(input.cashReceived);
  if (cash === null || Object.keys(cash).some((key) => !['amount', 'currency'].includes(key))) return null;
  const amount = normalizeCashAmount(cash.amount);
  if (amount === null || !isCurrency(cash.currency)) return null;
  return Object.freeze({ version: 1, cashReceived: Object.freeze({ amount, currency: cash.currency }) });
}

export function readStopPayment(value: unknown): StopPayment | null {
  const payment = record(value);
  if (payment === null || !isMethod(payment.method) || !nullableString(payment.methodTitle)
    || !Array.isArray(payment.gatewayNames) || !payment.gatewayNames.every((name) => typeof name === 'string')
    || !nullableString(payment.financialStatus) || !nullableMoney(payment.expectedAmount, true)
    || !(payment.currencyCode === null || isCurrency(payment.currencyCode))
    || !isAmountSource(payment.expectedAmountSource) || typeof payment.requiresCashInput !== 'boolean') return null;
  return Object.freeze({
    method: payment.method,
    methodTitle: payment.methodTitle,
    gatewayNames: Object.freeze([...payment.gatewayNames] as string[]),
    financialStatus: payment.financialStatus,
    expectedAmount: payment.expectedAmount,
    currencyCode: payment.currencyCode,
    expectedAmountSource: payment.expectedAmountSource,
    requiresCashInput: payment.requiresCashInput,
  });
}

/** A receipt is a copied, immutable source snapshot, independent of the current order. */
export function readStopCompletion(value: unknown): StopCompletion | null {
  const completion = record(value);
  if (completion === null) return null;
  const payment = readStopPayment(completion.payment);
  if (payment === null || !nonEmptyString(completion.id) || !nonEmptyString(completion.eventId)
    || !nonEmptyString(completion.deliveryStopId) || !nonEmptyString(completion.routePlanId)
    || !nonEmptyString(completion.driverId) || typeof completion.assignmentGeneration !== 'string'
    || !/^[1-9]\d*$/u.test(completion.assignmentGeneration) || !nonEmptyString(completion.expectedRouteVersionId)
    || completion.method !== payment.method || !nullableMoney(completion.expectedAmount, true)
    || !nullableMoney(completion.actualAmount, false) || !nullableMoney(completion.differenceAmount, true)
    || !(completion.currencyCode === null || isCurrency(completion.currencyCode))
    || completion.expectedAmount !== payment.expectedAmount || completion.currencyCode !== payment.currencyCode
    || !isTimestamp(completion.occurredAt) || !isTimestamp(completion.recordedAt)) return null;
  return Object.freeze({
    id: completion.id,
    eventId: completion.eventId,
    deliveryStopId: completion.deliveryStopId,
    routePlanId: completion.routePlanId,
    driverId: completion.driverId,
    assignmentGeneration: completion.assignmentGeneration,
    expectedRouteVersionId: completion.expectedRouteVersionId,
    method: payment.method,
    payment,
    expectedAmount: completion.expectedAmount,
    actualAmount: completion.actualAmount,
    differenceAmount: completion.differenceAmount,
    currencyCode: completion.currencyCode,
    occurredAt: completion.occurredAt,
    recordedAt: completion.recordedAt,
  });
}

export function matchesStopCompletionEvent(completion: StopCompletion, event: {
  assignmentGeneration?: string;
  completion?: StopCompletionInput;
  deliveryStopId?: string | null;
  expectedRouteVersionId?: string;
  occurredAt: Date;
  routePlanId?: string | null;
}): boolean {
  const input = readStopCompletionInput(event.completion);
  if (input === null || completion.deliveryStopId !== event.deliveryStopId
    || completion.routePlanId !== event.routePlanId || completion.assignmentGeneration !== event.assignmentGeneration
    || completion.expectedRouteVersionId !== event.expectedRouteVersionId
    || Date.parse(completion.occurredAt) !== event.occurredAt.getTime()) return false;
  return input.cashReceived === undefined
    ? completion.actualAmount === null
    : completion.method === 'CASH' && completion.actualAmount === input.cashReceived.amount
      && completion.currencyCode === input.cashReceived.currency;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function isMethod(value: unknown): value is StopPayment['method'] {
  return value === 'CASH' || value === 'ETRANSFER' || value === 'OTHER' || value === 'UNKNOWN';
}

function isAmountSource(value: unknown): value is StopPayment['expectedAmountSource'] {
  return value === 'SHOPIFY_OUTSTANDING' || value === 'UNPAID_ORDER_TOTAL' || value === 'PAID' || value === 'UNKNOWN';
}

function nullableMoney(value: unknown, signed: boolean): value is string | null {
  return value === null || (typeof value === 'string' && (signed
    ? /^-?(?:0|[1-9]\d{0,15})\.\d{2}$/u : /^(?:0|[1-9]\d{0,15})\.\d{2}$/u).test(value));
}

function isCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/u.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
}
