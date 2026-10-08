import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMockDriverEventService } from '../events/driverEvents';
import { createMockProofMediaUploadService, getProofMediaUploadIdempotencyKey, uploadCapturedProofPhoto } from '../proof/proofMediaUpload';
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  resolveProofMediaUploadIdempotencyKey,
  retryOfflineSubmissions,
} from './offlineSubmissionQueue';

const owner = 'a'.repeat(64);
const request = { deliveryStopId: 'stop', fileName: 'proof.jpg', routePlanId: 'route', source: 'camera' as const, uri: 'file:///proof.jpg' };
const access = { routePlanId: 'route', assignmentGeneration: '3', driverContractVersion: 2, expectedRouteVersionId: 'version' };

describe('offline proof-media assignment scope', () => {
  it('uses one retained legacy key for initial upload and retry while a fresh generation gets a different stable key', async () => {
    const now = () => new Date('2026-10-08T11:00:00.000Z');
    const legacyId = 'proof-media:route:stop:proof.jpg';
    let raw: string | null = JSON.stringify({ version: 2, items: [{
      accountOwnerHash: owner, assignmentGeneration: '2', attempts: 0,
      enqueuedAt: now().toISOString(), journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
      kind: 'proof_media', queueItemId: legacyId, queueSequence: 1, request, state: 'PENDING',
    }] });
    const storage = { getItem: async () => raw, setItem: async (_key: string, value: string) => { raw = value; }, removeItem: async () => { raw = null; } };
    const openQueue = () => createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, now, storage });
    const queue = await openQueue();
    const keys: string[] = [];
    const initialUpload = async (assignmentGeneration: string) => {
      const initialKey = resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue, request, scope: { assignmentGeneration } });
      return uploadCapturedProofPhoto({
        captureResult: { kind: 'captured', source: request.source, uri: request.uri },
        uploadRequest: { deliveryStopId: request.deliveryStopId, fileName: request.fileName, routePlanId: request.routePlanId },
        uploadService: { uploadProofMedia: async () => {
          keys.push(initialKey);
          throw new Error('initial upload response lost');
        } },
      });
    };
    assert.equal((await initialUpload('2')).kind, 'upload_failed');
    assert.equal(queue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' }).queueItemId, legacyId);
    const replay = (targetQueue: typeof queue, assignmentGeneration: string) => retryOfflineSubmissions({
      queue: targetQueue, now, orderedEventAccessIdentity: { ...access, assignmentGeneration },
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async (value, options) => {
        keys.push(options?.idempotencyKey ?? '');
        return createMockProofMediaUploadService().uploadProofMedia(value);
      } },
    });
    assert.equal((await replay(queue, '2')).succeeded, 1);
    assert.equal((await initialUpload('3')).kind, 'upload_failed');
    const current = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    await queue.whenPersisted();
    assert.equal((await replay(await openQueue(), '3')).succeeded, 1);
    const legacyKey = getProofMediaUploadIdempotencyKey(request);
    const freshKey = getProofMediaUploadIdempotencyKey(request, { assignmentGeneration: '3' });
    assert.deepEqual(keys, [legacyKey, legacyKey, freshKey, freshKey]);
    assert.notEqual(freshKey, legacyKey);
    assert.notEqual(current.queueItemId, legacyId);
  });

  it('reads each retained same-generation state without changing its identity, key or queue contents', () => {
    const scope = { assignmentGeneration: '2' };
    for (const state of ['PENDING', 'QUARANTINED', 'ACKNOWLEDGED', 'DISCARDED'] as const) {
      const legacy = {
        accountOwnerHash: owner, assignmentGeneration: '2', attempts: 1,
        enqueuedAt: '2026-10-08T11:00:00.000Z', journal: [], kind: 'proof_media' as const,
        queueItemId: 'proof-media:route:stop:proof.jpg', queueSequence: 1, request, state,
      };
      const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner, initialItems: [legacy] });
      const before = JSON.stringify(legacy);
      assert.strictEqual(queue.findProofMediaUpload(request, scope), legacy);
      assert.equal(resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue, request, scope }), getProofMediaUploadIdempotencyKey(request));
      assert.equal(JSON.stringify(legacy), before);
      assert.strictEqual(queue.enqueueProofMediaUpload(request, scope), legacy);
    }
  });

  it('ignores another owner and creates no evidence while resolving the key for a fresh initial upload', () => {
    const scope = { assignmentGeneration: '3' };
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    const freshKey = getProofMediaUploadIdempotencyKey(request, scope);
    assert.equal(resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue, request, scope }), freshKey);
    assert.equal(queue.findProofMediaUpload(request, scope), undefined);
    assert.deepEqual(queue.listPending(), []);
    const retained = queue.enqueueProofMediaUpload(request, scope);
    assert.equal(resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue, request, scope }), retained.idempotencyKey);
    const foreignOwner = 'b'.repeat(64);
    const foreignQueue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: foreignOwner, initialItems: [{
      accountOwnerHash: foreignOwner, assignmentGeneration: '3', attempts: 0,
      enqueuedAt: '2026-10-08T11:00:00.000Z', journal: [], kind: 'proof_media',
      queueItemId: 'proof-media:route:stop:proof.jpg', queueSequence: 1, request, state: 'PENDING',
    }] });
    assert.notEqual(freshKey, getProofMediaUploadIdempotencyKey(request));
    assert.equal(resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue: foreignQueue, request, scope }), freshKey);
    queue.bindAccountOwnerHash(foreignOwner);
    assert.equal(resolveProofMediaUploadIdempotencyKey({ accountOwnerHash: owner, queue, request, scope }), freshKey);
    assert.equal(queue.findProofMediaUpload(request, scope), undefined);
  });

  it('retries a new assignment photo when the same account, route, stop and file still have an older photo', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    const original = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' });
    const originalIdentity = { queueItemId: original.queueItemId, queueSequence: original.queueSequence, request: { ...original.request } };
    const current = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    const uploads: unknown[] = [];
    const result = await retryOfflineSubmissions({
      queue, routePlanId: request.routePlanId, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async value => { uploads.push(value); return createMockProofMediaUploadService().uploadProofMedia(value); } },
    });

    assert.deepEqual(uploads, [request]);
    assert.equal(result.succeeded, 1);
    assert.equal(result.blocked, 1);
    assert.notEqual(current.queueItemId, originalIdentity.queueItemId);
    assert.equal(current.assignmentGeneration, '3');
    assert.equal(original.assignmentGeneration, '2');
    assert.deepEqual({ queueItemId: original.queueItemId, queueSequence: original.queueSequence, request: original.request }, originalIdentity);
    assert.equal(original.state, 'QUARANTINED');
    assert.equal(current.state, 'ACKNOWLEDGED');
  });

  it('deduplicates each generation after store recreation without replacing a pre-fix photo identity or retry key', async () => {
    const now = () => new Date('2026-10-08T10:00:00.000Z');
    const legacyId = 'proof-media:route:stop:proof.jpg';
    let raw: string | null = JSON.stringify({ version: 2, items: [{
      accountOwnerHash: owner, assignmentGeneration: '2', attempts: 0,
      enqueuedAt: now().toISOString(), journal: [{ at: now().toISOString(), code: 'ENQUEUED', kind: 'ENQUEUED' }],
      kind: 'proof_media', queueItemId: legacyId, queueSequence: 1, request, state: 'PENDING',
    }] });
    const storage = { getItem: async () => raw, setItem: async (_key: string, value: string) => { raw = value; }, removeItem: async () => { raw = null; } };
    const openQueue = () => createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, now, storage });
    const originalQueue = await openQueue();
    assert.equal(originalQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' }).queueItemId, legacyId);
    const originalKey: string[] = [];
    await retryOfflineSubmissions({
      queue: originalQueue, now, orderedEventAccessIdentity: { ...access, assignmentGeneration: '2' },
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async (_value, options) => {
        originalKey.push(options?.idempotencyKey ?? '');
        throw new Error('upload response lost');
      } },
    });
    await originalQueue.whenPersisted();

    const reassignedQueue = await openQueue();
    const current = reassignedQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    assert.notEqual(current.queueItemId, legacyId);
    assert.notEqual(current.idempotencyKey, originalKey[0]);
    assert.equal(current.idempotencyKey, getProofMediaUploadIdempotencyKey(request, { assignmentGeneration: '3' }));
    assert.strictEqual(reassignedQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' }), current);
    assert.equal(reassignedQueue.listPending().length, 2);
    await reassignedQueue.whenPersisted();
    const currentKeys: string[] = [];
    await retryOfflineSubmissions({
      queue: reassignedQueue, now, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async (_value, options) => {
        currentKeys.push(options?.idempotencyKey ?? '');
        throw new Error('new assignment upload response lost');
      } },
    });
    await reassignedQueue.whenPersisted();

    const restartedQueue = await openQueue();
    const restoredCurrent = restartedQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    assert.equal(restoredCurrent.queueItemId, current.queueItemId);
    assert.equal(restoredCurrent.idempotencyKey, current.idempotencyKey);
    const restoredOriginal = restartedQueue.listPending().find(item => item.queueItemId === legacyId);
    assert.equal(restoredOriginal?.kind === 'proof_media' ? restoredOriginal.assignmentGeneration : null, '2');
    assert.equal(restoredOriginal?.kind === 'proof_media' ? restoredOriginal.idempotencyKey : null, undefined);
    assert.deepEqual(restoredOriginal?.kind === 'proof_media' ? restoredOriginal.request : null, request);
    assert.equal(restoredOriginal?.reconciliation?.reason, 'assignment_changed');
    assert.strictEqual(restartedQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' }), restoredOriginal);
    const result = await retryOfflineSubmissions({
      queue: restartedQueue, now, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async (value, options) => {
        currentKeys.push(options?.idempotencyKey ?? '');
        return createMockProofMediaUploadService().uploadProofMedia(value);
      } },
    });
    assert.equal(result.succeeded, 1);
    assert.deepEqual(originalKey, [getProofMediaUploadIdempotencyKey(request)]);
    assert.deepEqual(currentKeys, [current.idempotencyKey, current.idempotencyKey]);
    await restartedQueue.whenPersisted();
    const acknowledgedQueue = await openQueue();
    const acknowledged = acknowledgedQueue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    assert.equal(acknowledged.queueItemId, current.queueItemId);
    assert.equal(acknowledged.state, 'ACKNOWLEDGED');
    assert.deepEqual(acknowledgedQueue.listPending().map(item => item.queueItemId), [legacyId]);
  });

  it('registers a scoped photo separately from a retained photo with unknown generation', () => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    const unscoped = queue.enqueueProofMediaUpload(request);
    const current = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    assert.notEqual(current.queueItemId, unscoped.queueItemId);
    assert.equal(unscoped.assignmentGeneration, undefined);
    assert.equal(current.assignmentGeneration, '3');
    assert.equal(queue.listPending().length, 2);
  });

  it('quarantines a previous-generation photo before a same-route upload', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    const original = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' });
    let uploads = 0;
    const result = await retryOfflineSubmissions({
      queue, routePlanId: request.routePlanId, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(),
      proofMediaUploadService: { uploadProofMedia: async () => { uploads += 1; return createMockProofMediaUploadService().uploadProofMedia(request); } },
    });
    assert.equal(uploads, 0);
    assert.equal(result.blocked, 1);
    assert.equal(queue.listPending()[0]?.queueItemId, original.queueItemId);
    assert.equal(queue.listPending()[0]?.reconciliation?.reason, 'assignment_changed');
  });

  it('retains photo generation and item identity after encrypted-envelope recovery', async () => {
    let raw: string | null = null;
    const storage = { getItem: async () => raw, setItem: async (_key: string, value: string) => { raw = value; }, removeItem: async () => { raw = null; } };
    const queue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage });
    const original = queue.enqueueProofMediaUpload(request, { assignmentGeneration: '2' });
    await queue.whenPersisted();
    const restarted = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage });
    const restored = restarted.listPending()[0];
    assert.equal(restored?.kind, 'proof_media');
    assert.equal(restored?.kind === 'proof_media' ? restored.assignmentGeneration : undefined, '2');
    assert.equal(restored?.queueItemId, original.queueItemId);
    assert.deepEqual(restored?.kind === 'proof_media' ? restored.request : null, request);
  });

  it('quarantines an old photo with unknown generation on a v2 route', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    const original = queue.enqueueProofMediaUpload(request);
    let uploads = 0;
    await retryOfflineSubmissions({ queue, routePlanId: request.routePlanId, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(), proofMediaUploadService: {
        uploadProofMedia: async () => { uploads += 1; return createMockProofMediaUploadService().uploadProofMedia(request); },
      } });
    assert.equal(uploads, 0);
    assert.equal(queue.listPending()[0]?.queueItemId, original.queueItemId);
    assert.equal(queue.listPending()[0]?.reconciliation?.reason, 'assignment_changed');
  });

  it('retries a current-generation photo without changing its request', async () => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash: owner });
    queue.enqueueProofMediaUpload(request, { assignmentGeneration: '3' });
    let uploaded: unknown;
    const result = await retryOfflineSubmissions({ queue, routePlanId: request.routePlanId, orderedEventAccessIdentity: access,
      driverEventService: createMockDriverEventService(), proofMediaUploadService: {
        uploadProofMedia: async value => { uploaded = value; return createMockProofMediaUploadService().uploadProofMedia(value); },
      } });
    assert.equal(result.succeeded, 1);
    assert.deepEqual(uploaded, request);
  });
});
