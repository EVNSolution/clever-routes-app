export const ANDROID_MAP_HANDLER_STORAGE_KEY = 'clever.androidMapHandlerPackage.v1';

type AndroidMapHandlerStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

export type AndroidMapHandlerStore = {
  clear(): Promise<void>;
  load(): Promise<string | null>;
  save(packageName: string): Promise<void>;
};

export type AndroidMapHandlerBridge = {
  open(url: string, packageName: string): Promise<void>;
  pickMapApp(url: string | null): Promise<string | null>;
};

export function createAndroidMapHandlerStore(
  storage: AndroidMapHandlerStorage,
): AndroidMapHandlerStore {
  return {
    clear: () => storage.removeItem(ANDROID_MAP_HANDLER_STORAGE_KEY),
    async load() {
      const packageName = (await storage.getItem(ANDROID_MAP_HANDLER_STORAGE_KEY))?.trim();
      return packageName === undefined || packageName === '' ? null : packageName;
    },
    save(packageName) {
      return storage.setItem(ANDROID_MAP_HANDLER_STORAGE_KEY, packageName);
    },
  };
}

export async function openWithAndroidMapHandler(input: {
  bridge: AndroidMapHandlerBridge;
  store: AndroidMapHandlerStore;
  url: string;
}): Promise<void> {
  let packageName = await input.store.load();
  if (packageName === null) {
    packageName = await selectAndSave(input.bridge, input.store, input.url);
  }

  try {
    await input.bridge.open(input.url, packageName);
  } catch (error) {
    if (!isUnavailableMapAppError(error)) {
      throw error;
    }

    await input.store.clear();
    packageName = await selectAndSave(input.bridge, input.store, input.url);
    try {
      await input.bridge.open(input.url, packageName);
    } catch (retryError) {
      if (isUnavailableMapAppError(retryError)) {
        await input.store.clear();
      }
      throw retryError;
    }
  }
}

async function selectAndSave(
  bridge: AndroidMapHandlerBridge,
  store: AndroidMapHandlerStore,
  url: string,
): Promise<string> {
  const packageName = await bridge.pickMapApp(url);
  if (packageName === null) {
    throw Object.assign(new Error('Map app selection was cancelled.'), {
      code: 'map_app_selection_cancelled',
    });
  }

  await store.save(packageName);
  return packageName;
}

function isUnavailableMapAppError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'map_app_unavailable';
}
