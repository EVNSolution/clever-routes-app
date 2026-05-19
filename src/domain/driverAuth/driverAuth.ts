import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import { type DriverAccessToken } from '../routeAccess/routeAccess';

export type VerifyDriverAuthCodeInput = {
  displayName: string;
  phoneE164: string;
  inviteCode: string;
};

export type DriverAuthService = {
  verifyCode(input: VerifyDriverAuthCodeInput): Promise<{
    driverAccess: DriverAccessToken;
  }>;
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

export function createDriverAuthApiClient(input: {
  baseUrl: string;
  fetchImpl?: FetchLike;
}): DriverAuthService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  return {
    verifyCode: async (request) => {
      const response = await fetchImpl(`${baseUrl}/driver/auth/verify-invite`, withNoStoreDriverApiRequest({
        body: JSON.stringify({
          phone: request.phoneE164,
          inviteCode: request.inviteCode,
          displayName: request.displayName.trim(),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }));
      const payload = await response.json();
      if (!response.ok) {
        throw createDriverApiHttpError({ endpoint: 'Verify Auth Code', status: response.status });
      }

      const data = readDriverAuthEnvelope(payload);
      return {
        driverAccess: {
          accessToken: data.accessToken,
          expiresAt: data.expiresAt,
          tokenType: 'Bearer',
          ttlSeconds: 900,
          use: 'consent_and_assigned_route',
          refreshToken: data.refreshToken,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt,
        }
      };
    }
  };
}

export function createMockDriverAuthService(driverAccess: DriverAccessToken = {
  accessToken: 'fixture-driver-access-token',
  expiresAt: '2026-05-12T06:55:00.000Z',
  tokenType: 'Bearer',
  ttlSeconds: 900,
  use: 'consent_and_assigned_route',
}): DriverAuthService {
  return {
    verifyCode: async () => ({ driverAccess }),
  };
}

function readDriverAuthEnvelope(payload: unknown): DriverAccessToken & {
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
} {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver auth response');
  }

  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid driver auth response');
  }

  const record = data as Record<string, unknown>;
  if (
    typeof record.accessToken !== 'string' ||
    record.accessToken.trim() === '' ||
    typeof record.expiresAt !== 'string' ||
    record.expiresAt.trim() === ''
  ) {
    throw new Error('Invalid driver auth response');
  }

  return {
    accessToken: record.accessToken,
    expiresAt: record.expiresAt,
    tokenType: 'Bearer',
    ttlSeconds: 900,
    use: 'consent_and_assigned_route',
    ...(typeof record.refreshToken === 'string' ? { refreshToken: record.refreshToken } : {}),
    ...(typeof record.refreshTokenExpiresAt === 'string' ? { refreshTokenExpiresAt: record.refreshTokenExpiresAt } : {}),
  };
}
