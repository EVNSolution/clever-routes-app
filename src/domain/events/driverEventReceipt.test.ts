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
