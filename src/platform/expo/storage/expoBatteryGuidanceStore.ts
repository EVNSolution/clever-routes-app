import AsyncStorage from '@react-native-async-storage/async-storage';

import { createBatteryGuidanceStore } from '../../../domain/preferences/batteryGuidance';

export function createExpoBatteryGuidanceStore() {
  return createBatteryGuidanceStore(AsyncStorage);
}
