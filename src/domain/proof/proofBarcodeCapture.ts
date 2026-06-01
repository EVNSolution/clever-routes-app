export type ProofBarcodePermissionResult = 'denied' | 'granted';

export type ProofBarcodeScanResult =
  | { data: string; kind: 'scanned'; symbology: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; message: string };

export type ProofBarcodeReference = {
  barcodeId: string;
  capturedAt: string;
  data: string;
  kind: 'barcode';
  source: 'native-scanner';
  symbology: string;
};

export type ProofBarcodeCaptureResult =
  | { barcode: ProofBarcodeReference; kind: 'scanned' }
  | { kind: 'cancelled'; message: string }
  | { kind: 'permission_denied'; message: string }
  | { kind: 'unavailable'; message: string };

export type ProofBarcodeCaptureService = {
  launchScanner(): Promise<ProofBarcodeScanResult>;
  requestPermission(): Promise<ProofBarcodePermissionResult>;
};

export async function captureProofBarcode(input: {
  barcodeService: ProofBarcodeCaptureService;
  idFactory?: () => string;
  now?: () => Date;
}): Promise<ProofBarcodeCaptureResult> {
  const permission = await input.barcodeService.requestPermission();
  if (permission !== 'granted') {
    return {
      kind: 'permission_denied',
      message: 'Camera permission is required to scan proof barcodes.',
    };
  }

  const result = await input.barcodeService.launchScanner();
  if (result.kind === 'cancelled') {
    return { kind: 'cancelled', message: 'Barcode scan cancelled.' };
  }

  if (result.kind === 'unavailable') {
    return result;
  }

  return {
    barcode: {
      barcodeId: (input.idFactory ?? createBarcodeId)(),
      capturedAt: (input.now ?? (() => new Date()))().toISOString(),
      data: result.data,
      kind: 'barcode',
      source: 'native-scanner',
      symbology: result.symbology,
    },
    kind: 'scanned',
  };
}

function createBarcodeId(): string {
  return `barcode-${Date.now().toString(36)}`;
}
