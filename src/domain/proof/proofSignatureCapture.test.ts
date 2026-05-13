import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { captureProofSignature } from './proofSignatureCapture';

describe('proof signature capture', () => {
  it('returns durable signature evidence for a non-empty drawing', async () => {
    const result = await captureProofSignature({
      captureService: {
        captureSignature: async () => ({
          kind: 'captured',
          signerName: '  Recipient One  ',
          strokes: [
            [
              { x: 0, y: 0 },
              { x: 12, y: 8 },
            ],
            [{ x: 20, y: 4 }],
          ],
        }),
      },
      idFactory: () => 'signature-1',
      now: () => new Date('2026-05-12T10:05:00.000Z'),
    });

    assert.deepEqual(result, {
      capturedAt: '2026-05-12T10:05:00.000Z',
      kind: 'captured',
      signature: {
        kind: 'signature',
        pointCount: 3,
        signatureId: 'signature-1',
        signerName: 'Recipient One',
        source: 'native-drawing',
        strokeCount: 2,
      },
    });
  });

  it('blocks empty signature drawings', async () => {
    const result = await captureProofSignature({
      captureService: {
        captureSignature: async () => ({ kind: 'captured', signerName: 'Recipient One', strokes: [[]] }),
      },
      idFactory: () => 'signature-1',
      now: () => new Date('2026-05-12T10:05:00.000Z'),
    });

    assert.deepEqual(result, {
      kind: 'invalid',
      message: 'Signature drawing must include at least one point.',
      reason: 'empty_signature',
    });
  });
});
