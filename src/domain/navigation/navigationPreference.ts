export type NavigationProvider = 'google' | 'waze';

export const DEFAULT_NAVIGATION_PROVIDER: NavigationProvider = 'google';
export const NAVIGATION_PROVIDER_STORAGE_KEY = 'clever.navigationProvider.v1';

type NavigationPreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createNavigationPreferenceStore(storage: NavigationPreferenceStorage) {
  let writeQueue: Promise<void> | null = null;

  return {
    async load(): Promise<NavigationProvider> {
      const value = await storage.getItem(NAVIGATION_PROVIDER_STORAGE_KEY);
      return value === 'waze' || value === 'google' ? value : DEFAULT_NAVIGATION_PROVIDER;
    },
    save(provider: NavigationProvider): Promise<void> {
      const write = writeQueue === null
        ? storage.setItem(NAVIGATION_PROVIDER_STORAGE_KEY, provider)
        : writeQueue
          .catch(() => undefined)
          .then(() => storage.setItem(NAVIGATION_PROVIDER_STORAGE_KEY, provider));
      writeQueue = write.then(() => undefined, () => undefined);
      return write;
    },
  };
}
