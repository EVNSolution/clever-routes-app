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

export type DriverAccountProfile = {
  name: string | null;
  phone: string;
};

export type DriverAuthService = {
  getAccountProfile(input: { accountAccessToken: string }): Promise<{ account: DriverAccountProfile }>;
  login(input: LoginDriverAccountInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
  refreshSession(input: RefreshDriverAuthSessionInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
  register(input: RegisterDriverAccountInput): Promise<{ accountAccess: DriverAccountAccessToken }>;
  updateAccountProfile(input: {
    accountAccessToken: string;
    name: string;
  }): Promise<{ account: DriverAccountProfile }>;
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

  async function requestAccountProfile(input: {
    accountAccessToken: string;
    method: 'GET' | 'PATCH';
    name?: string;
  }): Promise<{ account: DriverAccountProfile }> {
    const response = await fetchImpl(`${baseUrl}/driver/account/profile`, withNoStoreDriverApiRequest({
      ...(input.name === undefined ? {} : { body: JSON.stringify({ name: input.name.trim() }) }),
      headers: {
        Authorization: `Bearer ${input.accountAccessToken.trim()}`,
        ...(input.name === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      method: input.method,
    }));
    const payload = await response.json();
    if (!response.ok) {
      throw createDriverApiHttpError({ endpoint: 'Driver account profile', status: response.status });
    }

    return { account: readDriverAccountProfileEnvelope(payload) };
  }

  return {
    getAccountProfile: (request) => requestAccountProfile({
      accountAccessToken: request.accountAccessToken,
      method: 'GET',
    }),
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
    updateAccountProfile: (request) => requestAccountProfile({
      accountAccessToken: request.accountAccessToken,
      method: 'PATCH',
      name: request.name,
    }),
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
}, accountProfile: DriverAccountProfile = {
  name: null,
  phone: '+14165550123',
}): DriverAuthService {
  let currentProfile = accountProfile;
  return {
    getAccountProfile: async () => ({ account: currentProfile }),
    login: async () => ({ accountAccess }),
    refreshSession: async () => ({ accountAccess }),
    register: async () => ({ accountAccess }),
    updateAccountProfile: async (request) => {
      currentProfile = { ...currentProfile, name: request.name.trim() };
      return { account: currentProfile };
    },
  };
}

function readDriverAccountProfileEnvelope(payload: unknown): DriverAccountProfile {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver account profile response');
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid driver account profile response');
  }
  const account = (data as { account?: unknown }).account;
  if (typeof account !== 'object' || account === null || Array.isArray(account)) {
    throw new Error('Invalid driver account profile response');
  }
  const record = account as Record<string, unknown>;
  const name = record.name;
  if (
    typeof record.phone !== 'string' || !/^\+[1-9]\d{7,14}$/u.test(record.phone) ||
    (name !== null && (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 80))
  ) {
    throw new Error('Invalid driver account profile response');
  }

  return { name: typeof name === 'string' ? name.trim() : null, phone: record.phone };
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
