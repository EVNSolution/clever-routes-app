import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from './assignedRoute';
import {
  applyLiveRoutePublication,
  createLiveRouteChangeApiClient,
  mergeLiveRouteExecutionState,
  parseLiveRoutePublication,
  type LiveRoutePublication,
} from './liveRouteChange';
import { DriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import type { StopCompletion, StopPayment } from '../stop/stopCompletion';

const publicationId = '90000000-0000-4000-8000-000000000001';

function publication(): LiveRoutePublication {
  return {
    routePlanId: sampleAssignedRoute.id,
    publicationVersionId: publicationId,
    assignmentGeneration: '2',
    sequence: 1,
    publishedAt: '2026-10-07T10:00:00.000Z',
    appliedVersionId: null,
    pending: true,
    snapshot: {
      schemaVersion: 1,
      initialRouteVersionId: '60000000-0000-4000-8000-000000000001',
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        routePlanStopId: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        deliveryStopId: stop.deliveryStopId,
        orderId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        sourceOrderId: String(index + 1),
        sequence: stop.sequence,
        recipientName: stop.recipientName,
        phone: stop.phone,
        ...stop.address,
        instructions: 'Keep this immutable server instruction',
        latitude: stop.coordinates?.latitude.toString() ?? null,
        longitude: stop.coordinates?.longitude.toString() ?? null,
        serviceMinutes: 5,
        timeWindowStart: null,
        timeWindowEnd: null,
      })),
    },
  };
}

describe('live route publication contract', () => {
  it('parses a complete immutable publication without dropping operational fields', () => {
    const input = publication();
    const parsed = parseLiveRoutePublication(input);
    assert.deepEqual(parsed, input);
    assert.notEqual(parsed, input);
    assert.equal(Object.isFrozen(parsed.snapshot.stops[0]), true);
    assert.equal(parsed.snapshot.stops[0]?.instructions, 'Keep this immutable server instruction');
  });

  it('rejects invalid identity, schema, duplicate stops, order and coordinate pairs', () => {
    const value = publication();
    for (const invalid of [
      { ...value, assignmentGeneration: '02' },
      { ...value, assignmentGeneration: '9223372036854775808' },
      { ...value, publicationVersionId: 'not-a-publication' },
      { ...value, pending: 'true' },
      { ...value, publishedAt: 'tomorrow' },
      { ...value, sequence: -1 },
      { ...value, snapshot: { ...value.snapshot, schemaVersion: 2 } },
      { ...value, snapshot: { ...value.snapshot, stops: [value.snapshot.stops[0], value.snapshot.stops[0]] } },
      { ...value, snapshot: { ...value.snapshot, stops: [...value.snapshot.stops].reverse() } },
      { ...value, snapshot: { ...value.snapshot, stops: [{ ...value.snapshot.stops[0], latitude: null }] } },
      { ...value, snapshot: { ...value.snapshot, stops: [{ ...value.snapshot.stops[0], latitude: '91' }] } },
      { ...value, snapshot: { ...value.snapshot, stops: [{ ...value.snapshot.stops[0], longitude: '' }] } },
    ]) {
      assert.throws(() => parseLiveRoutePublication(invalid), /Invalid live route publication/u);
    }
  });

  it('applies exact snapshot order and addresses while preserving local stop state and payment data', () => {
    const route = structuredClone(sampleAssignedRoute);
    route.stops[0]!.status = 'ARRIVED';
    route.stops[0]!.estimatedArrivalAt = '2026-10-07T10:00:00.000Z';
    route.stops[1]!.estimatedArrivalAt = '2026-10-07T11:00:00.000Z';
    const original = structuredClone(route);
    const value = publication();
    const stops = value.snapshot.stops.map((stop, index) => index === 0 ? stop : {
      ...stop, address1: '700 New Address', latitude: '43.7', longitude: '-79.4',
      recipientName: 'Updated recipient', phone: '+14165550177',
    });
    const applied = applyLiveRoutePublication(route, { ...value, snapshot: { ...value.snapshot, stops } });
    assert.equal(applied.stops[1]?.address.address1, '700 New Address');
    assert.equal(applied.stops[1]?.recipientName, 'Updated recipient');
    assert.deepEqual(applied.stops[1]?.coordinates, { latitude: 43.7, longitude: -79.4 });
    assert.equal(applied.stops[1]?.navigationTarget, 'COORDINATES');
    assert.equal(applied.stops[0]?.status, 'ARRIVED');
    assert.equal(applied.stops[0]?.estimatedArrivalAt, '2026-10-07T10:00:00.000Z');
    assert.equal(applied.stops[1]?.estimatedArrivalAt, null);
    assert.deepEqual(applied.stops[1]?.items, original.stops[1]?.items);
    assert.equal(applied.stops[1]?.totalPriceAmount, original.stops[1]?.totalPriceAmount);
    assert.equal(applied.stops[1]?.normalizedPaymentStatus, original.stops[1]?.normalizedPaymentStatus);
    assert.equal(applied.routeGeometry, null);
    assert.equal(applied.routeMetrics, null);
    assert.equal(applied.routeMapPreview, null);
    assert.equal(applied.etaSnapshot, null);
    assert.deepEqual(applied.routeStopPoints, []);
    assert.deepEqual(route, original);
  });

  it('uses publication order without relying on a later assigned-route response', () => {
    const value = publication();
    const stops = [...value.snapshot.stops].reverse().map((stop, index) => ({ ...stop, sequence: index + 1 }));
    const applied = applyLiveRoutePublication(sampleAssignedRoute, { ...value, snapshot: { ...value.snapshot, stops } });
    assert.deepEqual(applied.stops.map((stop) => stop.deliveryStopId), stops.map((stop) => stop.deliveryStopId));
    assert.deepEqual(applied.stops[0]?.items, sampleAssignedRoute.stops.at(-1)?.items);
  });

  it('clears stale navigation coordinates when the immutable stop has no coordinates', () => {
    const value = publication();
    const stops = value.snapshot.stops.map((stop) => ({ ...stop, latitude: null, longitude: null }));
    const applied = applyLiveRoutePublication(sampleAssignedRoute, { ...value, snapshot: { ...value.snapshot, stops } });
    assert.equal(applied.stops[0]?.coordinates, null);
    assert.equal(applied.stops[0]?.navigationTarget, 'ADDRESS');
  });

  it('rejects route and stop membership mismatches before changing local content', () => {
    const value = publication();
    assert.throws(() => applyLiveRoutePublication(sampleAssignedRoute, { ...value, routePlanId: publicationId }), /route/u);
    assert.throws(() => applyLiveRoutePublication(sampleAssignedRoute, {
      ...value, snapshot: { ...value.snapshot, stops: value.snapshot.stops.slice(1) },
    }), /membership/u);
  });

  it('refreshes execution status without silently applying a newer address, order or geometry', () => {
    const applied = applyLiveRoutePublication(sampleAssignedRoute, publication());
    const fresh = structuredClone(sampleAssignedRoute);
    fresh.stops[0]!.status = 'DELIVERED';
    fresh.stops[0]!.address.address1 = 'Newer unpublished-to-device address';
    fresh.stops.reverse();
    const merged = mergeLiveRouteExecutionState(applied, fresh);
    assert.equal(merged.stops[0]?.status, 'DELIVERED');
    assert.equal(merged.stops[0]?.address.address1, applied.stops[0]?.address.address1);
    assert.deepEqual(merged.stops.map((stop) => stop.deliveryStopId), applied.stops.map((stop) => stop.deliveryStopId));
    assert.equal(merged.routeGeometry, null);
    assert.throws(() => mergeLiveRouteExecutionState(applied, { ...fresh, stops: fresh.stops.slice(1) }), /membership/u);
  });

  it('retains queued local terminal progress until the server reports a terminal outcome', () => {
    for (const status of ['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED']) {
      const applied = structuredClone(sampleAssignedRoute);
      applied.stops[0]!.status = status;
      const fresh = structuredClone(sampleAssignedRoute);
      fresh.stops[0]!.status = 'ARRIVED';
      assert.equal(mergeLiveRouteExecutionState(applied, fresh).stops[0]?.status, status);
      fresh.stops[0]!.status = 'DELIVERED';
      assert.equal(mergeLiveRouteExecutionState(applied, fresh).stops[0]?.status, 'DELIVERED');
    }
  });

  it('refreshes payment and first receipt while retaining explicitly applied delivery content', () => {
    const applied = applyLiveRoutePublication(sampleAssignedRoute, publication());
    const fresh = structuredClone(sampleAssignedRoute);
    const payment: StopPayment = { method: 'CASH', methodTitle: 'Cash', gatewayNames: ['Cash'], financialStatus: 'PENDING',
      expectedAmount: '122.25', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING', requiresCashInput: true };
    const receipt: StopCompletion = { id: 'receipt', eventId: 'event', deliveryStopId: fresh.stops[0]!.deliveryStopId,
      routePlanId: fresh.id, driverId: 'driver', assignmentGeneration: '2', expectedRouteVersionId: publicationId,
      method: 'CASH', payment, expectedAmount: '122.25', actualAmount: '0.00', differenceAmount: '-122.25',
      currencyCode: 'CAD', occurredAt: '2026-10-08T07:00:00.000Z', recordedAt: '2026-10-08T07:00:01.000Z' };
    fresh.stops[0]!.payment = { ...payment, expectedAmount: '999.00' };
    fresh.stops[0]!.completion = receipt;
    fresh.stops[0]!.address.address1 = 'Not yet applied';
    const merged = mergeLiveRouteExecutionState(applied, fresh);
    assert.equal(merged.stops[0]?.payment?.expectedAmount, '999.00');
    assert.deepEqual(merged.stops[0]?.completion, receipt);
    assert.equal(merged.stops[0]?.address.address1, applied.stops[0]?.address.address1);
    // A legacy response must not enable the new contract, or erase an accepted receipt.
    delete fresh.stops[0]!.payment;
    fresh.stops[0]!.completion = null;
    const legacy = mergeLiveRouteExecutionState(merged, fresh);
    assert.equal(legacy.stops[0]?.payment, undefined);
    assert.deepEqual(legacy.stops[0]?.completion, receipt);
  });
});

describe('live route publication HTTP client', () => {
  it('GETs with route bearer and no-store, then ACKs the exact identity with the lifecycle signal', async () => {
    const requests: { url: string; init: unknown }[] = [];
    const signal = new AbortController().signal;
    const value = publication();
    const client = createLiveRouteChangeApiClient({
      baseUrl: 'https://delivery.example.com/', accessToken: 'route-bearer',
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: value, error: null }) };
      },
    });
    assert.deepEqual(await client.getLiveRouteChange({ routePlanId: value.routePlanId }, { signal }), value);
    await client.acknowledgeLiveRouteChange({
      routePlanId: value.routePlanId, publicationVersionId: value.publicationVersionId, assignmentGeneration: value.assignmentGeneration,
    }, { signal });
    assert.deepEqual(requests[0], {
      url: `https://delivery.example.com/driver/routes/${value.routePlanId}/live-change`,
      init: { method: 'GET', signal, cache: 'no-store', credentials: 'omit', headers: {
        'Cache-Control': 'no-store', Pragma: 'no-cache', Authorization: 'Bearer route-bearer',
      } },
    });
    const ack = requests[1]!.init as { body: string; signal: AbortSignal; method: string };
    assert.equal(ack.method, 'POST');
    assert.equal(ack.signal, signal);
    assert.deepEqual(JSON.parse(ack.body), { publicationVersionId: value.publicationVersionId, assignmentGeneration: '2' });
  });

  it('allows unenrolled GET data null but rejects null ACK and mismatched route responses', async () => {
    let data: unknown = null;
    const client = createLiveRouteChangeApiClient({
      baseUrl: 'https://delivery.example.com', accessToken: 'route-bearer',
      fetchImpl: async () => ({ ok: true, json: async () => ({ data, error: null }) }),
    });
    assert.equal(await client.getLiveRouteChange({ routePlanId: sampleAssignedRoute.id }), null);
    await assert.rejects(client.acknowledgeLiveRouteChange({
      routePlanId: sampleAssignedRoute.id, publicationVersionId: publicationId, assignmentGeneration: '2',
    }), /Invalid live route publication/u);
    data = { ...publication(), routePlanId: publicationId };
    await assert.rejects(client.getLiveRouteChange({ routePlanId: sampleAssignedRoute.id }), /route/u);
  });

  it('preserves server error status and code for reconciliation and never treats an error envelope as success', async () => {
    let ok = false;
    const client = createLiveRouteChangeApiClient({
      baseUrl: 'https://delivery.example.com', accessToken: 'route-bearer',
      fetchImpl: async () => ({ ok, status: ok ? 200 : 409, json: async () => ({ data: null, error: { code: 'ASSIGNMENT_CHANGED' } }) }),
    });
    await assert.rejects(client.getLiveRouteChange({ routePlanId: sampleAssignedRoute.id }), (error: unknown) => (
      error instanceof DriverApiHttpError && error.status === 409 && error.code === 'ASSIGNMENT_CHANGED'
    ));
    ok = true;
    await assert.rejects(client.getLiveRouteChange({ routePlanId: sampleAssignedRoute.id }), DriverApiHttpError);
  });

  it('rejects missing success envelopes and cross-assignment ACK responses', async () => {
    let payload: unknown = { data: publication() };
    const client = createLiveRouteChangeApiClient({
      baseUrl: 'https://delivery.example.com', accessToken: 'route-bearer',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
    });
    await assert.rejects(client.getLiveRouteChange({ routePlanId: sampleAssignedRoute.id }));
    payload = { data: { ...publication(), assignmentGeneration: '3' }, error: null };
    await assert.rejects(client.acknowledgeLiveRouteChange({
      routePlanId: sampleAssignedRoute.id, publicationVersionId: publicationId, assignmentGeneration: '2',
    }), /another assignment/u);
  });

  it('rejects malformed command identities before making a network request', async () => {
    let calls = 0;
    const client = createLiveRouteChangeApiClient({
      baseUrl: 'https://delivery.example.com', accessToken: 'route-bearer',
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ data: publication(), error: null }) };
      },
    });
    await assert.rejects(client.getLiveRouteChange({ routePlanId: '../another-route' }));
    await assert.rejects(client.acknowledgeLiveRouteChange({
      routePlanId: sampleAssignedRoute.id, publicationVersionId: publicationId, assignmentGeneration: '0',
    }));
    assert.equal(calls, 0);
  });
});
