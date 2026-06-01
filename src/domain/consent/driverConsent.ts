import type { DriverFlowState } from '../driverFlow/driverFlow';
import {
  createDriverApiHttpError,
  DRIVER_ACCESS_EXPIRED_MESSAGE,
  isDriverApiUnauthorizedError,
} from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';

export type DriverConsentType = 'LOCATION_INFORMATION' | 'PERSONAL_INFORMATION';

export type DriverConsentRecordInput = {
  accepted: true;
  type: DriverConsentType;
  version: string;
};

export type DriverConsentRecordResult = {
  accepted: boolean;
  type: DriverConsentType;
  version: string;
};

export type RecordDriverConsentsInput = {
  appContext: Record<string, unknown> | null;
  consents: DriverConsentRecordInput[];
  deviceContext: Record<string, unknown> | null;
  recordedAt: Date;
  routeContext: string | null;
};

export type RecordDriverConsentsResult = {
  status: 'CONSENT_RECORDED';
  recordedAt: string;
  records: DriverConsentRecordResult[];
};

export type DriverConsentService = {
  recordDriverConsents(input: RecordDriverConsentsInput): Promise<RecordDriverConsentsResult>;
};

export type DriverConsentSubmissionInput = {
  appContext: Record<string, unknown> | null;
  deviceContext: Record<string, unknown> | null;
  now?: () => Date;
  routeContext: string;
};

export type DriverConsentSubmissionResult =
  | {
      flowState: Extract<DriverFlowState, 'consent_recorded'>;
      kind: 'consent_recorded';
      recordedAt: string;
      records: DriverConsentRecordResult[];
    }
  | {
      flowState: Extract<DriverFlowState, 'consent_required'>;
      kind: 'consent_error';
      message: string;
      reason?: 'driver_access_expired';
    };

export type FetchLike = (
  input: string,
  init?: {
    body?: string;
    cache?: 'no-store';
    credentials?: 'omit';
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status?: number;
}>;

export const CONSENT_COPY_VERSIONS = {
  locationInformation: 'location-v1',
  personalInformation: 'privacy-v1',
} as const;

const REQUIRED_CONSENTS: DriverConsentRecordInput[] = [
  {
    accepted: true,
    type: 'LOCATION_INFORMATION',
    version: CONSENT_COPY_VERSIONS.locationInformation,
  },
  {
    accepted: true,
    type: 'PERSONAL_INFORMATION',
    version: CONSENT_COPY_VERSIONS.personalInformation,
  },
];

export async function submitDriverConsent(
  input: DriverConsentSubmissionInput,
  service: DriverConsentService,
): Promise<DriverConsentSubmissionResult> {
  try {
    const result = await service.recordDriverConsents({
      appContext: input.appContext,
      consents: [...REQUIRED_CONSENTS],
      deviceContext: input.deviceContext,
      recordedAt: input.now?.() ?? new Date(),
      routeContext: input.routeContext,
    });

    return {
      flowState: 'consent_recorded',
      kind: 'consent_recorded',
      recordedAt: result.recordedAt,
      records: result.records,
    };
  } catch (error) {
    if (isDriverApiUnauthorizedError(error)) {
      return {
        flowState: 'consent_required',
        kind: 'consent_error',
        message: DRIVER_ACCESS_EXPIRED_MESSAGE,
        reason: 'driver_access_expired',
      };
    }

    return {
      flowState: 'consent_required',
      kind: 'consent_error',
      message: 'Consent could not be recorded. Check the connection and try again.',
    };
  }
}

export function createMockDriverConsentService(input: { recordedAt?: Date } = {}): DriverConsentService {
  return {
    recordDriverConsents: async (request) => ({
      status: 'CONSENT_RECORDED',
      recordedAt: (input.recordedAt ?? request.recordedAt).toISOString(),
      records: request.consents.map((consent) => ({
        accepted: consent.accepted,
        type: consent.type,
        version: consent.version,
      })),
    }),
  };
}

export function createDriverConsentApiClient(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): DriverConsentService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const accessToken = input.accessToken.trim();

  return {
    recordDriverConsents: async (request) => {
      const response = await fetchImpl(`${baseUrl}/driver/consents`, withNoStoreDriverApiRequest({
        body: JSON.stringify({
          appContext: request.appContext,
          consents: request.consents,
          deviceContext: request.deviceContext,
          recordedAt: request.recordedAt.toISOString(),
          routeContext: request.routeContext,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }));
      const payload = await response.json();
      if (!response.ok) {
        throw createDriverApiHttpError({
          endpoint: 'Driver consent submission',
          status: response.status,
        });
      }

      return readDriverConsentEnvelope(payload);
    },
  };
}

function readDriverConsentEnvelope(payload: unknown): RecordDriverConsentsResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver consent response');
  }

  const data = (payload as { data?: unknown }).data;
  if (!isRecordDriverConsentsResult(data)) {
    throw new Error('Invalid driver consent response');
  }

  return data;
}

function isRecordDriverConsentsResult(value: unknown): value is RecordDriverConsentsResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;
  return (
    result.status === 'CONSENT_RECORDED' &&
    typeof result.recordedAt === 'string' &&
    Array.isArray(result.records) &&
    result.records.every(isDriverConsentRecordResult)
  );
}

function isDriverConsentRecordResult(value: unknown): value is DriverConsentRecordResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.accepted === 'boolean' &&
    isDriverConsentType(record.type) &&
    typeof record.version === 'string'
  );
}

function isDriverConsentType(value: unknown): value is DriverConsentType {
  return value === 'LOCATION_INFORMATION' || value === 'PERSONAL_INFORMATION';
}
