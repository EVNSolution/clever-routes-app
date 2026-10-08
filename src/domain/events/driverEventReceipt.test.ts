import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import receiptApplied from '../../test/contractFixtures/routeOperations/v1/fixtures/receipt.applied.json';
import routeCompleted from '../../test/contractFixtures/routeOperations/v1/fixtures/route-completed.request.json';
import { createDriverEventReceiptApiClient, resolveCompletionReceipt } from './driverEventReceipt';
import type { DriverEventInput } from './driverEvents';

const event = {
  ...routeCompleted,
  occurredAt: new Date(routeCompleted.occurredAt),
} as DriverEventInput;

describe('driver completion receipt recovery', () => {
  const payment = { method: 'CASH' as const, methodTitle: 'Cash', gatewayNames: ['Cash'], financialStatus: 'PENDING',
    expectedAmount: '122.25', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING' as const, requiresCashInput: true };
  const completion = {
    id: 'receipt-1', eventId: 'event-1', deliveryStopId: 'stop-1', routePlanId: event.routePlanId!, driverId: 'driver-1',
    assignmentGeneration: event.assignmentGeneration!, expectedRouteVersionId: event.expectedRouteVersionId!, method: 'CASH' as const, payment,
    expectedAmount: '122.25', actualAmount: '122.00', differenceAmount: '-0.25', currencyCode: 'CAD',
    occurredAt: event.occurredAt.toISOString(), recordedAt: '2026-10-08T07:00:02.000Z',
  };
  const cashEvent: DriverEventInput = { ...event, eventType: 'STOP_DELIVERED', deliveryStopId: 'stop-1',
    completion: { version: 1, cashReceived: { amount: '122.00', currency: 'CAD' } } };

  it('requires the matching immutable completion before acknowledging v1 APPLIED', () => {
    assert.equal(resolveCompletionReceipt(cashEvent, { ...receiptApplied, status: 'APPLIED' }).kind, 'reconcile');
    assert.equal(resolveCompletionReceipt(cashEvent, { ...receiptApplied, status: 'APPLIED', completion }).kind, 'acknowledge');
    assert.equal(resolveCompletionReceipt(cashEvent, { ...receiptApplied, status: 'APPLIED',
      completion: { ...completion, actualAmount: '123.00' } }).kind, 'reconcile');
  });

  it('keeps UNKNOWN v1 requests retryable even after the route ends', () => {
    assert.equal(resolveCompletionReceipt(cashEvent, { ...receiptApplied, status: 'UNKNOWN', routeStatus: 'COMPLETED' }).kind, 'retry');
  });

  it('retries the unchanged first offline Cash request when the server has no event lineage yet', async () => {
    const originalEvent = structuredClone(cashEvent);
    for (const routeStatus of ['IN_PROGRESS', 'COMPLETED', 'FUTURE_ROUTE_STATUS']) {
      const client = createDriverEventReceiptApiClient({
        accountAccessToken: 'account-token', baseUrl: 'https://delivery.example.com',
        fetchImpl: async () => ({ ok: true, json: async () => ({ data: {
          assignmentGeneration: null, clientEventId: cashEvent.clientEventId, errorCode: null,
          expectedRouteVersionId: null, routePlanId: cashEvent.routePlanId, routeStatus, status: 'UNKNOWN',
        } }) }),
      });
      const receipt = await client.lookupReceipt({
        clientEventId: cashEvent.clientEventId, routePlanId: cashEvent.routePlanId!,
      });
      assert.equal(resolveCompletionReceipt(cashEvent, receipt).kind, 'retry', routeStatus);
      assert.deepEqual(cashEvent, originalEvent);
    }
  });

  it('treats absent UNKNOWN lineage separately from contradictory identity or accepted lineage', () => {
    const unknown = { ...receiptApplied, status: 'UNKNOWN' as const, routeStatus: 'IN_PROGRESS',
      assignmentGeneration: null, expectedRouteVersionId: null };
    assert.equal(resolveCompletionReceipt(event, unknown).kind, 'retry');
    assert.equal(resolveCompletionReceipt(cashEvent, {
      ...unknown, assignmentGeneration: cashEvent.assignmentGeneration!,
    }).kind, 'retry');
    assert.equal(resolveCompletionReceipt(cashEvent, {
      ...unknown, expectedRouteVersionId: cashEvent.expectedRouteVersionId!,
    }).kind, 'retry');
    for (const patch of [{ routePlanId: 'other-route' }, { clientEventId: 'other-event' },
      { assignmentGeneration: '999' }, { expectedRouteVersionId: 'different-version' },
      { status: 'APPLIED' as const, completion }, { status: 'REJECTED' as const }]) {
      assert.equal(resolveCompletionReceipt(cashEvent, { ...unknown, ...patch }).kind, 'reconcile');
    }
  });

  it('parses the account receipt as a frozen completion snapshot and rejects malformed money', async () => {
    let returned: unknown = completion;
    const client = createDriverEventReceiptApiClient({ accountAccessToken: 'account-token', baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: { ...receiptApplied, completion: returned } }) }),
    });
    const receipt = await client.lookupReceipt({ clientEventId: event.clientEventId, routePlanId: event.routePlanId! });
    assert.deepEqual(receipt.completion, completion);
    assert.equal(Object.isFrozen(receipt.completion), true);
    returned = { ...completion, actualAmount: 122 };
    await assert.rejects(client.lookupReceipt({ clientEventId: event.clientEventId, routePlanId: event.routePlanId! }), /Invalid driver event receipt/u);
  });

  it('uses the account token and acknowledges an APPLIED response lost after commit', async () => {
    const requests: { authorization?: string; url: string }[] = [];
    const service = createDriverEventReceiptApiClient({
      accountAccessToken: 'account-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({ authorization: init?.headers?.Authorization, url });
        return { json: async () => ({ data: receiptApplied, error: null }), ok: true, status: 200 };
      },
    });
    const receipt = await service.lookupReceipt({ clientEventId: event.clientEventId, routePlanId: String(event.routePlanId) });
    assert.equal(resolveCompletionReceipt(event, receipt).kind, 'acknowledge');
    assert.deepEqual(requests, [{
      authorization: 'Bearer account-token',
      url: 'https://delivery.example.com/driver/event-receipts/11111111-1111-4111-8111-111111111111/01K37KITCHENERCOMPLETE',
    }]);
  });

  it('reissues only UNKNOWN plus IN_PROGRESS and reconciles rejected, terminal, or reassigned receipts', () => {
    assert.equal(resolveCompletionReceipt(event, { ...receiptApplied, routeStatus: 'IN_PROGRESS', status: 'UNKNOWN' }).kind, 'retry');
    assert.equal(resolveCompletionReceipt(event, { ...receiptApplied, routeStatus: 'COMPLETED', status: 'UNKNOWN' }).kind, 'reconcile');
    assert.equal(resolveCompletionReceipt(event, { ...receiptApplied, status: 'REJECTED' }).kind, 'reconcile');
    assert.equal(resolveCompletionReceipt(event, { ...receiptApplied, assignmentGeneration: '8', routeStatus: 'IN_PROGRESS', status: 'UNKNOWN' }).kind, 'reconcile');
  });
});
