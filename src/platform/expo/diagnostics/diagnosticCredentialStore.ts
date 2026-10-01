import type {
  DiagnosticCredential,
  DiagnosticCredentialStore,
} from '../../../domain/diagnostics/driverDiagnosticTransport';

export const DRIVER_DIAGNOSTIC_CREDENTIAL_KEY_PREFIX = 'clever.driverDiagnostics.writeCredential.v1.';

type CredentialStorage = {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

export function createDiagnosticCredentialStore(input: {
  storage: CredentialStorage;
}): DiagnosticCredentialStore {
  const operationQueues = new Map<string, Promise<void>>();

  function runSerialized<T>(accountOwnerHash: string, operation: (key: string) => Promise<T>): Promise<T> {
    const key = credentialKey(accountOwnerHash);
    const previous = operationQueues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => operation(key));
    const settled = result.then(() => undefined, () => undefined);
    operationQueues.set(key, settled);
    void settled.then(() => {
      if (operationQueues.get(key) === settled) operationQueues.delete(key);
    });
    return result;
  }

  return {
    get: (accountOwnerHash) => runSerialized(accountOwnerHash, async (key) => {
      const value = await input.storage.getItemAsync(key);
      if (value === null) return null;
      const parsed = parseCredential(value);
      if (parsed !== null) return parsed;
      await input.storage.deleteItemAsync(key);
      return null;
    }),
    remove: (accountOwnerHash, expectedToken?: string) => runSerialized(accountOwnerHash, async (key) => {
      if (expectedToken === undefined) {
        await input.storage.deleteItemAsync(key);
        return;
      }
      const value = await input.storage.getItemAsync(key);
      if (value === null) return;
      const current = parseCredential(value);
      if (current === null || current.token === expectedToken) await input.storage.deleteItemAsync(key);
    }),
    set: async (accountOwnerHash, credential) => {
      const normalized = normalizeCredential(credential);
      if (normalized === null) throw new Error('Cannot persist invalid diagnostic credential.');
      await runSerialized(accountOwnerHash, (key) => input.storage.setItemAsync(key, JSON.stringify(normalized)));
    },
  };
}

function credentialKey(accountOwnerHash: string) {
  if (!/^[0-9a-f]{64}$/u.test(accountOwnerHash)) {
    throw new Error('Diagnostic credential storage requires a lowercase SHA-256 account owner hash.');
  }
  return `${DRIVER_DIAGNOSTIC_CREDENTIAL_KEY_PREFIX}${accountOwnerHash}`;
}

function parseCredential(value: string): DiagnosticCredential | null {
  try {
    return normalizeCredential(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function normalizeCredential(value: unknown): DiagnosticCredential | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'expiresAt'
    || keys[1] !== 'token'
    || typeof candidate.token !== 'string'
    || candidate.token.length < 1
    || candidate.token.length > 8_192
    || typeof candidate.expiresAt !== 'string'
    || candidate.expiresAt.length > 40
  ) return null;
  const expiresAt = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  return { expiresAt: new Date(expiresAt).toISOString(), token: candidate.token };
}
