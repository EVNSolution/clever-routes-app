import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OfflineSubmissionQueueStorage } from '../../../domain/offline/offlineSubmissionQueue';

export function createExpoOfflineSubmissionQueueStorage(): OfflineSubmissionQueueStorage {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    removeItem: (key) => AsyncStorage.removeItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  };
}
