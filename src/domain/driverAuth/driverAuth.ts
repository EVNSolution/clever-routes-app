import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';

export type DriverAccountAccessToken = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
  ttlSeconds: number;
  use: 'driver_account';
};

export type LoginDriverAccountInput = {
  phoneE164: string;
  pin: string;
};

export type RegisterDriverAccountInput = LoginDriverAccountInput & {
  inviteCode: string;
};

export type RefreshDriverAuthSessionInput = {
  refreshToken: string;
};

export type DriverAuthService = {
  login(input: LoginDriverAccountInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
  refreshSession(input: RefreshDriverAuthSessionInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
  register(input: RegisterDriverAccountInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
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

  async function postAuth(endpoint: string, body: Record<string, string>, label: string) {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, withNoStoreDriverApiRequest({
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
    const payload = await response.json();
    if (!response.ok) {
      throw createDriverApiHttpError({ endpoint: label, status: response.status });
    }

    return { accountAccess: readDriverAuthEnvelope(payload) };
  }

  return {
    login: (request) => postAuth('/driver/auth/login', {
      phone: request.phoneE164.trim(),
      pin: request.pin.trim(),
    }, 'Driver PIN login'),
    refreshSession: (request) => postAuth('/driver/auth/refresh', {
      refreshToken: request.refreshToken.trim(),
    }, 'Refresh Auth Session'),
    register: (request) => postAuth('/driver/auth/verify-invite', {
      phone: request.phoneE164.trim(),
      inviteCode: request.inviteCode.trim().toUpperCase(),
      pin: request.pin.trim(),
    }, 'Register Driver Account'),
  };
}

export function createMockDriverAuthService(accountAccess: DriverAccountAccessToken = {
  accessToken: 'fixture-driver-account-access-token',
  expiresAt: '2100-05-12T06:55:00.000Z',
  refreshToken: 'fixture-driver-account-refresh-token',
  refreshTokenExpiresAt: '2100-06-11T06:55:00.000Z',
  tokenType: 'Bearer',
  ttlSeconds: 900,
  use: 'driver_account',
}): DriverAuthService {
  return {
    login: async () => ({ accountAccess }),
    refreshSession: async () => ({ accountAccess }),
    register: async () => ({ accountAccess }),
  };
}

function readDriverAuthEnvelope(payload: unknown): DriverAccountAccessToken {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver auth response');
  }

  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid driver auth response');
  }

  const record = data as Record<string, unknown>;
  if (
    typeof record.accessToken !== 'string' || record.accessToken.trim() === '' ||
    typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt)) ||
    typeof record.refreshToken !== 'string' || record.refreshToken.trim() === '' ||
    typeof record.refreshTokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(record.refreshTokenExpiresAt)) ||
    record.tokenType !== 'Bearer' ||
    typeof record.ttlSeconds !== 'number' || !Number.isInteger(record.ttlSeconds) || record.ttlSeconds <= 0 ||
    record.use !== 'driver_account'
  ) {
    throw new Error('Invalid driver auth response');
  }

  return {
    accessToken: record.accessToken,
    expiresAt: record.expiresAt,
    refreshToken: record.refreshToken,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    tokenType: 'Bearer',
    ttlSeconds: record.ttlSeconds,
    use: 'driver_account',
  };
}
