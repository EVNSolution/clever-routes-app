import {
  isDriverAccessToken,
  type DriverAccessToken,
  type RouteAccessLookupResult,
} from './routeAccess';

export const DRIVER_ACCESS_TOKEN_STORAGE_KEY = 'clever.driverAccess.v1';

export type SecureTokenStorage = {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

export type PersistedDriverAccess = {
  driverAccess: DriverAccessToken;
  routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess'];
};

export type DriverAccessRestoreResult =
  | ({ kind: 'active' } & PersistedDriverAccess)
  | { kind: 'expired' | 'invalid' | 'missing' };

type StoredDriverAccessPayload = PersistedDriverAccess & {
  schemaVersion: 1;
  savedAt: string;
};

export type DriverAccessTokenStore = {
  clear(): Promise<void>;
  loadActiveDriverAccess(): Promise<DriverAccessRestoreResult>;
  saveFromInvitedRouteAccess(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>): Promise<void>;
};

export function createDriverAccessTokenStore(input: {
  now?: () => Date;
  storage: SecureTokenStorage;
}): DriverAccessTokenStore {
  const now = input.now ?? (() => new Date());

  async function clear(): Promise<void> {
    await input.storage.deleteItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
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
        await clear();
        return { kind: 'expired' };
      }

      return {
        kind: 'active',
        driverAccess: payload.driverAccess,
        routeAccess: payload.routeAccess,
      };
    },
    saveFromInvitedRouteAccess: async (routeAccess) => {
      const payload: StoredDriverAccessPayload = {
        schemaVersion: 1,
        savedAt: now().toISOString(),
        driverAccess: routeAccess.driverAccess,
        routeAccess: routeAccess.routeAccess,
      };

      await input.storage.setItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY, JSON.stringify(payload));
    },
  };
}

export function isDriverAccessExpired(driverAccess: DriverAccessToken, now: Date): boolean {
  const expiresAtMs = Date.parse(driverAccess.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime();
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

function isStoredDriverAccessPayload(value: unknown): value is StoredDriverAccessPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const routeAccess = payload.routeAccess;
  return (
    payload.schemaVersion === 1 &&
    typeof payload.savedAt === 'string' &&
    isDriverAccessToken(payload.driverAccess) &&
    typeof routeAccess === 'object' &&
    routeAccess !== null &&
    !Array.isArray(routeAccess) &&
    (routeAccess as Record<string, unknown>).nextState === 'consent_required' &&
    typeof (routeAccess as Record<string, unknown>).routeContext === 'string' &&
    typeof (routeAccess as Record<string, unknown>).routePlanId === 'string'
  );
}
