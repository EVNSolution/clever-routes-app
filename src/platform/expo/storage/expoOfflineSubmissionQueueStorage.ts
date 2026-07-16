import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createPersistentOfflineSubmissionQueue,
  type OfflineSubmissionQueue,
  type OfflineSubmissionQueueStorage,
} from '../../../domain/offline/offlineSubmissionQueue';

let offlineSubmissionQueuePromise: Promise<OfflineSubmissionQueue> | null = null;

export function createExpoOfflineSubmissionQueueStorage(): OfflineSubmissionQueueStorage {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    removeItem: (key) => AsyncStorage.removeItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  };
}

export function getExpoOfflineSubmissionQueue(): Promise<OfflineSubmissionQueue> {
  if (offlineSubmissionQueuePromise === null) {
    offlineSubmissionQueuePromise = createPersistentOfflineSubmissionQueue({
      storage: createExpoOfflineSubmissionQueueStorage(),
    }).catch((error: unknown) => {
      offlineSubmissionQueuePromise = null;
      throw error;
    });
  }
  return offlineSubmissionQueuePromise;
}
