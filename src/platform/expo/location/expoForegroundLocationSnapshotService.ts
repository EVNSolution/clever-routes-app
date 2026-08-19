import * as Location from 'expo-location';

import type { ForegroundLocationSnapshotService } from '../../../domain/location/foregroundLocationEvent';

const FOREGROUND_LOCATION_SNAPSHOT_TIMEOUT_MS = 5_000;

export function createExpoForegroundLocationSnapshotService(): ForegroundLocationSnapshotService {
  return {
    getCurrentForegroundLocation: async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const position = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('Foreground location snapshot timed out.')),
              FOREGROUND_LOCATION_SNAPSHOT_TIMEOUT_MS,
            );
          }),
        ]);

        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          recordedAt: new Date(position.timestamp),
        };
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}
