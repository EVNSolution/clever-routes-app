import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDetailedActiveRouteNotificationStore } from '../../../domain/preferences/detailedActiveRouteNotification';

export function createExpoDetailedActiveRouteNotificationStore() {
  return createDetailedActiveRouteNotificationStore(AsyncStorage);
}
