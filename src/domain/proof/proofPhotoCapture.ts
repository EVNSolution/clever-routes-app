export type ProofPhotoCaptureSource = 'camera' | 'library';

export type ProofPhotoCapturePermissionResult = 'denied' | 'granted';

export type ProofPhotoCaptureLaunchResult =
  | { kind: 'cancelled' }
  | { kind: 'captured'; uri: string };

export type ProofPhotoCaptureResult =
  | { kind: 'cancelled'; source: ProofPhotoCaptureSource }
  | { kind: 'captured'; source: ProofPhotoCaptureSource; uri: string }
  | { kind: 'permission_denied'; message: string; source: ProofPhotoCaptureSource };

export type ProofPhotoCaptureService = {
  launchCapture(source: ProofPhotoCaptureSource): Promise<ProofPhotoCaptureLaunchResult>;
  requestPermission(source: ProofPhotoCaptureSource): Promise<ProofPhotoCapturePermissionResult>;
};

export async function captureProofPhoto(input: {
  captureService: ProofPhotoCaptureService;
  source: ProofPhotoCaptureSource;
}): Promise<ProofPhotoCaptureResult> {
  const permission = await input.captureService.requestPermission(input.source);
  if (permission !== 'granted') {
    return {
      kind: 'permission_denied',
      message: 'Allow photo access to add a delivery photo.',
      source: input.source,
    };
  }

  const result = await input.captureService.launchCapture(input.source);
  if (result.kind === 'cancelled') {
    return { kind: 'cancelled', source: input.source };
  }

  return { ...result, source: input.source };
}
