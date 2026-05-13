import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { captureProofBarcode } from './proofBarcodeCapture';

describe('proof barcode capture', () => {
  it('returns permission_denied before launching native scanner', async () => {
    let launched = false;
    const result = await captureProofBarcode({
      barcodeService: {
        launchScanner: async () => {
          launched = true;
          return { data: 'SHOULD_NOT_SCAN', kind: 'scanned', symbology: 'qr' };
        },
        requestPermission: async () => 'denied',
      },
      idFactory: () => 'barcode-1',
      now: () => new Date('2026-05-12T10:10:00.000Z'),
    });

    assert.equal(launched, false);
    assert.deepEqual(result, {
      kind: 'permission_denied',
      message: 'Camera permission is required to scan proof barcodes.',
    });
  });

  it('returns barcode evidence after native scanner reads a barcode', async () => {
    const result = await captureProofBarcode({
      barcodeService: {
        launchScanner: async () => ({ data: 'ORDER-1001', kind: 'scanned', symbology: 'code128' }),
        requestPermission: async () => 'granted',
      },
      idFactory: () => 'barcode-1',
      now: () => new Date('2026-05-12T10:10:00.000Z'),
    });

    assert.deepEqual(result, {
      barcode: {
        barcodeId: 'barcode-1',
        capturedAt: '2026-05-12T10:10:00.000Z',
        data: 'ORDER-1001',
        kind: 'barcode',
        source: 'native-scanner',
        symbology: 'code128',
      },
      kind: 'scanned',
    });
  });
});
