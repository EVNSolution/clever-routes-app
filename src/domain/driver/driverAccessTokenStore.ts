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
  driverAccess: DriverAccessToken;
  driverProfile?: PersistedDriverProfile;
  routeAccess?: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess'];
};

export type PersistedDriverProfile = {
  displayName: string;
  phoneE164: string;
};

export type DriverAccessRestoreResult =
  | ({ kind: 'active' } & PersistedDriverAccess)
  | ({ kind: 'refresh_required' } & PersistedDriverAccess)
  | {
      driverProfile?: PersistedDriverProfile;
      isReturningDriver: boolean;
      kind: 'expired';
      routeAccess?: PersistedDriverAccess['routeAccess'];
    }
  | { kind: 'invalid' | 'missing' };

type StoredDriverAccessPayload = PersistedDriverAccess & {
  schemaVersion: 1 | 2;
  savedAt: string;
};

export type DriverAccessTokenStore = {
  clear(): Promise<void>;
  loadActiveDriverAccess(): Promise<DriverAccessRestoreResult>;
  saveFromInvitedRouteAccess(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>): Promise<void>;
  saveVerifiedDriver(input: {
    displayName: string;
    driverAccess: DriverAccessToken;
    phoneE164: string;
  }): Promise<void>;
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

  return {
    clear,
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

      if (isDriverAccessExpired(payload.driverAccess, now())) {
        if (isDriverRefreshTokenValid(payload.driverAccess, now())) {
          return buildDriverAccessRestoreResult('refresh_required', payload);
        }
        await clear();
        return {
          kind: 'expired',
          isReturningDriver: true,
          ...optionalDriverProfile(payload.driverProfile),
          ...optionalRouteAccess(payload.routeAccess),
        };
      }

      return buildDriverAccessRestoreResult('active', payload);
    },
    saveFromInvitedRouteAccess: async (routeAccess) => {
      const storedPayload = await loadStoredPayload();
      const payload: StoredDriverAccessPayload = {
        schemaVersion: 2,
        savedAt: now().toISOString(),
        driverAccess: mergeRefreshTokenFromStoredAccess(routeAccess.driverAccess, storedPayload?.driverAccess, now()),
        ...optionalDriverProfile(storedPayload?.driverProfile),
        routeAccess: routeAccess.routeAccess,
      };

      await input.storage.setItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY, JSON.stringify(payload));
    },
    saveVerifiedDriver: async (driver) => {
      const payload: StoredDriverAccessPayload = {
        schemaVersion: 2,
        savedAt: now().toISOString(),
        driverAccess: driver.driverAccess,
        driverProfile: {
          displayName: driver.displayName.trim(),
          phoneE164: driver.phoneE164.trim(),
        },
      };

      await input.storage.setItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY, JSON.stringify(payload));
    },
  };
}

export function isDriverAccessExpired(driverAccess: DriverAccessToken, now: Date): boolean {
  const expiresAtMs = Date.parse(driverAccess.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
}

export function isDriverRefreshTokenValid(driverAccess: DriverAccessToken, now: Date): boolean {
  if (!driverAccess.refreshToken || !driverAccess.refreshTokenExpiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(driverAccess.refreshTokenExpiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

function parseStoredDriverAccessPayload(rawPayload: string): StoredDriverAccessPayload | null {
  try {
    const payload: unknown = JSON.parse(rawPayload);
    if (!isStoredDriverAccessPayload(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function buildDriverAccessRestoreResult(
  kind: 'active' | 'refresh_required',
  payload: StoredDriverAccessPayload,
): Extract<DriverAccessRestoreResult, { kind: 'active' | 'refresh_required' }> {
  return {
    kind,
    driverAccess: payload.driverAccess,
    ...optionalDriverProfile(payload.driverProfile),
    ...optionalRouteAccess(payload.routeAccess),
  };
}

function isStoredDriverAccessPayload(value: unknown): value is StoredDriverAccessPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const routeAccess = payload.routeAccess;
  const driverProfile = payload.driverProfile;
  return (
    (payload.schemaVersion === 1 || payload.schemaVersion === 2) &&
    typeof payload.savedAt === 'string' &&
    isDriverAccessToken(payload.driverAccess) &&
    (driverProfile === undefined || isPersistedDriverProfile(driverProfile)) &&
    (driverProfile !== undefined || routeAccess !== undefined) &&
    (routeAccess === undefined || isPersistedRouteAccess(routeAccess))
  );
}

function isPersistedRouteAccess(value: unknown): value is PersistedDriverAccess['routeAccess'] {
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
  return (
    typeof profile.displayName === 'string' &&
    profile.displayName.trim() !== '' &&
    typeof profile.phoneE164 === 'string' &&
    /^\+[1-9]\d{7,14}$/u.test(profile.phoneE164.trim())
  );
}

function mergeRefreshTokenFromStoredAccess(
  driverAccess: DriverAccessToken,
  storedDriverAccess: DriverAccessToken | undefined,
  now: Date,
): DriverAccessToken {
  if (driverAccess.refreshToken !== undefined || storedDriverAccess === undefined || !isDriverRefreshTokenValid(storedDriverAccess, now)) {
    return driverAccess;
  }

  return {
    ...driverAccess,
    refreshToken: storedDriverAccess.refreshToken,
    refreshTokenExpiresAt: storedDriverAccess.refreshTokenExpiresAt,
  };
}

function optionalDriverProfile(driverProfile: PersistedDriverProfile | undefined): Pick<PersistedDriverAccess, 'driverProfile'> | Record<string, never> {
  return driverProfile === undefined ? {} : { driverProfile };
}

function optionalRouteAccess(routeAccess: PersistedDriverAccess['routeAccess'] | undefined): Pick<PersistedDriverAccess, 'routeAccess'> | Record<string, never> {
  return routeAccess === undefined ? {} : { routeAccess };
}
