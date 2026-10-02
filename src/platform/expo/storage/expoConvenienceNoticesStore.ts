import AsyncStorage from '@react-native-async-storage/async-storage';

import { createConvenienceNoticesStore } from '../../../domain/preferences/convenienceNotices';

export function createExpoConvenienceNoticesStore() {
  return createConvenienceNoticesStore(AsyncStorage);
}
