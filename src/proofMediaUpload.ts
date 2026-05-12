import type { ProofPhotoCaptureResult, ProofPhotoCaptureSource } from './proofPhotoCapture';

export type ProofMediaKind = 'photo';

export type ProofMediaReference = {
  contentType: string;
  kind: ProofMediaKind;
  mediaId: string;
  sha256?: string;
  sizeBytes?: number;
  source: ProofPhotoCaptureSource;
  storageKey: string;
  uploadedAt: string;
};

export type ProofMediaUploadRequest = {
  deliveryStopId: string;
  fileName: string;
  routePlanId: string;
  source: ProofPhotoCaptureSource;
  uri: string;
};

export type ProofMediaUploadService = {
  uploadProofMedia(input: ProofMediaUploadRequest): Promise<ProofMediaReference>;
};

export type ProofMediaUploadResult =
  | { kind: 'skipped'; message: string; reason: 'photo_not_captured' }
  | { kind: 'upload_failed'; message: string }
  | { kind: 'uploaded'; media: ProofMediaReference };

export type FetchLike = (
  input: string,
  init?: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status?: number;
}>;

export function createMockProofMediaUploadService(): ProofMediaUploadService {
  return {
    uploadProofMedia: async (input) => ({
      contentType: getContentTypeFromFileName(input.fileName),
      kind: 'photo',
      mediaId: `mock-media-${input.deliveryStopId}`,
      source: input.source,
      storageKey: `mock-driver-proof/${input.routePlanId}/${input.deliveryStopId}/${input.fileName}`,
      uploadedAt: new Date().toISOString(),
    }),
  };
}

export function createProofMediaUploadApiClient(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): ProofMediaUploadService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  return {
    uploadProofMedia: async (request) => {
      const response = await fetchImpl(`${baseUrl}/driver/proof-media`, {
        body: toProofMediaFormData(request),
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
        },
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Proof media upload failed with HTTP ${response.status ?? 'unknown'}`);
      }

      return readProofMediaReferenceEnvelope(payload);
    },
  };
}

export async function uploadCapturedProofPhoto(input: {
  captureResult: ProofPhotoCaptureResult;
  uploadRequest: Omit<ProofMediaUploadRequest, 'source' | 'uri'>;
  uploadService: ProofMediaUploadService;
}): Promise<ProofMediaUploadResult> {
  if (input.captureResult.kind !== 'captured') {
    return {
      kind: 'skipped',
      message: 'Proof photo was not captured, so no media upload was attempted.',
      reason: 'photo_not_captured',
    };
  }

  try {
    const media = await input.uploadService.uploadProofMedia({
      ...input.uploadRequest,
      source: input.captureResult.source,
      uri: input.captureResult.uri,
    });
    return { kind: 'uploaded', media };
  } catch (error) {
    return {
      kind: 'upload_failed',
      message: `Proof media upload failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

function toProofMediaFormData(request: ProofMediaUploadRequest): FormData {
  const formData = new FormData();
  formData.append('deliveryStopId', request.deliveryStopId);
  formData.append('routePlanId', request.routePlanId);
  formData.append('source', request.source);
  formData.append('file', {
    name: request.fileName,
    type: getContentTypeFromFileName(request.fileName),
    uri: request.uri,
  } as unknown as Blob);
  return formData;
}

function getContentTypeFromFileName(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith('.png')) {
    return 'image/png';
  }

  return 'image/jpeg';
}

function readProofMediaReferenceEnvelope(payload: unknown): ProofMediaReference {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid proof media upload response');
  }

  const data = (payload as { data?: unknown }).data;
  if (!isProofMediaReference(data)) {
    throw new Error('Invalid proof media upload response');
  }

  return data;
}

function isProofMediaReference(value: unknown): value is ProofMediaReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    data.kind === 'photo'
    && typeof data.mediaId === 'string'
    && data.mediaId.trim() !== ''
    && typeof data.contentType === 'string'
    && data.contentType.trim() !== ''
    && (data.source === 'camera' || data.source === 'library')
    && typeof data.storageKey === 'string'
    && data.storageKey.trim() !== ''
    && typeof data.uploadedAt === 'string'
    && data.uploadedAt.trim() !== ''
    && (data.sha256 === undefined || typeof data.sha256 === 'string')
    && (data.sizeBytes === undefined || typeof data.sizeBytes === 'number')
  );
}
