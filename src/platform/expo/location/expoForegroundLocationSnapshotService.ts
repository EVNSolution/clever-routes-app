import * as Location from 'expo-location';

import type { ForegroundLocationSnapshotService } from '../../../domain/location/foregroundLocationEvent';
import { captureDriverDiagnosticEmitter } from '../../../domain/diagnostics/driverDiagnosticObservation';

const FOREGROUND_LOCATION_SNAPSHOT_TIMEOUT_MS = 5_000;

export function createExpoForegroundLocationSnapshotService(): ForegroundLocationSnapshotService {
  return {
    getCurrentForegroundLocation: async () => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutError = new Error('Foreground location snapshot timed out.');
      try {
        const position = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(timeoutError),
              FOREGROUND_LOCATION_SNAPSHOT_TIMEOUT_MS,
            );
          }),
        ]);

        emitDiagnostic({
          clearReasonCodes: ['LOCATION_SNAPSHOT_FAILED', 'OPERATION_TIMEOUT'],
          collectedAt: new Date(position.timestamp).toISOString(),
          kind: 'STATE',
        });

        return {
          accuracyMeters: position.coords.accuracy,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          recordedAt: new Date(position.timestamp),
        };
      } catch (error) {
        emitDiagnostic({
          blocker: {
            reasonCode: error === timeoutError ? 'OPERATION_TIMEOUT' : 'LOCATION_SNAPSHOT_FAILED',
            stage: 'LOCATION',
          },
          kind: 'STATE',
        });
        throw error;
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}
