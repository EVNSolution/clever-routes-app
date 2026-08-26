import AsyncStorage from '@react-native-async-storage/async-storage';

import { createNavigationPreferenceStore } from '../../../domain/navigation/navigationPreference';

export function createExpoNavigationPreferenceStore() {
  return createNavigationPreferenceStore(AsyncStorage);
}
