import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import type { DriverEventInput } from '../events/driverEvents';
import type { StopCompletion } from '../stop/stopCompletion';
import { createMockProofMediaUploadService } from '../proof/proofMediaUpload';
import { recordStopProofEventAfterDeliveryStart } from '../stop/stopProofEvents';
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  recoverPendingStopCompletionReceipts,
  retryOfflineSubmissions,
  type OfflineSubmissionQueueStorage,
} from './offlineSubmissionQueue';

const at = '2026-10-08T07:00:00.000Z';
const now = () => new Date(at);
const event: DriverEventInput = {
  appVersion: '1.3.4', assignmentGeneration: '2',
  clientEventId: '1ca60000-0000-4000-8000-000000000001',
  completion: { version: 1, cashReceived: { amount: '9999999999999999.25', currency: 'CAD' } },
  deliveryStopId: '1ca60000-0000-4000-8000-000000000002', driverContractVersion: 2,
  eventType: 'STOP_DELIVERED', expectedRouteVersionId: '1ca60000-0000-4000-8000-000000000003',
  occurredAt: now(), payload: { proof: { note: 'Original note' } },
  routePlanId: '1ca60000-0000-4000-8000-000000000006', versionCode: 40,
};
const completion: StopCompletion = {
  id: '1ca60000-0000-4000-8000-000000000004', eventId: '1ca60000-0000-4000-8000-000000000005',
  deliveryStopId: event.deliveryStopId!, routePlanId: event.routePlanId!,
  driverId: '1ca60000-0000-4000-8000-000000000007', assignmentGeneration: '2',
  expectedRouteVersionId: event.expectedRouteVersionId!, method: 'CASH',
  payment: { method: 'CASH', methodTitle: 'Cash', gatewayNames: ['Cash'], financialStatus: 'PENDING',
    expectedAmount: '9999999999999999.50', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING', requiresCashInput: true },
  expectedAmount: '9999999999999999.50', actualAmount: '9999999999999999.25', differenceAmount: '-0.25',
  currencyCode: 'CAD', occurredAt: at, recordedAt: at,
};
const activeDelivery = { flowState: 'delivery_active', kind: 'delivery_active', locationPermission: 'foreground', message: 'active' } as const;

function storage(): OfflineSubmissionQueueStorage {
  const values = new Map<string, string>();
  return { getItem: async key => values.get(key) ?? null, removeItem: async key => { values.delete(key); }, setItem: async (key, value) => { values.set(key, value); } };
}
function receipt(status: 'APPLIED' | 'UNKNOWN', includeCompletion = true) {
  return { assignmentGeneration: status === 'UNKNOWN' ? null : '2', clientEventId: event.clientEventId, errorCode: null,
    expectedRouteVersionId: status === 'UNKNOWN' ? null : event.expectedRouteVersionId!, routePlanId: event.routePlanId!,
    routeStatus: 'COMPLETED', status, ...(includeCompletion ? { completion } : {}) };
}

describe('durable Cash completion', () => {
  for (const scenario of ['cash-quarantine', 'legacy-quarantine', 'cash-required', 'cash-invalid', 'cash-conflict', 'receipt-conflict', 'ordered-network-failure'] as const) {
    it(`continues independent GPS and other-stop proof through ${scenario}`, async () => {
      const queue = createInMemoryOfflineSubmissionQueue({ now });
      const legacy = scenario === 'legacy-quarantine' || scenario === 'ordered-network-failure';
      const head = queue.enqueueDriverEvent(legacy ? { ...event, completion: undefined } : event);
      if (scenario === 'cash-quarantine') queue.quarantine(head.queueItemId, 'completion_input_invalid');
      if (scenario === 'legacy-quarantine') queue.quarantine(head.queueItemId, 'retry_policy_exceeded');
      queue.enqueueDriverEvent({ clientEventId: 'independent-gps', eventType: 'LOCATION_UPDATED',
        routePlanId: event.routePlanId, occurredAt: now(), latitude: 43, longitude: -79 });
      queue.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop',
        fileName: 'proof.jpg', uri: 'file:///synthetic-proof.jpg', source: 'camera' }, { assignmentGeneration: '2' });
      queue.enqueueDriverEvent({ ...event, completion: undefined, clientEventId: 'ordered-next', eventType: 'STOP_FAILED' });
      const calls: string[] = [];
      const result = await retryOfflineSubmissions({ queue, now, routePlanId: event.routePlanId!,
        ...(scenario === 'receipt-conflict' ? { driverEventReceiptService: { lookupReceipt: async () => {
          calls.push('receipt'); return { ...receipt('APPLIED'), status: 'REJECTED' as const, completion: null };
        } } } : {}),
        orderedEventAccessIdentity: { assignmentGeneration: '2', driverContractVersion: 2,
          expectedRouteVersionId: event.expectedRouteVersionId!, routePlanId: event.routePlanId! },
        driverEventService: { recordDriverEvent: async submitted => {
          calls.push(submitted.clientEventId);
          if (submitted.clientEventId === event.clientEventId) {
            if (scenario === 'ordered-network-failure') throw new Error('network offline');
            const code = scenario === 'cash-required' ? 'CASH_RECEIVED_REQUIRED'
              : scenario === 'cash-conflict' ? 'CASH_COMPLETION_CONFLICT' : 'CASH_COMPLETION_INVALID';
            throw createDriverApiHttpError({ code, endpoint: 'events', status: scenario === 'cash-conflict' ? 409 : 400 });
          }
          return { status: 'recorded', eventId: submitted.clientEventId, duplicate: false };
        } }, proofMediaUploadService: { uploadProofMedia: async (request, options) => {
          calls.push('other-stop-proof');
          return createMockProofMediaUploadService().uploadProofMedia(request, options);
        } },
      });
      assert.deepEqual(calls, [
        ...(scenario === 'cash-quarantine' || scenario === 'legacy-quarantine' ? []
          : scenario === 'receipt-conflict' ? ['receipt'] : [event.clientEventId]),
        'independent-gps', 'other-stop-proof',
      ]);
      if (scenario === 'cash-required' || scenario === 'cash-invalid' || scenario === 'cash-conflict' || scenario === 'receipt-conflict') {
        assert.deepEqual(result.reconciliationRoutePlanIds, [event.routePlanId]);
      }
      assert.equal(result.succeeded, 2);
      assert.equal(queue.listPending().length, 2);
      const retained = queue.listPending()[0];
      assert.deepEqual(retained?.kind === 'driver_event' ? retained.event : null, head.event);
      assert.equal(queue.listPending()[1]?.queueItemId, 'driver-event:ordered-next');
    });
  }

  it('recovers an APPLIED Cash receipt behind a failed ordered event while independent evidence continues', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ now });
    queue.enqueueDriverEvent({ ...event, completion: undefined, eventType: 'PICKUP_COMPLETED', clientEventId: 'pickup-first' });
    queue.enqueueDriverEvent(event);
    queue.enqueueDriverEvent({ clientEventId: 'independent-gps', eventType: 'LOCATION_UPDATED', routePlanId: event.routePlanId, occurredAt: now() });
    queue.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'proof.jpg', uri: 'file:///proof.jpg', source: 'camera' });
    const calls: string[] = [];
    const result = await retryOfflineSubmissions({ queue, now,
      driverEventReceiptService: { lookupReceipt: async () => { calls.push('receipt'); return receipt('APPLIED'); } },
      driverEventService: { recordDriverEvent: async submitted => {
        calls.push(submitted.clientEventId);
        if (submitted.clientEventId === 'pickup-first') throw new Error('network offline');
        return { status: 'recorded', eventId: submitted.clientEventId, duplicate: false };
      } }, proofMediaUploadService: { uploadProofMedia: async (request, options) => {
        calls.push('proof'); return createMockProofMediaUploadService().uploadProofMedia(request, options);
      } },
    });
    assert.deepEqual(calls, ['pickup-first', 'receipt', 'independent-gps', 'proof']);
    assert.equal(result.succeeded, 3);
    assert.deepEqual(queue.getStopCompletion(event.routePlanId!, event.deliveryStopId!), completion);
    assert.equal(queue.listPending()[0]?.queueItemId, 'driver-event:pickup-first');
  });

  for (const code of ['ROUTE_NOT_IN_PROGRESS', 'ROUTE_ASSIGNMENT_CHANGED', 'ROUTE_VERSION_MISMATCH'] as const) {
    it(`retains route-wide transmission blocking for ${code}`, async () => {
      const durable = storage();
      const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
      queue.enqueueDriverEvent(event);
      queue.enqueueDriverEvent({ clientEventId: 'independent-gps', eventType: 'LOCATION_UPDATED', routePlanId: event.routePlanId, occurredAt: now() });
      queue.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'proof.jpg', uri: 'file:///proof.jpg', source: 'camera' });
      const calls: string[] = [];
      const services = {
        driverEventService: { recordDriverEvent: async submitted => {
          calls.push(submitted.clientEventId); throw createDriverApiHttpError({ code, status: 409, endpoint: 'events' });
        } }, proofMediaUploadService: { uploadProofMedia: async () => { calls.push('proof'); throw new Error('unexpected'); } },
      } satisfies Pick<Parameters<typeof retryOfflineSubmissions>[0], 'driverEventService' | 'proofMediaUploadService'>;
      await retryOfflineSubmissions({ queue, now, ...services });
      await retryOfflineSubmissions({ queue, now, ...services });
      await queue.whenPersisted();
      const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
      restarted.enqueueDriverEvent({ clientEventId: 'later-gps', eventType: 'LOCATION_UPDATED', routePlanId: event.routePlanId, occurredAt: now() });
      restarted.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'later-proof.jpg', uri: 'file:///later-proof.jpg', source: 'camera' });
      await retryOfflineSubmissions({ queue: restarted, now, ...services });
      assert.deepEqual(calls, [event.clientEventId]);
      assert.equal(queue.listPending()[0]?.state, 'QUARANTINED');
    });
  }

  for (const storedRejection of [false, true]) {
    it(`allows authoritative new-assignment GPS/proof while preserving old evidence (stored=${storedRejection})`, async () => {
      const durable = storage();
      const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
      const queued = queue.enqueueDriverEvent(event);
      if (storedRejection) queue.quarantine(queued.queueItemId, 'assignment_changed');
      queue.enqueueDriverEvent({ clientEventId: 'old-gps', eventType: 'LOCATION_UPDATED', assignmentGeneration: '2', routePlanId: event.routePlanId, occurredAt: now() });
      queue.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'proof.jpg', uri: 'file:///proof.jpg', source: 'camera' }, { assignmentGeneration: '2' });
      await queue.whenPersisted();
      const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
      restarted.enqueueDriverEvent({ clientEventId: 'new-gps', eventType: 'LOCATION_UPDATED', assignmentGeneration: '3', routePlanId: event.routePlanId, occurredAt: now() });
      restarted.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'proof.jpg', uri: 'file:///proof.jpg', source: 'camera' }, { assignmentGeneration: '3' });
      const calls: string[] = [];
      await retryOfflineSubmissions({ queue: restarted, now,
        orderedEventAccessIdentity: { assignmentGeneration: '3', driverContractVersion: 2, expectedRouteVersionId: 'new-publication', routePlanId: event.routePlanId! },
        driverEventService: { recordDriverEvent: async submitted => {
          calls.push(submitted.clientEventId); return { duplicate: false, eventId: submitted.clientEventId, status: 'recorded' };
        } }, proofMediaUploadService: { uploadProofMedia: async (request, options) => {
          calls.push('new-proof'); return createMockProofMediaUploadService().uploadProofMedia(request, options);
        } },
      });
      assert.deepEqual(calls, ['new-gps', 'new-proof']);
      const retained = restarted.listPending()[0];
      assert.deepEqual(retained?.kind === 'driver_event' ? retained.event : null, event);
      assert.equal(restarted.listPending().find(item => item.queueItemId === 'driver-event:old-gps')?.reconciliation?.reason, 'assignment_changed');
    });
  }

  it('blocks independent transmission after a local same-assignment contract mismatch', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ now });
    queue.enqueueDriverEvent(event);
    queue.enqueueDriverEvent({ clientEventId: 'gps', eventType: 'LOCATION_UPDATED', routePlanId: event.routePlanId, occurredAt: now() });
    queue.enqueueProofMediaUpload({ routePlanId: event.routePlanId!, deliveryStopId: 'other-stop', fileName: 'proof.jpg', uri: 'file:///proof.jpg', source: 'camera' }, { assignmentGeneration: '2' });
    const calls: string[] = [];
    await retryOfflineSubmissions({ queue, now,
      orderedEventAccessIdentity: { assignmentGeneration: '2', driverContractVersion: 2, expectedRouteVersionId: 'mismatched-publication', routePlanId: event.routePlanId! },
      driverEventService: { recordDriverEvent: async submitted => { calls.push(submitted.clientEventId); throw new Error('unexpected'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { calls.push('proof'); throw new Error('unexpected'); } },
    });
    assert.deepEqual(calls, []);
  });

  it('does not post unknown Cash out of order after an earlier route event fails', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ now });
    queue.enqueueDriverEvent({ ...event, completion: undefined, eventType: 'PICKUP_COMPLETED', clientEventId: 'pickup-first' });
    queue.enqueueDriverEvent(event);
    const posted: string[] = [];
    let lookups = 0;
    await retryOfflineSubmissions({ queue, now,
      driverEventReceiptService: { lookupReceipt: async () => { lookups += 1; return receipt('UNKNOWN', false); } },
      driverEventService: { recordDriverEvent: async saved => { posted.push(saved.clientEventId); throw new Error('network offline'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected'); } },
    });
    assert.equal(lookups, 1);
    assert.deepEqual(posted, ['pickup-first']);
    assert.equal(queue.listPending()[1]?.state, 'PENDING');
  });

  it('recovers Cash with account-only access after sign-out and restart without posting', async () => {
    const durable = storage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    queue.enqueueDriverEvent(event);
    queue.sealForAccountChange();
    await queue.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    const unknown = await recoverPendingStopCompletionReceipts({ queue: restarted,
      driverEventReceiptService: { lookupReceipt: async () => receipt('UNKNOWN', false) } });
    assert.deepEqual(unknown.acknowledgedStopIds, []);
    assert.equal(restarted.listPending()[0]?.reconciliation?.reason, 'account_signed_out');
    const applied = await recoverPendingStopCompletionReceipts({ queue: restarted,
      driverEventReceiptService: { lookupReceipt: async () => receipt('APPLIED') } });
    assert.deepEqual(applied.acknowledgedStopIds, [event.deliveryStopId]);
    const finalRestart = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    assert.deepEqual(finalRestart.getStopCompletion(event.routePlanId!, event.deliveryStopId!), completion);
  });

  for (const status of [403, 404, 503]) {
    it(`preserves an inaccessible receipt (${status}) while recovering the next route receipt`, async () => {
      const queue = createInMemoryOfflineSubmissionQueue({ now });
      queue.enqueueDriverEvent({ ...event, routePlanId: 'reassigned-old-route', clientEventId: 'old-event' });
      queue.enqueueDriverEvent(event);
      const lookedUp: string[] = [];
      const result = await recoverPendingStopCompletionReceipts({ queue, driverEventReceiptService: {
        lookupReceipt: async input => {
          lookedUp.push(input.routePlanId);
          if (input.routePlanId === 'reassigned-old-route') throw createDriverApiHttpError({ endpoint: 'receipt', status });
          return receipt('APPLIED');
        },
      } });
      assert.deepEqual(lookedUp, ['reassigned-old-route', event.routePlanId]);
      assert.deepEqual(result.acknowledgedStopIds, [event.deliveryStopId]);
      const pending = queue.listPending()[0];
      assert.equal(pending?.kind === 'driver_event' ? pending.event.clientEventId : null, 'old-event');
      assert.equal(pending?.state, 'PENDING');
      assert.equal(pending?.attempts, 0);
    });
  }

  it('retains the pre-response Cash request when the ACK write fails and recovers the exact receipt', async () => {
    const durable = storage();
    const originalWrite = durable.setItem;
    let writes = 0;
    durable.setItem = async (key, value) => {
      writes += 1;
      if (writes === 2) throw new Error('ACK disk unavailable');
      await originalWrite(key, value);
    };
    const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    await assert.rejects(recordStopProofEventAfterDeliveryStart({ deliveryStart: activeDelivery, offlineQueue: queue,
      input: { action: 'delivered', clientEventId: event.clientEventId, completion: event.completion,
        deliveryStopId: event.deliveryStopId!, routePlanId: event.routePlanId!, occurredAt: event.occurredAt, note: 'Original note' },
      driverEventService: {
        prepareDriverEvent: input => ({ ...event, ...input }),
        recordDriverEvent: async submitted => {
          const beforeTransport = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
          const saved = beforeTransport.listPending()[0];
          assert.deepEqual(saved?.kind === 'driver_event' ? saved.event : null, submitted);
          return { completion, eventId: completion.eventId, status: 'recorded', duplicate: false };
        },
      },
    }), /ACK disk unavailable/u);
    const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    assert.equal(restarted.listPending()[0]?.state, 'PENDING');
    await recoverPendingStopCompletionReceipts({ queue: restarted, driverEventReceiptService: { lookupReceipt: async () => receipt('APPLIED') } });
    assert.deepEqual(restarted.getStopCompletion(event.routePlanId!, event.deliveryStopId!), completion);
  });

  it('preserves explicit zero and its original decimal representation through retry', async () => {
    const durable = storage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    queue.enqueueDriverEvent({ ...event, completion: { version: 1, cashReceived: { amount: '0', currency: 'CAD' } } });
    await queue.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    const zeroReceipt = { ...completion, actualAmount: '0.00', differenceAmount: '-9999999999999999.50' };
    const retried = await retryOfflineSubmissions({ queue: restarted, now,
      driverEventService: { recordDriverEvent: async saved => {
        assert.equal(saved.completion?.cashReceived?.amount, '0');
        return { completion: zeroReceipt, eventId: zeroReceipt.eventId, status: 'recorded', duplicate: true };
      } }, proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected'); } },
    });
    assert.equal(retried.succeeded, 1);
    assert.equal(restarted.getStopCompletion(event.routePlanId!, event.deliveryStopId!)?.actualAmount, '0.00');
  });

  it('copies money and payload before transport and restores exact strings after restart', async () => {
    const durable = storage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    const submitted = { ...event, completion: { version: 1 as const, cashReceived: { amount: '9999999999999999.25', currency: 'CAD' } }, payload: { proof: { note: 'Original note' } } };
    queue.enqueueDriverEvent(submitted);
    submitted.completion.cashReceived.amount = '0';
    submitted.payload.proof.note = 'Edited later';
    await queue.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now });
    const saved = restarted.listPending()[0];
    assert.equal(saved?.kind, 'driver_event');
    if (saved?.kind !== 'driver_event') throw new Error('Missing saved event');
    assert.deepEqual(saved.event, event);
    assert.equal(queue.acknowledge(saved.queueItemId), false, 'missing receipt must not acknowledge Cash');
    queue.enqueueDriverEvent({ ...event, completion: { version: 1, cashReceived: { amount: '0', currency: 'CAD' } } });
    assert.equal(queue.listPending()[0]?.reconciliation?.reason, 'event_identity_conflict');
  });

  it('persists receipt and ACK together, isolated by account owner, across restart', async () => {
    const durable = storage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage: durable, now, accountOwnerHash: 'a'.repeat(64) });
    const queued = queue.enqueueDriverEvent(event);
    await queue.whenPersisted();
    assert.equal(queue.acknowledge(queued.queueItemId, completion), true);
    await queue.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ storage: durable, now, accountOwnerHash: 'a'.repeat(64) });
    assert.deepEqual(restarted.getStopCompletion(event.routePlanId!, event.deliveryStopId!), completion);
    restarted.bindAccountOwnerHash('b'.repeat(64));
    assert.equal(restarted.getStopCompletion(event.routePlanId!, event.deliveryStopId!), null);
    restarted.bindAccountOwnerHash('a'.repeat(64));
    assert.equal(restarted.getStopCompletion(event.routePlanId!, event.deliveryStopId!)?.actualAmount, '9999999999999999.25');
  });

  it('recovers account receipt before rejecting old assignment and does not POST again', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ now });
    queue.enqueueDriverEvent(event);
    let posts = 0;
    const result = await retryOfflineSubmissions({ queue, now,
      orderedEventAccessIdentity: { assignmentGeneration: '3', driverContractVersion: 2, expectedRouteVersionId: 'changed', routePlanId: event.routePlanId! },
      driverEventReceiptService: { lookupReceipt: async () => receipt('APPLIED') },
      driverEventService: { recordDriverEvent: async () => { posts += 1; throw new Error('must not post'); } },
      proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected'); } },
    });
    assert.equal(posts, 0);
    assert.equal(result.succeeded, 1);
    assert.deepEqual(result.serverConfirmedStopIds, [event.deliveryStopId]);
    assert.deepEqual(queue.getStopCompletion(event.routePlanId!, event.deliveryStopId!), completion);
  });

  for (const status of ['UNKNOWN', 'APPLIED'] as const) {
    it(`keeps original Cash pending when ${status} receipt has no completion and POST response lacks receipt`, async () => {
      const queue = createInMemoryOfflineSubmissionQueue({ now });
      queue.enqueueDriverEvent(event);
      const result = await retryOfflineSubmissions({ queue, now,
        driverEventReceiptService: { lookupReceipt: async () => receipt(status, false) },
        driverEventService: { recordDriverEvent: async saved => {
          assert.deepEqual(saved, event);
          return { status: 'recorded', eventId: 'legacy-only-response', duplicate: false };
        } }, proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected'); } },
      });
      assert.equal(result.succeeded, 0);
      assert.equal(queue.listPending().length, 1);
      const retained = queue.listPending()[0];
      assert.equal(retained?.kind === 'driver_event' ? retained.event.completion?.cashReceived?.amount : null, '9999999999999999.25');
      assert.equal(queue.getStopCompletion(event.routePlanId!, event.deliveryStopId!), null);
    });
  }

  for (const [code, status, reason] of [
    ['CASH_RECEIVED_REQUIRED', 400, 'completion_input_invalid'],
    ['CASH_COMPLETION_INVALID', 400, 'completion_input_invalid'],
    ['CASH_COMPLETION_CONFLICT', 409, 'cash_completion_conflict'],
  ] as const) {
    it(`stops automatic retries and preserves original input for ${code}`, async () => {
      const queue = createInMemoryOfflineSubmissionQueue({ now });
      queue.enqueueDriverEvent(event);
      let posts = 0;
      const dependencies = { queue, now, driverEventService: { recordDriverEvent: async () => {
        posts += 1; throw createDriverApiHttpError({ code, endpoint: 'event', status });
      } }, proofMediaUploadService: { uploadProofMedia: async () => { throw new Error('unexpected'); } } };
      await retryOfflineSubmissions(dependencies);
      await retryOfflineSubmissions(dependencies);
      assert.equal(posts, 1);
      const saved = queue.listPending()[0];
      assert.equal(saved?.reconciliation?.reason, reason);
      assert.equal(saved?.lastErrorCode, code);
      assert.deepEqual(saved?.kind === 'driver_event' ? saved.event : null, event);
    });
  }

  it('blocks a second button tap while a Cash result is pending and does not reuse a new amount', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ now });
    queue.enqueueDriverEvent(event);
    let posts = 0;
    const result = await recordStopProofEventAfterDeliveryStart({ deliveryStart: activeDelivery, offlineQueue: queue,
      driverEventService: { recordDriverEvent: async () => { posts += 1; throw new Error('must not post'); } },
      input: { action: 'delivered', clientEventId: '1ca60000-0000-4000-8000-000000000099',
        completion: { version: 1, cashReceived: { amount: '0', currency: 'CAD' } },
        deliveryStopId: event.deliveryStopId!, routePlanId: event.routePlanId!, note: '' },
    });
    assert.equal(posts, 0);
    assert.equal(result.kind, 'queued');
    assert.equal(queue.listPending().length, 1);
  });
});
