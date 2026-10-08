import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMockDriverEventService } from '../events/driverEvents';
import { createMockProofMediaUploadService } from '../proof/proofMediaUpload';
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  retryOfflineSubmissions,
} from './offlineSubmissionQueue';

const owner = 'a'.repeat(64);
const request = { deliveryStopId: 'stop', fileName: 'proof.jpg', routePlanId: 'route', source: 'camera' as const, uri: 'file:///proof.jpg' };
const access = { routePlanId: 'route', assignmentGeneration: '3', driverContractVersion: 2, expectedRouteVersionId: 'version' };

describe('offline proof-media assignment scope', () => {
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
