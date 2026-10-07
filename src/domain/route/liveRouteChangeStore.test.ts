import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from './assignedRoute';
import type { LiveRoutePublication } from './liveRouteChange';
import {
  createLiveRouteChangeStore as createStore,
  emptyLiveRouteChangeState,
  type LiveRouteChangeRawStorage,
  type LiveRouteChangeState,
} from './liveRouteChangeStore';

const ownerA = 'a'.repeat(64);
const ownerB = 'b'.repeat(64);
const routeId = sampleAssignedRoute.id;
const versionN = '90000000-0000-4000-8000-000000000001';
const versionNext = '90000000-0000-4000-8000-000000000002';
const fixedTime = '2026-10-07T10:00:00.000Z';
const createLiveRouteChangeStore = (storage: LiveRouteChangeRawStorage) => createStore(storage, { now: () => new Date(fixedTime) });

function memoryStorage() {
  const values = new Map<string, string>();
  let rejectWrites = false;
  const storage: LiveRouteChangeRawStorage = {
    readLiveRouteChangeState: async (owner) => values.get(owner) ?? null,
    removeLiveRouteChangeState: async (owner) => { values.delete(owner); },
    updateLiveRouteChangeState: async (owner, mutate) => {
      const next = mutate(values.get(owner) ?? null);
      if (rejectWrites) throw new Error('storage full');
      values.set(owner, next);
      return next;
    },
  };
  return { storage, values, rejectWrites: () => { rejectWrites = true; } };
}

function pendingPublication(sequence: number): LiveRoutePublication {
  return {
    routePlanId: routeId, assignmentGeneration: '2', sequence,
    publicationVersionId: sequence === 1 ? versionN : versionNext,
    appliedVersionId: null, publishedAt: '2026-10-07T10:00:00.000Z', pending: true,
    snapshot: { schemaVersion: 1, stops: [] },
  };
}

function appliedState(): LiveRouteChangeState {
  const stopId = sampleAssignedRoute.stops[0]!.deliveryStopId;
  return {
    ...emptyLiveRouteChangeState(routeId, '2'),
    updatedAt: fixedTime,
    appliedRoute: sampleAssignedRoute,
    appliedPublicationVersionId: versionN,
    appliedPublicationSequence: 1,
    ackPendingPublicationVersionId: versionN,
    pendingPublication: pendingPublication(2),
    uiDraft: {
      currentStopId: stopId, selectedStopDetailsId: stopId,
      proofDrafts: { [stopId]: { additionalNotes: 'keep note', locationTip: '', todayNote: 'front door' } },
      proofPhotoResults: { [stopId]: { kind: 'captured', source: 'camera', uri: 'file:///proof.jpg' } },
      proofMediaResults: {},
    },
  };
}

describe('live route change durable state', () => {
  it('restores exact applied N, outstanding ACK N and newer pending N+1 with proof drafts after restart', async () => {
    const memory = memoryStorage();
    const first = createLiveRouteChangeStore(memory.storage);
    assert.equal(await first.read(ownerA, routeId, '2'), null);
    await first.update(ownerA, routeId, '2', () => appliedState());
    const restarted = createLiveRouteChangeStore(memory.storage);
    const state = await restarted.read(ownerA, routeId, '2');
    assert.deepEqual(state, appliedState());
    assert.equal(state?.ackPendingPublicationVersionId, versionN);
    assert.equal(state?.pendingPublication?.publicationVersionId, versionNext);
    assert.equal(state?.appliedRoute?.stops[0]?.address.address1, sampleAssignedRoute.stops[0]?.address.address1);
  });

  it('isolates accounts, routes and assignment generations without losing the old ACK evidence', async () => {
    const memory = memoryStorage();
    const store = createLiveRouteChangeStore(memory.storage);
    await store.update(ownerA, routeId, '2', () => appliedState());
    await store.update(ownerA, routeId, '3', () => emptyLiveRouteChangeState(routeId, '3'));
    await store.update(ownerB, routeId, '2', () => emptyLiveRouteChangeState(routeId, '2'));
    assert.equal((await store.read(ownerA, routeId, '2'))?.ackPendingPublicationVersionId, versionN);
    assert.equal((await store.read(ownerA, routeId, '3'))?.appliedRoute, null);
    assert.equal((await store.read(ownerB, routeId, '2'))?.appliedRoute, null);
    assert.equal(await store.read(ownerA, versionN, '2'), null);
    await store.removeAccount(ownerB);
    assert.equal((await store.list(ownerA)).length, 2);
    assert.equal((await store.list(ownerB)).length, 0);
  });

  it('does not publish a state transition when the durable write fails', async () => {
    const memory = memoryStorage();
    const store = createLiveRouteChangeStore(memory.storage);
    await store.update(ownerA, routeId, '2', () => appliedState());
    memory.rejectWrites();
    await assert.rejects(store.update(ownerA, routeId, '2', (current) => ({
      ...current!, ackPendingPublicationVersionId: null,
    })), /storage full/u);
    assert.equal((await store.read(ownerA, routeId, '2'))?.ackPendingPublicationVersionId, versionN);
  });

  it('rejects another owner or route and malformed cached route without deleting evidence', async () => {
    const memory = memoryStorage();
    const store = createLiveRouteChangeStore(memory.storage);
    await store.update(ownerA, routeId, '2', () => appliedState());
    const original = memory.values.get(ownerA)!;
    memory.values.set(ownerB, original);
    await assert.rejects(store.read(ownerB, routeId, '2'), /account/u);
    await assert.rejects(store.update(ownerA, routeId, '2', () => ({ ...appliedState(), routePlanId: versionN })), /another route/u);
    memory.values.set(ownerA, original.replace('"stops":[', '"stops":[null,'));
    await assert.rejects(store.read(ownerA, routeId, '2'), /route/u);
    assert.ok(memory.values.get(ownerA));
  });

  it('rejects cursor regression and an ACK for a version that was never applied', async () => {
    const memory = memoryStorage();
    const store = createLiveRouteChangeStore(memory.storage);
    await store.update(ownerA, routeId, '2', () => appliedState());
    await assert.rejects(store.update(ownerA, routeId, '2', (state) => ({
      ...state!, pendingPublication: pendingPublication(1),
    })), /older publication/u);
    await assert.rejects(store.update(ownerA, routeId, '2', (state) => ({
      ...state!, appliedPublicationSequence: 0,
    })), /applied publication/u);
    await assert.rejects(store.update(ownerA, routeId, '2', (state) => ({
      ...state!, ackPendingPublicationVersionId: versionNext,
    })), /ACK/u);
    assert.deepEqual(await store.read(ownerA, routeId, '2'), appliedState());
  });

  it('prunes only resolved idle route caches after thirty days and retains pending ACK and unfinished proof', async () => {
    const memory = memoryStorage();
    const store = createLiveRouteChangeStore(memory.storage);
    const settled = { ...appliedState(), ackPendingPublicationVersionId: null, pendingPublication: null, uiDraft: null };
    await store.update(ownerA, routeId, '2', () => settled);
    await store.update(ownerB, routeId, '2', () => appliedState());
    await store.update(ownerA, routeId, '3', () => ({
      ...settled, assignmentGeneration: '3', uiDraft: appliedState().uiDraft,
    }));
    const restarted = createStore(memory.storage, { now: () => new Date('2026-11-07T10:00:00.000Z') });
    assert.equal(await restarted.read(ownerA, routeId, '2'), null);
    assert.equal((await restarted.read(ownerB, routeId, '2'))?.ackPendingPublicationVersionId, versionN);
    assert.ok((await restarted.read(ownerA, routeId, '3'))?.uiDraft);
    assert.equal(JSON.parse(memory.values.get(ownerA)!).entries.length, 1);
  });
});
