import { Camera, CameraView, type BarcodeType } from 'expo-camera';

import type {
  ProofBarcodeCaptureService,
  ProofBarcodePermissionResult,
  ProofBarcodeScanResult,
} from './proofBarcodeCapture';

const DEFAULT_BARCODE_TYPES: BarcodeType[] = ['qr', 'code128', 'ean13', 'ean8', 'upc_a', 'upc_e'];

export function createExpoProofBarcodeCaptureService(): ProofBarcodeCaptureService {
  return {
    launchScanner: launchModernBarcodeScanner,
    requestPermission: requestCameraPermission,
  };
}

async function requestCameraPermission(): Promise<ProofBarcodePermissionResult> {
  const result = await Camera.requestCameraPermissionsAsync();
  return result.status === 'granted' ? 'granted' : 'denied';
}

async function launchModernBarcodeScanner(): Promise<ProofBarcodeScanResult> {
  if (!CameraView.isModernBarcodeScannerAvailable) {
    return {
      kind: 'unavailable',
      message: 'Native barcode scanner is unavailable on this device.',
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: ProofBarcodeScanResult) => {
      if (resolved) {
        return;
      }
      resolved = true;
      subscription.remove();
      resolve(result);
    };
    const subscription = CameraView.onModernBarcodeScanned((event) => {
      void CameraView.dismissScanner().catch(() => undefined);
      finish({
        data: event.data,
        kind: 'scanned',
        symbology: event.type,
      });
    });

    CameraView.launchScanner({ barcodeTypes: DEFAULT_BARCODE_TYPES })
      .then(() => {
        finish({ kind: 'cancelled' });
      })
      .catch((error: unknown) => {
        finish({
          kind: 'unavailable',
          message: `Native barcode scanner failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      });
  });
}
