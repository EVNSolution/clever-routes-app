export type ProofSignaturePoint = {
  x: number;
  y: number;
};

export type ProofSignatureStroke = ProofSignaturePoint[];

export type ProofSignatureLaunchResult =
  | { kind: 'cancelled' }
  | { kind: 'captured'; signerName: string; strokes: ProofSignatureStroke[] };

export type ProofSignatureReference = {
  kind: 'signature';
  pointCount: number;
  signatureId: string;
  signerName: string;
  source: 'native-drawing';
  strokeCount: number;
};

export type ProofSignatureCaptureResult =
  | { capturedAt: string; kind: 'captured'; signature: ProofSignatureReference }
  | { kind: 'cancelled'; message: string }
  | { kind: 'invalid'; message: string; reason: 'empty_signature' };

export type ProofSignatureCaptureService = {
  captureSignature(): Promise<ProofSignatureLaunchResult>;
};

export async function captureProofSignature(input: {
  captureService: ProofSignatureCaptureService;
  idFactory?: () => string;
  now?: () => Date;
}): Promise<ProofSignatureCaptureResult> {
  const result = await input.captureService.captureSignature();
  if (result.kind === 'cancelled') {
    return { kind: 'cancelled', message: 'Signature capture cancelled.' };
  }

  const pointCount = result.strokes.reduce((total, stroke) => total + stroke.length, 0);
  if (pointCount === 0) {
    return {
      kind: 'invalid',
      message: 'Signature drawing must include at least one point.',
      reason: 'empty_signature',
    };
  }

  return {
    capturedAt: (input.now ?? (() => new Date()))().toISOString(),
    kind: 'captured',
    signature: {
      kind: 'signature',
      pointCount,
      signatureId: (input.idFactory ?? createSignatureId)(),
      signerName: result.signerName.trim(),
      source: 'native-drawing',
      strokeCount: result.strokes.filter((stroke) => stroke.length > 0).length,
    },
  };
}

function createSignatureId(): string {
  return `signature-${Date.now().toString(36)}`;
}
