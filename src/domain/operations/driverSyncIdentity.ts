export type DriverSyncIdentityStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

type PersistedIdentity = {
  deviceInstanceHash: string;
  sessions: Record<string, { sequence: number; sessionGeneration: string }>;
};

const STORAGE_KEY = 'clever.driverSyncIdentity.v1';

export function createDriverSyncIdentity(input: {
  createDeviceInstanceHash(): Promise<string>;
  now?: () => Date;
  storage: DriverSyncIdentityStorage;
}) {
  const now = input.now ?? (() => new Date());
  let operation = Promise.resolve();
  let identity: PersistedIdentity | null = null;
  let initialization: Promise<PersistedIdentity> | null = null;

  function loadIdentity(): Promise<PersistedIdentity> {
    if (identity !== null) return Promise.resolve(identity);
    if (initialization !== null) return initialization;

    const pending = (async () => {
      const parsed = parseIdentity(await input.storage.getItemAsync(STORAGE_KEY));
      if (parsed !== null) {
        identity = parsed;
        return parsed;
      }

      const created: PersistedIdentity = {
        deviceInstanceHash: await input.createDeviceInstanceHash(),
        sessions: {},
      };
      await input.storage.setItemAsync(STORAGE_KEY, JSON.stringify(created));
      identity = created;
      return created;
    })();
    initialization = pending;
    void pending.catch(() => {
      if (initialization === pending) initialization = null;
    });
    return pending;
  }

  return {
    getDeviceInstanceHash(): Promise<string> {
      return loadIdentity().then((current) => current.deviceInstanceHash);
    },
    next(sessionKey: string): Promise<{ deviceInstanceHash: string; heartbeatSequence: number; sessionGeneration: string }> {
      const result = operation.catch(() => undefined).then(async () => {
        const currentIdentity = await loadIdentity();
        const current = currentIdentity.sessions[sessionKey] ?? { sequence: 0, sessionGeneration: now().toISOString() };
        const next = { sequence: current.sequence + 1, sessionGeneration: current.sessionGeneration };
        const updatedIdentity: PersistedIdentity = {
          deviceInstanceHash: currentIdentity.deviceInstanceHash,
          sessions: { ...currentIdentity.sessions, [sessionKey]: next },
        };
        await input.storage.setItemAsync(STORAGE_KEY, JSON.stringify(updatedIdentity));
        identity = updatedIdentity;
        return {
          deviceInstanceHash: updatedIdentity.deviceInstanceHash,
          heartbeatSequence: next.sequence,
          sessionGeneration: next.sessionGeneration,
        };
      });
      operation = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

function parseIdentity(raw: string | null): PersistedIdentity | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as PersistedIdentity;
    if (!/^[a-f0-9]{64}$/u.test(value.deviceInstanceHash) || typeof value.sessions !== 'object' || value.sessions === null) return null;
    for (const session of Object.values(value.sessions)) {
      if (!Number.isSafeInteger(session.sequence) || session.sequence < 0 || new Date(session.sessionGeneration).toISOString() !== session.sessionGeneration) return null;
    }
    return value;
  } catch {
    return null;
  }
}
