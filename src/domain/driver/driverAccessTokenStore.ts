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
  pickupCompletedAt?: string;
  routePlanId: string;
  routeStartedRecordedAt?: string;
  startedAt?: string;
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
  clearActiveRouteSession(routePlanId?: string, startedAt?: string): Promise<boolean>;
  clearCachedRouteAccess(routePlanId?: string): Promise<boolean>;
  loadActiveDriverAccess(): Promise<DriverAccessRestoreResult>;
  markActiveRouteStarted(routePlanId: string, startedAt: string): Promise<boolean>;
  saveActiveRouteSession(input: {
    navigationStepIndex: number;
    pickupCompleted?: boolean;
    routePlanId: string;
    startedAt?: string;
  }): Promise<boolean>;
  saveAuthenticatedDriver(input: {
    accountAccess: DriverAccountAccessToken;
    phoneE164: string;
  }): Promise<void>;
  saveFromInvitedRouteAccess(
    routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>,
  ): Promise<boolean>;
  saveRefreshedAccountAccess(accountAccess: DriverAccountAccessToken): Promise<void>;
};

export function createDriverAccessTokenStore(input: {
  now?: () => Date;
  storage: SecureTokenStorage;
}): DriverAccessTokenStore {
  const now = input.now ?? (() => new Date());
  let operationQueue = Promise.resolve();

  function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.catch(() => undefined).then(operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function clearStoredPayload(): Promise<void> {
    await input.storage.deleteItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
  }

  async function loadStoredPayload(): Promise<StoredDriverAccessPayload | null> {
    const rawPayload = await input.storage.getItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
    return rawPayload === null ? null : parseStoredDriverAccessPayload(rawPayload);
  }

  async function updateStoredPayload(
    updater: (payload: StoredDriverAccessPayload) => StoredDriverAccessPayload | null,
  ): Promise<boolean> {
    const storedPayload = await loadStoredPayload();
    if (storedPayload === null) {
      return false;
    }
    const updatedPayload = updater(storedPayload);
    if (updatedPayload === null) {
      return false;
    }

    await input.storage.setItemAsync(
      DRIVER_ACCESS_TOKEN_STORAGE_KEY,
      JSON.stringify(updatedPayload),
    );
    return true;
  }

  return {
    clear: () => runSerialized(clearStoredPayload),
    clearActiveRouteSession: (routePlanId, startedAt) => runSerialized(() => updateStoredPayload((payload) => {
      const persistedStartedAt = payload.activeRouteSession?.startedAt ?? payload.activeRouteSession?.updatedAt;
      if (
        routePlanId !== undefined
        && (
          payload.activeRouteSession?.routePlanId !== routePlanId
          || (startedAt !== undefined && persistedStartedAt !== startedAt)
        )
      ) {
        return null;
      }
      const { activeRouteSession: _activeRouteSession, ...rest } = payload;
      return { ...rest, savedAt: now().toISOString() };
    })),
    clearCachedRouteAccess: (routePlanId) => runSerialized(() => updateStoredPayload((payload) => {
      if (
        routePlanId !== undefined
        && (
          payload.activeRouteSession !== undefined
          || payload.routeAccess?.routePlanId !== routePlanId
        )
      ) {
        return null;
      }
      const {
        activeRouteSession: _activeRouteSession,
        driverAccess: _driverAccess,
        routeAccess: _routeAccess,
        ...rest
      } = payload;
      return { ...rest, savedAt: now().toISOString() };
    })),
    loadActiveDriverAccess: () => runSerialized(async () => {
      const rawPayload = await input.storage.getItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY);
      if (rawPayload === null) {
        return { kind: 'missing' };
      }

      const payload = parseStoredDriverAccessPayload(rawPayload);
      if (payload === null) {
        await clearStoredPayload();
        return { kind: 'invalid' };
      }

      if (isDriverAccessExpired(payload.accountAccess, now())) {
        if (isDriverRefreshTokenValid(payload.accountAccess, now())) {
          return buildDriverAccessRestoreResult('refresh_required', payload);
        }

        await clearStoredPayload();
        return { kind: 'expired', driverProfile: payload.driverProfile };
      }

      return buildDriverAccessRestoreResult('active', payload);
    }),
    markActiveRouteStarted: (routePlanId, startedAt) => runSerialized(() => updateStoredPayload((payload) => {
      const activeRouteSession = payload.activeRouteSession;
      const persistedStartedAt = activeRouteSession?.startedAt ?? activeRouteSession?.updatedAt;
      if (
        activeRouteSession?.routePlanId !== routePlanId
        || persistedStartedAt !== startedAt
      ) {
        return null;
      }
      return {
        ...payload,
        activeRouteSession: {
          ...activeRouteSession,
          routeStartedRecordedAt: now().toISOString(),
        },
        savedAt: now().toISOString(),
      };
    })),
    saveActiveRouteSession: (activeRouteSession) => {
      const navigationStepIndex = Number.isInteger(activeRouteSession.navigationStepIndex) &&
        activeRouteSession.navigationStepIndex >= 0
        ? activeRouteSession.navigationStepIndex
        : 0;

      return runSerialized(() => updateStoredPayload((payload) => {
        if (
          payload.driverAccess === undefined
          || payload.routeAccess?.routePlanId !== activeRouteSession.routePlanId
        ) {
          return null;
        }
        const currentSession = payload.activeRouteSession?.routePlanId === activeRouteSession.routePlanId
          ? payload.activeRouteSession
          : undefined;
        const requestedStartedAt = activeRouteSession.startedAt !== undefined
          && Number.isFinite(Date.parse(activeRouteSession.startedAt))
          ? activeRouteSession.startedAt
          : undefined;
        return {
          ...payload,
          savedAt: now().toISOString(),
          activeRouteSession: {
            navigationStepIndex,
            ...(currentSession?.pickupCompletedAt === undefined && activeRouteSession.pickupCompleted !== true
              ? {}
              : { pickupCompletedAt: currentSession?.pickupCompletedAt ?? now().toISOString() }),
            routePlanId: activeRouteSession.routePlanId,
            ...(currentSession?.routeStartedRecordedAt === undefined
              ? {}
              : { routeStartedRecordedAt: currentSession.routeStartedRecordedAt }),
            startedAt: currentSession?.startedAt ?? currentSession?.updatedAt ?? requestedStartedAt ?? now().toISOString(),
            status: 'active',
            updatedAt: now().toISOString(),
          },
        };
      }));
    },
    saveAuthenticatedDriver: (driver) => runSerialized(async () => {
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
    }),
    saveFromInvitedRouteAccess: (routeAccess) => runSerialized(() => updateStoredPayload((payload) => (
      payload.activeRouteSession !== undefined
      && payload.activeRouteSession.routePlanId !== routeAccess.routeAccess.routePlanId
        ? null
        : {
            ...payload,
            driverAccess: routeAccess.driverAccess,
            routeAccess: routeAccess.routeAccess,
            savedAt: now().toISOString(),
          }
    ))),
    saveRefreshedAccountAccess: async (accountAccess) => {
      await runSerialized(() => updateStoredPayload((payload) => ({
        ...payload,
        accountAccess,
        savedAt: now().toISOString(),
      })));
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
    (session.pickupCompletedAt === undefined || (
      typeof session.pickupCompletedAt === 'string' && Number.isFinite(Date.parse(session.pickupCompletedAt))
    )) &&
    (session.startedAt === undefined || (
      typeof session.startedAt === 'string' && Number.isFinite(Date.parse(session.startedAt))
    )) &&
    (session.routeStartedRecordedAt === undefined || (
      typeof session.routeStartedRecordedAt === 'string' && Number.isFinite(Date.parse(session.routeStartedRecordedAt))
    )) &&
    typeof session.updatedAt === 'string' && Number.isFinite(Date.parse(session.updatedAt))
  );
}
