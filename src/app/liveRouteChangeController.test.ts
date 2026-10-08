import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import type { LiveRoutePublication, LiveRouteChangeService } from '../domain/route/liveRouteChange';
import { emptyLiveRouteChangeState, type LiveRouteChangeState, type LiveRouteChangeStore } from '../domain/route/liveRouteChangeStore';
import { applyLiveRouteChange, hasPendingLiveRouteChange, retryLiveRouteAcknowledgement, stageLiveRouteRefresh, preserveLiveRouteStep, getLiveRouteRecoveryProgress, shouldCheckLiveRouteChange } from './liveRouteChangeController';

const id = sampleAssignedRoute.id;
const owner = 'a'.repeat(64);
function publication(sequence = 1): LiveRoutePublication {
  return { routePlanId: id, assignmentGeneration: '2', publicationVersionId: `90000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`, sequence,
    publishedAt: '2026-10-07T10:00:00.000Z', appliedVersionId: null, pending: sequence > 0,
    snapshot: { schemaVersion: 1, stops: sampleAssignedRoute.stops.map((stop, index) => ({
      routePlanStopId: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, deliveryStopId: stop.deliveryStopId,
      orderId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, sourceOrderId: null,
      sequence: stop.sequence, recipientName: stop.recipientName, phone: stop.phone, ...stop.address,
      address1: index === 1 ? `Publication ${sequence}` : stop.address.address1, instructions: null,
      latitude: stop.coordinates?.latitude.toString() ?? null, longitude: stop.coordinates?.longitude.toString() ?? null,
      serviceMinutes: 5, timeWindowStart: null, timeWindowEnd: null,
    })) } };
}
function baseline(): LiveRouteChangeState {
  return { ...emptyLiveRouteChangeState(id, '2'), appliedRoute: structuredClone(sampleAssignedRoute), appliedPublicationVersionId: '60000000-0000-4000-8000-000000000001' };
}
function memoryStore(initial = baseline()) {
  let state = initial;
  const store: LiveRouteChangeStore = { read: async () => structuredClone(state), list: async () => [structuredClone(state)], removeAccount: async () => {},
    update: async (_owner, _route, _generation, mutate) => { state = structuredClone(mutate(structuredClone(state))); return structuredClone(state); } };
  return { store, current: () => state };
}
const identity = { accountOwnerHash: owner, routePlanId: id, assignmentGeneration: '2' };

describe('live route apply boundary', () => {
  it('captures READY baseline without GET and checks only active KFood assignments', () => {
    assert.equal(shouldCheckLiveRouteChange('7hrud1-xq.myshopify.com', 'READY', false), false);
    assert.equal(shouldCheckLiveRouteChange('7hrud1-xq.myshopify.com', 'READY', true), true);
    assert.equal(shouldCheckLiveRouteChange('7hrud1-xq.myshopify.com', 'IN_PROGRESS', false), true);
    assert.equal(shouldCheckLiveRouteChange('7hrud1-xq.myshopify.com', 'COMPLETED', false), false);
    assert.equal(shouldCheckLiveRouteChange('dsv.example.com', 'IN_PROGRESS', true), false);
    const cached = stageLiveRouteRefresh({ state: null, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: baseline().appliedPublicationVersionId!, publication: null });
    assert.deepEqual(cached.appliedRoute, sampleAssignedRoute);
    assert.equal(hasPendingLiveRouteChange(cached), false);
  });
  it('baseline enrollment leaves geometry, ETA and the existing event version unchanged', () => {
    const value = publication(0);
    const eventVersion = baseline().appliedPublicationVersionId!;
    const state = stageLiveRouteRefresh({ state: null, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: eventVersion, publication: value });
    assert.deepEqual(state.appliedRoute, sampleAssignedRoute);
    assert.equal(state.appliedPublicationVersionId, eventVersion);
    assert.equal(state.appliedPublicationSequence, 0);
  });

  it('all refresh entry points preserve applied addresses while updating execution only', () => {
    for (const trigger of ['push', 'foreground', 'network', 'pull', 'restart', 'eta_recovery']) {
      const fresh = structuredClone(sampleAssignedRoute);
      fresh.stops[1]!.address.address1 = 'Leaked latest';
      fresh.stops[0]!.status = 'DELIVERED';
      const next = stageLiveRouteRefresh({ state: baseline(), route: fresh, assignmentGeneration: '2', expectedRouteVersionId: publication().publicationVersionId, publication: publication() });
      assert.equal(next.appliedRoute?.stops[1]?.address.address1, sampleAssignedRoute.stops[1]!.address.address1);
      assert.equal(next.appliedRoute?.stops[0]?.status, 'DELIVERED');
      assert.equal(hasPendingLiveRouteChange(next), true, trigger);
    }
  });
  it('restores execution from private fresh stops without exposing their unpublished-to-device addresses', () => {
    const fresh = structuredClone(sampleAssignedRoute);
    fresh.stops[0]!.status = 'DELIVERED';
    fresh.stops[1]!.status = 'ARRIVED';
    const hidden = { ...fresh, stops: [] };
    const progress = getLiveRouteRecoveryProgress(hidden, fresh);
    assert.deepEqual(progress.completedStopIds, [fresh.stops[0]!.deliveryStopId]);
    assert.equal(progress.navigationStepIndex, 2);
    assert.equal(hidden.stops.length, 0);
    assert.equal(preserveLiveRouteStep(fresh, fresh.stops[progress.navigationStepIndex - 1]!.deliveryStopId, progress.navigationStepIndex), 2);
  });
  it('requires explicit recovery Apply when pending publication has no cached prior content', () => {
    const next = stageLiveRouteRefresh({ state: null, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: publication().publicationVersionId, publication: publication() });
    assert.equal(next.appliedRoute, null);
    assert.equal(hasPendingLiveRouteChange(next), true);
  });
  it('accepts a clean baseline but does not auto-apply a newer publication already ACKed elsewhere', () => {
    const first = stageLiveRouteRefresh({ state: null, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: publication(0).publicationVersionId, publication: publication(0) });
    assert.ok(first.appliedRoute);
    const value = { ...publication(), pending: false, appliedVersionId: publication().publicationVersionId };
    const second = stageLiveRouteRefresh({ state: first, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: value.publicationVersionId, publication: value });
    assert.notEqual(second.appliedPublicationVersionId, value.publicationVersionId);
    assert.equal(hasPendingLiveRouteChange(second), true);
  });
  it('persists exact N before exposing it and leaves N+1 pending after ACK', async () => {
    const memory = memoryStore();
    const n = publication(); const newer = publication(2);
    let projected = false;
    const service: LiveRouteChangeService = { getLiveRouteChange: async () => n, acknowledgeLiveRouteChange: async request => {
      assert.equal(request.publicationVersionId, n.publicationVersionId);
      assert.equal(projected, true);
      return { ...newer, appliedVersionId: n.publicationVersionId };
    } };
    const next = await applyLiveRouteChange({ ...identity, store: memory.store, baseRoute: sampleAssignedRoute, service, isCurrent: () => true,
      onApplied: state => { assert.equal(memory.current().ackPendingPublicationVersionId, n.publicationVersionId); assert.equal(state.appliedRoute!.stops[1]!.address.address1, 'Publication 1'); projected = true; } });
    assert.equal(next.appliedPublicationVersionId, n.publicationVersionId);
    assert.equal(next.pendingPublication?.publicationVersionId, newer.publicationVersionId);
    assert.equal(hasPendingLiveRouteChange(next), true);
  });
  it('retains exact applied content across lost ACK and retries without applying the newer route', async () => {
    const memory = memoryStore(); let fails = true;
    const service: LiveRouteChangeService = { getLiveRouteChange: async () => publication(), acknowledgeLiveRouteChange: async request => {
      if (fails) throw new Error('offline');
      assert.equal(request.publicationVersionId, publication().publicationVersionId);
      return { ...publication(2), appliedVersionId: request.publicationVersionId };
    } };
    await assert.rejects(applyLiveRouteChange({ ...identity, store: memory.store, baseRoute: sampleAssignedRoute, service, isCurrent: () => true, onApplied: () => {} }), /offline/u);
    assert.equal(memory.current().ackPendingPublicationVersionId, publication().publicationVersionId);
    fails = false;
    const restored = await retryLiveRouteAcknowledgement({ ...identity, store: memory.store, service, isCurrent: () => true });
    assert.equal(restored!.appliedRoute!.stops[1]!.address.address1, 'Publication 1');
    assert.equal(restored!.ackPendingPublicationVersionId, null);
    assert.equal(hasPendingLiveRouteChange(restored!), true);
  });
  it('does not save or project a response after account or assignment scope changes', async () => {
    const memory = memoryStore(); let current = true;
    const service: LiveRouteChangeService = { getLiveRouteChange: async () => { current = false; return publication(); }, acknowledgeLiveRouteChange: async () => { throw new Error('unexpected ACK'); } };
    await assert.rejects(applyLiveRouteChange({ ...identity, store: memory.store, baseRoute: sampleAssignedRoute, service, isCurrent: () => current, onApplied: () => assert.fail('stale projection') }), /changed/u);
    assert.equal(memory.current().pendingPublication, null);
  });
  it('ignores old poll results and preserves the selected current stop by ID after reorder', () => {
    const state = { ...baseline(), pendingPublication: publication(2) };
    const next = stageLiveRouteRefresh({ state, route: sampleAssignedRoute, assignmentGeneration: '2', expectedRouteVersionId: publication().publicationVersionId, publication: publication() });
    assert.equal(next.pendingPublication?.sequence, 2);
    const reordered = { ...sampleAssignedRoute, stops: [...sampleAssignedRoute.stops].reverse() };
    assert.equal(preserveLiveRouteStep(reordered, sampleAssignedRoute.stops[0]!.deliveryStopId, 1), reordered.stops.length);
    assert.equal(preserveLiveRouteStep(reordered, null, 0), 0);
  });
});
