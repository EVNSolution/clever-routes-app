import * as Location from 'expo-location';

import type { ForegroundLocationPermissionService, ForegroundLocationPermissionStatus } from './deliveryStart';

export function createExpoForegroundLocationPermissionService(): ForegroundLocationPermissionService {
  return {
    requestForegroundPermission: async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      return { status: normalizePermissionStatus(permission.status) };
    },
  };
}

function normalizePermissionStatus(status: Location.PermissionStatus): ForegroundLocationPermissionStatus {
  return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
}
