import * as Location from 'expo-location';

import type { ForegroundLocationSnapshotService } from '../../../domain/location/foregroundLocationEvent';

export function createExpoForegroundLocationSnapshotService(): ForegroundLocationSnapshotService {
  return {
    getCurrentForegroundLocation: async () => {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        recordedAt: new Date(position.timestamp),
      };
    },
  };
}
