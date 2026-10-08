import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProofMediaUploadResult } from '../domain/proof/proofMediaUpload';
import { isProofPhotoLeaseCurrent, preserveScopedProofPhoto, runProofPhotoOperation } from './proofPhotoOperation';
import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { createLiveRouteChangeStore, emptyLiveRouteChangeState } from '../domain/route/liveRouteChangeStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}
const failed: ProofMediaUploadResult = { kind: 'upload_failed', message: 'offline' };

describe('proof photo asynchronous scope', () => {
  for (const transition of ['account switch', 'same-route reassignment', 'selecting another route']) {
    it(`preserves the original capture but blocks late UI and queue writes after ${transition}`, async () => {
      const captured = { accountOwnerHash: 'a'.repeat(64), accountEpoch: 1, routePlanId: 'route', assignmentGeneration: '2' };
      let current = { ...captured };
      const upload = deferred<ProofMediaUploadResult>();
      const started = deferred<void>();
      const durable: (ProofMediaUploadResult | undefined)[] = [];
      let projected = 0;
      let queued = 0;
      const running = runProofPhotoOperation({
        isCurrent: () => isProofPhotoLeaseCurrent(captured, current),
        preserve: async result => { durable.push(result); },
        onCaptured: () => { projected += 1; },
        upload: () => { started.resolve(); return upload.promise; },
        onUploaded: () => { projected += 1; },
        onRetryRequired: async () => { queued += 1; },
      });
      await started.promise;
      assert.deepEqual(durable, [undefined]);
      current = transition === 'account switch' ? { ...current, accountOwnerHash: 'b'.repeat(64), accountEpoch: 2 }
        : transition === 'same-route reassignment' ? { ...current, assignmentGeneration: '3' }
          : { ...current, routePlanId: 'another-route' };
      upload.resolve(failed);
      assert.equal(await running, null);
      assert.deepEqual(durable, [undefined, failed]);
      assert.equal(projected, 1);
      assert.equal(queued, 0);
    });
  }

  it('does not upload a late picker result after the assignment changed', async () => {
    let preserved = 0;
    let uploads = 0;
    const result = await runProofPhotoOperation({ isCurrent: () => false,
      preserve: async () => { preserved += 1; }, onCaptured: () => assert.fail('stale capture projection'),
      upload: async () => { uploads += 1; return failed; }, onUploaded: () => assert.fail('stale upload projection'),
      onRetryRequired: async () => assert.fail('stale queue mutation') });
    assert.equal(result, null);
    assert.equal(preserved, 1);
    assert.equal(uploads, 0);
  });

  it('does not start an upload before the captured photo is durably stored', async () => {
    let uploaded = false;
    await assert.rejects(runProofPhotoOperation({ isCurrent: () => true,
      preserve: async () => { throw new Error('storage full'); }, onCaptured: () => {},
      upload: async () => { uploaded = true; return failed; }, onUploaded: () => {}, onRetryRequired: async () => {} }), /storage full/u);
    assert.equal(uploaded, false);
  });

  it('stores a late photo only under its original owner and assignment and retains existing notes', async () => {
    const envelopes = new Map<string, string>();
    const store = createLiveRouteChangeStore({ readLiveRouteChangeState: async owner => envelopes.get(owner) ?? null,
      removeLiveRouteChangeState: async owner => { envelopes.delete(owner); },
      updateLiveRouteChangeState: async (owner, mutate) => { const raw = mutate(envelopes.get(owner) ?? null); envelopes.set(owner, raw); return raw; } });
    const ownerA = 'a'.repeat(64); const ownerB = 'b'.repeat(64);
    const route = sampleAssignedRoute;
    const stopId = route.stops[0]!.deliveryStopId;
    const state = { ...emptyLiveRouteChangeState(route.id, '2'), appliedRoute: route };
    const uiDraft = { currentStopId: stopId, selectedStopDetailsId: stopId,
      proofDrafts: { [stopId]: { todayNote: 'original notes', additionalNotes: '', locationTip: '' } }, proofPhotoResults: {}, proofMediaResults: {} };
    await store.update(ownerA, route.id, '2', () => ({ ...state, uiDraft }));
    const capture = { kind: 'captured' as const, source: 'camera' as const, uri: 'file:///original.jpg' };
    await preserveScopedProofPhoto({ store, accountOwnerHash: ownerA, state, uiDraft, stopId, capture, result: failed });
    assert.equal((await store.read(ownerA, route.id, '2'))?.uiDraft?.proofPhotoResults[stopId]?.kind, 'captured');
    assert.equal((await store.read(ownerA, route.id, '2'))?.uiDraft?.proofDrafts[stopId]?.todayNote, 'original notes');
    assert.equal(await store.read(ownerA, route.id, '3'), null);
    assert.equal(await store.read(ownerB, route.id, '2'), null);
  });

  it('does not recreate deleted account evidence when a photo result arrives late', async () => {
    const envelopes = new Map<string, string>();
    const store = createLiveRouteChangeStore({ readLiveRouteChangeState: async owner => envelopes.get(owner) ?? null,
      removeLiveRouteChangeState: async owner => { envelopes.delete(owner); },
      updateLiveRouteChangeState: async (owner, mutate) => { const raw = mutate(envelopes.get(owner) ?? null); envelopes.set(owner, raw); return raw; } });
    const owner = 'a'.repeat(64); const route = sampleAssignedRoute; const stopId = route.stops[0]!.deliveryStopId;
    const state = { ...emptyLiveRouteChangeState(route.id, '2'), appliedRoute: route };
    await store.update(owner, route.id, '2', () => state);
    await store.removeAccount(owner);
    await assert.rejects(preserveScopedProofPhoto({ store, accountOwnerHash: owner, state, stopId,
      uiDraft: { currentStopId: stopId, selectedStopDetailsId: null, proofDrafts: {}, proofPhotoResults: {}, proofMediaResults: {} },
      capture: { kind: 'captured', source: 'camera', uri: 'file:///removed-account.jpg' }, result: failed }), /no longer available/u);
    assert.equal(await store.read(owner, route.id, '2'), null);
  });

  it('keeps a newer photo when the superseded capture returns late in the same assignment', async () => {
    const envelopes = new Map<string, string>();
    const store = createLiveRouteChangeStore({ readLiveRouteChangeState: async owner => envelopes.get(owner) ?? null,
      removeLiveRouteChangeState: async owner => { envelopes.delete(owner); },
      updateLiveRouteChangeState: async (owner, mutate) => { const raw = mutate(envelopes.get(owner) ?? null); envelopes.set(owner, raw); return raw; } });
    const owner = 'a'.repeat(64); const route = sampleAssignedRoute; const stopId = route.stops[0]!.deliveryStopId;
    const uiDraft = { currentStopId: stopId, selectedStopDetailsId: null, proofDrafts: {}, proofPhotoResults: {}, proofMediaResults: {} };
    const state = { ...emptyLiveRouteChangeState(route.id, '2'), appliedRoute: route, uiDraft };
    const capture = { kind: 'captured' as const, source: 'camera' as const, uri: 'file:///older.jpg' };
    await store.update(owner, route.id, '2', () => ({ ...state, uiDraft: { ...uiDraft,
      proofPhotoResults: { [stopId]: { ...capture, uri: 'file:///newer.jpg' } } } }));
    await preserveScopedProofPhoto({ store, accountOwnerHash: owner, state, stopId, uiDraft, capture, result: failed });
    const saved = (await store.read(owner, route.id, '2'))?.uiDraft?.proofPhotoResults[stopId];
    assert.equal(saved?.kind === 'captured' ? saved.uri : null, 'file:///newer.jpg');
    assert.equal((await store.read(owner, route.id, '2'))?.uiDraft?.proofMediaResults[stopId], undefined);
  });

  it('does not restore a replacement photo with the previous uploaded media after a crash before upload finishes', async () => {
    const envelopes = new Map<string, string>();
    const storage = { readLiveRouteChangeState: async (owner: string) => envelopes.get(owner) ?? null,
      removeLiveRouteChangeState: async (owner: string) => { envelopes.delete(owner); },
      updateLiveRouteChangeState: async (owner: string, mutate: (raw: string | null) => string) => {
        const raw = mutate(envelopes.get(owner) ?? null); envelopes.set(owner, raw); return raw;
      } };
    const store = createLiveRouteChangeStore(storage);
    const owner = 'a'.repeat(64); const route = sampleAssignedRoute; const stopId = route.stops[0]!.deliveryStopId;
    const original = { kind: 'captured' as const, source: 'camera' as const, uri: 'file:///original.jpg' };
    const uploaded: ProofMediaUploadResult = { kind: 'uploaded', media: { contentType: 'image/jpeg', kind: 'photo',
      mediaId: 'original-media', source: 'camera', storageKey: 'original-proof.jpg', uploadedAt: '2026-10-08T00:00:00.000Z' } };
    const uiDraft = { currentStopId: stopId, selectedStopDetailsId: null, proofDrafts: {},
      proofPhotoResults: { [stopId]: original }, proofMediaResults: { [stopId]: uploaded } };
    const state = { ...emptyLiveRouteChangeState(route.id, '2'), appliedRoute: route, uiDraft };
    await store.update(owner, route.id, '2', () => state);

    // Re-preserving the same photo keeps its matching uploaded media.
    await preserveScopedProofPhoto({ store, accountOwnerHash: owner, state, stopId, uiDraft, capture: original });
    assert.deepEqual((await store.read(owner, route.id, '2'))?.uiDraft?.proofMediaResults[stopId], uploaded);

    await preserveScopedProofPhoto({ store, accountOwnerHash: owner, state, stopId, uiDraft,
      capture: { ...original, uri: 'file:///replacement.jpg' } });
    const restarted = createLiveRouteChangeStore(storage);
    const restored = (await restarted.read(owner, route.id, '2'))?.uiDraft;
    assert.equal(restored?.proofPhotoResults[stopId]?.kind === 'captured' ? restored.proofPhotoResults[stopId].uri : null, 'file:///replacement.jpg');
    assert.equal(restored?.proofMediaResults[stopId], undefined);
  });
});
