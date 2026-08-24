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

  return {
    next(sessionKey: string): Promise<{ deviceInstanceHash: string; heartbeatSequence: number; sessionGeneration: string }> {
      const result = operation.catch(() => undefined).then(async () => {
        const raw = await input.storage.getItemAsync(STORAGE_KEY);
        const parsed = parseIdentity(raw);
        const identity: PersistedIdentity = parsed ?? {
          deviceInstanceHash: await input.createDeviceInstanceHash(),
          sessions: {},
        };
        const current = identity.sessions[sessionKey] ?? { sequence: 0, sessionGeneration: now().toISOString() };
        const next = { sequence: current.sequence + 1, sessionGeneration: current.sessionGeneration };
        identity.sessions[sessionKey] = next;
        await input.storage.setItemAsync(STORAGE_KEY, JSON.stringify(identity));
        return {
          deviceInstanceHash: identity.deviceInstanceHash,
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
