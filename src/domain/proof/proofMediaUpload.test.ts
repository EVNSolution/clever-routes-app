import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createMockProofMediaUploadService,
  createProofMediaUploadApiClient,
  createProofMediaRejectedError,
  shouldQueueFailedProofMediaUpload,
  uploadCapturedProofPhoto,
  type ProofMediaUploadRequest,
} from './proofMediaUpload';

describe('proof media upload', () => {
  it('uses React Native XMLHttpRequest for live file uploads by default', async () => {
    const requests: { body?: unknown; headers: Record<string, string>; method?: string; timeout?: number; url?: string }[] = [];
    class MockXMLHttpRequest {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      responseText = JSON.stringify({
        data: {
          contentType: 'image/jpeg',
          kind: 'photo',
          mediaId: 'media-xhr',
          source: 'camera',
          storageKey: 'driver-proof/media-xhr.jpg',
          uploadedAt: '2026-05-12T10:00:00.000Z',
        },
      });
      status = 201;
      timeout = 0;
      private readonly headers: Record<string, string> = {};
      private method?: string;
      private url?: string;

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }

      send(body: unknown) {
        requests.push({ body, headers: this.headers, method: this.method, timeout: this.timeout, url: this.url });
        this.onload?.();
      }
    }

    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      xmlHttpRequestFactory: () => new MockXMLHttpRequest() as unknown as XMLHttpRequest,
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.equal(result.kind, 'uploaded');
    assert.equal(requests[0]?.url, 'https://delivery.example.com/driver/proof-media');
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.timeout, 30000);
    assert.equal(requests[0]?.headers.Authorization, 'Bearer driver-token');
    assert.equal(requests[0]?.headers['Cache-Control'], 'no-store');
    assert.equal(requests[0]?.headers.Pragma, 'no-cache');
    assert.ok(requests[0]?.body instanceof FormData);
  });

  it('uploads captured proof photo with driver bearer token and returns durable media reference', async () => {
    const requests: { body: FormData; cache?: string; credentials?: string; headers: Record<string, string>; method: string; url: string }[] = [];
    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: init?.body as FormData,
          cache: init?.cache,
          credentials: init?.credentials,
          headers: init?.headers ?? {},
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          json: async () => ({
            data: {
              contentType: 'image/jpeg',
              kind: 'photo',
              mediaId: 'media-1',
              sha256: 'sha256-fixture',
              sizeBytes: 12345,
              source: 'camera',
              storageKey: 'driver-proof/media-1.jpg',
              uploadedAt: '2026-05-12T10:00:00.000Z',
            },
            error: null,
          }),
        };
      },
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.equal(result.kind, 'uploaded');
    assert.deepEqual(result.media, {
      contentType: 'image/jpeg',
      kind: 'photo',
      mediaId: 'media-1',
      sha256: 'sha256-fixture',
      sizeBytes: 12345,
      source: 'camera',
      storageKey: 'driver-proof/media-1.jpg',
      uploadedAt: '2026-05-12T10:00:00.000Z',
    });
    assert.equal(requests[0]?.url, 'https://delivery.example.com/driver/proof-media');
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.cache, 'no-store');
    assert.equal(requests[0]?.credentials, 'omit');
    assert.equal(requests[0]?.headers['Cache-Control'], 'no-store');
    assert.equal(requests[0]?.headers.Pragma, 'no-cache');
    assert.equal(requests[0]?.headers.Authorization, 'Bearer driver-token');
    assert.equal(requests[0]?.headers['Content-Type'], undefined);
    assert.equal(requests[0]?.body.get('deliveryStopId'), 'stop-1');
    assert.equal(requests[0]?.body.get('routePlanId'), 'route-1');
    assert.equal(requests[0]?.body.get('source'), 'camera');
  });

  it('does not upload proof media when photo capture did not produce a file URI', async () => {
    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'cancelled', source: 'library' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: {
        uploadProofMedia: async (_request: ProofMediaUploadRequest) => {
          throw new Error('upload should not run');
        },
      },
    });

    assert.deepEqual(result, {
      kind: 'skipped',
      message: 'No photo selected.',
      reason: 'photo_not_captured',
    });
  });

  it('returns upload_failed without creating a durable evidence reference', async () => {
    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: {
        uploadProofMedia: async () => {
          throw new Error('network down');
        },
      },
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo upload failed: network down',
    });
  });

  it('keeps proof media HTTP status when an error response is not JSON', async () => {
    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 413,
        json: async () => {
          throw new Error('HTML error body');
        },
      }),
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo upload failed (HTTP 413). Try again.',
    });
  });

  it('shows proof media HTTP status for live upload failures', async () => {
    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: { code: 'BAD_REQUEST', message: 'Invalid proof media upload payload' },
        }),
      }),
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo upload failed (HTTP 400). Try again.',
    });
  });

  it('distinguishes expired driver access from a generic proof upload failure', async () => {
    const service = createProofMediaUploadApiClient({
      accessToken: 'expired-driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Invalid driver bearer token' },
        }),
      }),
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Session expired. Sign in again to sync this photo.',
      reason: 'driver_access_expired',
    });
  });

  it('marks proof media for reconciliation when the server route is no longer in progress', async () => {
    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          data: null,
          error: { code: 'ROUTE_NOT_IN_PROGRESS', message: 'Route is not in progress' },
        }),
      }),
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Route ended or released on server. This photo needs reconciliation.',
      reason: 'route_not_in_progress',
    });
    assert.equal(shouldQueueFailedProofMediaUpload(result), true);
  });

  it('surfaces scanner-rejected proof media as a safe non-retryable upload state', async () => {
    const service = createProofMediaUploadApiClient({
      accessToken: 'driver-token',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        json: async () => ({
          data: null,
          error: { code: 'PROOF_MEDIA_REJECTED', message: 'Proof media rejected by safety scan' },
        }),
      }),
    });

    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: service,
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo could not be used. Take another photo.',
      reason: 'proof_media_rejected',
    });
    assert.equal(shouldQueueFailedProofMediaUpload(result), false);
  });

  it('keeps generic and expired-access proof media failures retryable', () => {
    assert.equal(
      shouldQueueFailedProofMediaUpload({
        kind: 'upload_failed',
        message: 'Photo upload failed. Try again.',
      }),
      true,
    );
    assert.equal(
      shouldQueueFailedProofMediaUpload({
        kind: 'upload_failed',
        message: 'Session expired. Sign in again to sync this photo.',
        reason: 'driver_access_expired',
      }),
      true,
    );
    assert.equal(
      shouldQueueFailedProofMediaUpload({
        kind: 'upload_failed',
        message: 'Photo could not be used. Take another photo.',
        reason: 'proof_media_rejected',
      }),
      false,
    );
    assert.equal(
      shouldQueueFailedProofMediaUpload({
        kind: 'skipped',
        message: 'No photo selected.',
        reason: 'photo_not_captured',
      }),
      false,
    );
  });

  it('can create a scanner rejection error for offline retry discard paths', () => {
    assert.equal(createProofMediaRejectedError().message, 'Photo could not be used. Take another photo.');
  });

  it('can simulate scanner rejection through the local proof media mock mode', async () => {
    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: createMockProofMediaUploadService({ mode: 'scan_rejected' }),
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo could not be used. Take another photo.',
      reason: 'proof_media_rejected',
    });
    assert.equal(shouldQueueFailedProofMediaUpload(result), false);
  });

  it('can simulate retryable generic upload failure through the local proof media mock mode', async () => {
    const result = await uploadCapturedProofPhoto({
      captureResult: { kind: 'captured', source: 'camera', uri: 'file:///proof/stop-1.jpg' },
      uploadRequest: {
        deliveryStopId: 'stop-1',
        fileName: 'stop-1.jpg',
        routePlanId: 'route-1',
      },
      uploadService: createMockProofMediaUploadService({ mode: 'failure' }),
    });

    assert.deepEqual(result, {
      kind: 'upload_failed',
      message: 'Photo upload failed: Proof media mock upload failed',
    });
    assert.equal(shouldQueueFailedProofMediaUpload(result), true);
  });
});
