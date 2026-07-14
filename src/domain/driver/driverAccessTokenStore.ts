import type { DriverAccountAccessToken } from '../driverAuth/driverAuth';
import {
  isDriverAccessToken,
  type DriverAccessToken,
  type RouteAccessLookupResult,
} from '../routeAccess/routeAccess';

export const DRIVER_ACCESS_TOKEN_STORAGE_KEY = 'clever.driverAccess.v1';

export type SecureTokenStorage = {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

export type PersistedDriverAccess = {
  accountAccess: DriverAccountAccessToken;
  activeRouteSession?: PersistedActiveRouteSession;
  driverAccess?: DriverAccessToken;
  driverProfile: PersistedDriverProfile;
  routeAccess?: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess'];
};

export type PersistedActiveRouteSession = {
  navigationStepIndex: number;
  routePlanId: string;
  status: 'active';
  updatedAt: string;
};

export type PersistedDriverProfile = {
  phoneE164: string;
};

export type DriverAccessRestoreResult =
  | ({ kind: 'active' } & PersistedDriverAccess)
  | ({ kind: 'refresh_required' } & PersistedDriverAccess)
  | { driverProfile?: PersistedDriverProfile; kind: 'expired' }
  | { kind: 'invalid' | 'missing' };

type StoredDriverAccessPayload = PersistedDriverAccess & {
  schemaVersion: 4;
  savedAt: string;
};

export type DriverAccessTokenStore = {
  clear(): Promise<void>;
  clearActiveRouteSession(): Promise<void>;
  clearCachedRouteAccess(): Promise<void>;
  loadActiveDriverAccess(): Promise<DriverAccessRestoreResult>;
  saveActiveRouteSession(input: {
    navigationStepIndex: number;
    routePlanId: string;
  }): Promise<void>;
  saveAuthenticatedDriver(input: {
    accountAccess: DriverAccountAccessToken;
    phoneE164: string;
  }): Promise<void>;
  saveFromInvitedRouteAccess(
    routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>,
  ): Promise<void>;
  saveRefreshedAccountAccess(accountAccess: DriverAccountAccessToken): Promise<void>;
};

export function createDriverAccessTokenStore(input: {
  now?: () => Date;
  storage: SecureTokenStorage;
}): DriverAccessTokenStore {
  const now = input.now ?? (() => new Date());

  async function clear(): Promise<void> {
    await input.storage.deleteItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
  }

  async function loadStoredPayload(): Promise<StoredDriverAccessPayload | null> {
    const rawPayload = await input.storage.getItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
    return rawPayload === null ? null : parseStoredDriverAccessPayload(rawPayload);
  }

  async function updateStoredPayload(
    updater: (payload: StoredDriverAccessPayload) => StoredDriverAccessPayload,
  ): Promise<void> {
    const storedPayload = await loadStoredPayload();
    if (storedPayload === null) {
      return;
    }

    await input.storage.setItemAsync(
      DRIVER_ACCESS_TOKEN_STORAGE_KEY,
      JSON.stringify(updater(storedPayload)),
    );
  }

  return {
    clear,
    clearActiveRouteSession: async () => {
      await updateStoredPayload((payload) => {
        const { activeRouteSession: _activeRouteSession, ...rest } = payload;
        return { ...rest, savedAt: now().toISOString() };
      });
    },
    clearCachedRouteAccess: async () => {
      await updateStoredPayload((payload) => {
        const {
          activeRouteSession: _activeRouteSession,
          driverAccess: _driverAccess,
          routeAccess: _routeAccess,
          ...rest
        } = payload;
        return { ...rest, savedAt: now().toISOString() };
      });
    },
    loadActiveDriverAccess: async () => {
      const rawPayload = await input.storage.getItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
      if (rawPayload === null) {
        return { kind: 'missing' };
      }

      const payload = parseStoredDriverAccessPayload(rawPayload);
      if (payload === null) {
        await clear();
        return { kind: 'invalid' };
      }

      if (isDriverAccessExpired(payload.accountAccess, now())) {
        if (isDriverRefreshTokenValid(payload.accountAccess, now())) {
          return buildDriverAccessRestoreResult('refresh_required', payload);
        }

        await clear();
        return { kind: 'expired', driverProfile: payload.driverProfile };
      }

      return buildDriverAccessRestoreResult('active', payload);
    },
    saveActiveRouteSession: async (activeRouteSession) => {
      const navigationStepIndex = Number.isInteger(activeRouteSession.navigationStepIndex) &&
        activeRouteSession.navigationStepIndex >= 0
        ? activeRouteSession.navigationStepIndex
        : 0;

      await updateStoredPayload((payload) => ({
        ...payload,
        savedAt: now().toISOString(),
        activeRouteSession: {
          navigationStepIndex,
          routePlanId: activeRouteSession.routePlanId,
          status: 'active',
          updatedAt: now().toISOString(),
        },
      }));
    },
    saveAuthenticatedDriver: async (driver) => {
      const payload: StoredDriverAccessPayload = {
        accountAccess: driver.accountAccess,
        driverProfile: { phoneE164: driver.phoneE164.trim() },
        savedAt: now().toISOString(),
        schemaVersion: 4,
      };

      await input.storage.setItemAsync(
        DRIVER_ACCESS_TOKEN_STORAGE_KEY,
        JSON.stringify(payload),
      );
    },
    saveFromInvitedRouteAccess: async (routeAccess) => {
      await updateStoredPayload((payload) => ({
        ...payload,
        driverAccess: routeAccess.driverAccess,
        routeAccess: routeAccess.routeAccess,
        savedAt: now().toISOString(),
      }));
    },
    saveRefreshedAccountAccess: async (accountAccess) => {
      await updateStoredPayload((payload) => ({
        ...payload,
        accountAccess,
        savedAt: now().toISOString(),
      }));
    },
  };
}

export function isDriverAccessExpired(
  driverAccess: Pick<DriverAccessToken | DriverAccountAccessToken, 'expiresAt'>,
  now: Date,
): boolean {
  const expiresAtMs = Date.parse(driverAccess.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
}

export function isDriverRefreshTokenValid(
  accountAccess: Pick<DriverAccountAccessToken, 'refreshToken' | 'refreshTokenExpiresAt'>,
  now: Date,
): boolean {
  const expiresAtMs = Date.parse(accountAccess.refreshTokenExpiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

function parseStoredDriverAccessPayload(rawPayload: string): StoredDriverAccessPayload | null {
  try {
    const payload: unknown = JSON.parse(rawPayload);
    return isStoredDriverAccessPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

function buildDriverAccessRestoreResult(
  kind: 'active' | 'refresh_required',
  payload: StoredDriverAccessPayload,
): Extract<DriverAccessRestoreResult, { kind: 'active' | 'refresh_required' }> {
  const { savedAt: _savedAt, schemaVersion: _schemaVersion, ...access } = payload;
  return { kind, ...access };
}

function isStoredDriverAccessPayload(value: unknown): value is StoredDriverAccessPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.schemaVersion === 4 &&
    typeof payload.savedAt === 'string' &&
    isDriverAccountAccessToken(payload.accountAccess) &&
    isPersistedDriverProfile(payload.driverProfile) &&
    (payload.driverAccess === undefined || isDriverAccessToken(payload.driverAccess)) &&
    (payload.routeAccess === undefined || isPersistedRouteAccess(payload.routeAccess)) &&
    (payload.activeRouteSession === undefined || isPersistedActiveRouteSession(payload.activeRouteSession))
  );
}

function isDriverAccountAccessToken(value: unknown): value is DriverAccountAccessToken {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const token = value as Record<string, unknown>;
  return (
    typeof token.accessToken === 'string' && token.accessToken.trim() !== '' &&
    typeof token.expiresAt === 'string' && Number.isFinite(Date.parse(token.expiresAt)) &&
    typeof token.refreshToken === 'string' && token.refreshToken.trim() !== '' &&
    typeof token.refreshTokenExpiresAt === 'string' && Number.isFinite(Date.parse(token.refreshTokenExpiresAt)) &&
    token.tokenType === 'Bearer' &&
    typeof token.ttlSeconds === 'number' && Number.isInteger(token.ttlSeconds) && token.ttlSeconds > 0 &&
    token.use === 'driver_account'
  );
}

function isPersistedRouteAccess(
  value: unknown,
): value is NonNullable<PersistedDriverAccess['routeAccess']> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).nextState === 'consent_required' &&
    typeof (value as Record<string, unknown>).routeContext === 'string' &&
    typeof (value as Record<string, unknown>).routePlanId === 'string'
  );
}

function isPersistedDriverProfile(value: unknown): value is PersistedDriverProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return typeof profile.phoneE164 === 'string' && /^\+[1-9]\d{7,14}$/u.test(profile.phoneE164.trim());
}

function isPersistedActiveRouteSession(value: unknown): value is PersistedActiveRouteSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    session.status === 'active' &&
    typeof session.routePlanId === 'string' && session.routePlanId.trim() !== '' &&
    Number.isInteger(session.navigationStepIndex) && (session.navigationStepIndex as number) >= 0 &&
    typeof session.updatedAt === 'string' && Number.isFinite(Date.parse(session.updatedAt))
  );
}
