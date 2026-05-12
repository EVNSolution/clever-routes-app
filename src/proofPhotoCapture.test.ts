import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { captureProofPhoto } from './proofPhotoCapture';

describe('proof photo capture', () => {
  it('returns permission_denied when camera/library permission is denied', async () => {
    const result = await captureProofPhoto({
      captureService: {
        requestPermission: async () => 'denied',
        launchCapture: async () => ({ kind: 'captured', uri: 'file:///should-not-run.jpg' }),
      },
      source: 'camera',
    });

    assert.deepEqual(result, {
      kind: 'permission_denied',
      message: 'Photo permission is required to attach proof media.',
      source: 'camera',
    });
  });

  it('returns captured photo URI when permission is granted', async () => {
    const result = await captureProofPhoto({
      captureService: {
        requestPermission: async () => 'granted',
        launchCapture: async () => ({ kind: 'captured', uri: 'file:///proof/stop-1.jpg' }),
      },
      source: 'library',
    });

    assert.deepEqual(result, {
      kind: 'captured',
      source: 'library',
      uri: 'file:///proof/stop-1.jpg',
    });
  });

  it('returns cancelled when the native picker is cancelled', async () => {
    const result = await captureProofPhoto({
      captureService: {
        requestPermission: async () => 'granted',
        launchCapture: async () => ({ kind: 'cancelled' }),
      },
      source: 'camera',
    });

    assert.deepEqual(result, { kind: 'cancelled', source: 'camera' });
  });
});
