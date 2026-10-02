import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAndroidMapHandlerStore,
  openWithAndroidMapHandler,
} from './androidMapHandlerSelection';

function createMemoryStorage(initialValue: string | null = null) {
  let value = initialValue;

  return {
    async getItem(): Promise<string | null> {
      return value;
    },
    async removeItem(): Promise<void> {
      value = null;
    },
    async setItem(_key: string, nextValue: string): Promise<void> {
      value = nextValue;
    },
    value(): string | null {
      return value;
    },
  };
}

function unavailableMapAppError(): Error & { code: string } {
  return Object.assign(new Error('Selected map app is unavailable.'), {
    code: 'map_app_unavailable',
  });
}

describe('Android map handler selection', () => {
  it('uses a saved Android handler without reopening the picker', async () => {
    const storage = createMemoryStorage('com.google.android.apps.maps');
    const store = createAndroidMapHandlerStore(storage);
    const opened: { packageName: string; url: string }[] = [];
    let pickerCalls = 0;

    await openWithAndroidMapHandler({
      bridge: {
        open: async (url, packageName) => {
          opened.push({ packageName, url });
        },
        pickMapApp: async () => {
          pickerCalls += 1;
          return 'com.waze';
        },
      },
      store,
      url: 'clever-routes-map://navigate?address=100%20King%20St%20W',
    });

    assert.equal(pickerCalls, 0);
    assert.deepEqual(opened, [{
      packageName: 'com.google.android.apps.maps',
      url: 'clever-routes-map://navigate?address=100%20King%20St%20W',
    }]);
  });

  it('asks Android once, saves the selected package, and opens the destination', async () => {
    const storage = createMemoryStorage();
    const store = createAndroidMapHandlerStore(storage);
    const opened: { packageName: string; url: string }[] = [];

    await openWithAndroidMapHandler({
      bridge: {
        open: async (url, packageName) => {
          opened.push({ packageName, url });
        },
        pickMapApp: async (url) => {
          assert.equal(url, 'clever-routes-map://navigate?address=100%20King%20St%20W');
          return 'com.waze';
        },
      },
      store,
      url: 'clever-routes-map://navigate?address=100%20King%20St%20W',
    });

    assert.equal(storage.value(), 'com.waze');
    assert.deepEqual(opened, [{
      packageName: 'com.waze',
      url: 'clever-routes-map://navigate?address=100%20King%20St%20W',
    }]);
  });

  it('clears an unavailable package and retries once with a fresh Android selection', async () => {
    const storage = createMemoryStorage('com.removed.maps');
    const store = createAndroidMapHandlerStore(storage);
    const openedPackages: string[] = [];
    let pickerCalls = 0;

    await openWithAndroidMapHandler({
      bridge: {
        async open(_url, packageName) {
          openedPackages.push(packageName);
          if (packageName === 'com.removed.maps') {
            throw unavailableMapAppError();
          }
        },
        async pickMapApp() {
          pickerCalls += 1;
          return 'com.waze';
        },
      },
      store,
      url: 'clever-routes-map://navigate?latitude=43.6487&longitude=-79.3817',
    });

    assert.equal(pickerCalls, 1);
    assert.equal(storage.value(), 'com.waze');
    assert.deepEqual(openedPackages, ['com.removed.maps', 'com.waze']);
  });

  it('does not store or open anything when the first picker is cancelled', async () => {
    const storage = createMemoryStorage();
    const store = createAndroidMapHandlerStore(storage);
    let openCalls = 0;

    await assert.rejects(
      openWithAndroidMapHandler({
        bridge: {
          open: async () => {
            openCalls += 1;
          },
          pickMapApp: async () => null,
        },
        store,
        url: 'clever-routes-map://navigate?address=100%20King%20St%20W',
      }),
      /Map app selection was cancelled/u,
    );

    assert.equal(storage.value(), null);
    assert.equal(openCalls, 0);
  });

  it('clears the saved package so the next navigation asks Android again', async () => {
    const storage = createMemoryStorage('com.google.android.apps.maps');
    const store = createAndroidMapHandlerStore(storage);

    await store.clear();

    assert.equal(storage.value(), null);
  });

  it('normalizes blank persisted values to no selection', async () => {
    const store = createAndroidMapHandlerStore(createMemoryStorage('   '));

    assert.equal(await store.load(), null);
  });
});
