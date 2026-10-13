import AsyncStorage from '@react-native-async-storage/async-storage';

import { createPreStartLocationNoticeStore } from '../../../domain/preferences/preStartLocationNotice';

export function createExpoPreStartLocationNoticeStore() {
  return createPreStartLocationNoticeStore(AsyncStorage);
}
