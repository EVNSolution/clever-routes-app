import type { ProofPhotoCaptureResult, ProofPhotoCaptureSource } from './proofPhotoCapture';
import {
  createDriverApiHttpError,
  formatDriverApiErrorForDriver,
  getDriverApiRecoveryReason,
} from '../../api/deliveryServer/driverApiError';

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

export type ProofMediaUploadMockMode = 'failure' | 'scan_rejected' | 'success';

export type ProofMediaUploadResult =
  | { kind: 'skipped'; message: string; reason: 'photo_not_captured' }
  | { kind: 'upload_failed'; message: string; reason?: 'driver_access_expired' | 'proof_media_rejected' }
  | { kind: 'uploaded'; media: ProofMediaReference };

export const PROOF_MEDIA_REJECTED_MESSAGE =
  'Proof photo was rejected by the safety scan. Capture another proof photo.';

export class ProofMediaRejectedError extends Error {
  constructor() {
    super(PROOF_MEDIA_REJECTED_MESSAGE);
    this.name = 'ProofMediaRejectedError';
  }
}

export function createProofMediaRejectedError(): ProofMediaRejectedError {
  return new ProofMediaRejectedError();
}

export function isProofMediaRejectedError(error: unknown): error is ProofMediaRejectedError {
  return error instanceof ProofMediaRejectedError;
}

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

export function createMockProofMediaUploadService(input?: {
  mode?: ProofMediaUploadMockMode;
}): ProofMediaUploadService {
  const mode = input?.mode ?? 'success';

  return {
    uploadProofMedia: async (request) => {
      if (mode === 'scan_rejected') {
        throw createProofMediaRejectedError();
      }

      if (mode === 'failure') {
        throw new Error('Proof media mock upload failed');
      }

      return createMockProofMediaReference(request);
    },
  };
}

function createMockProofMediaReference(input: ProofMediaUploadRequest): ProofMediaReference {
  return {
    contentType: getContentTypeFromFileName(input.fileName),
    kind: 'photo',
    mediaId: `mock-media-${input.deliveryStopId}`,
    source: input.source,
    storageKey: `mock-driver-proof/${input.routePlanId}/${input.deliveryStopId}/${input.fileName}`,
    uploadedAt: new Date().toISOString(),
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
        if (response.status === 422 && readDriverApiErrorCode(payload) === 'PROOF_MEDIA_REJECTED') {
          throw createProofMediaRejectedError();
        }

        throw createDriverApiHttpError({
          endpoint: 'Proof media upload',
          status: response.status,
        });
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
    if (isProofMediaRejectedError(error)) {
      return {
        kind: 'upload_failed',
        message: PROOF_MEDIA_REJECTED_MESSAGE,
        reason: 'proof_media_rejected',
      };
    }

    const recoveryReason = getDriverApiRecoveryReason(error);

    return {
      kind: 'upload_failed',
      message: `Proof media upload failed: ${formatDriverApiErrorForDriver(error)}`,
      ...(recoveryReason === undefined ? {} : { reason: recoveryReason }),
    };
  }
}

export function shouldQueueFailedProofMediaUpload(result: ProofMediaUploadResult): boolean {
  return result.kind === 'upload_failed' && result.reason !== 'proof_media_rejected';
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

function readDriverApiErrorCode(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
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
