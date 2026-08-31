import AsyncStorage from '@react-native-async-storage/async-storage';

import { createAndroidMapHandlerStore } from '../../../domain/navigation/androidMapHandlerSelection';

export function createExpoAndroidMapHandlerStore() {
  return createAndroidMapHandlerStore(AsyncStorage);
}
