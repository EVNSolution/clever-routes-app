import * as Location from 'expo-location';

import type { ForegroundLocationPermissionService, ForegroundLocationPermissionStatus } from '../../../domain/delivery/deliveryStart';
import { captureDriverDiagnosticEmitter } from '../../../domain/diagnostics/driverDiagnosticObservation';

export function createExpoForegroundLocationPermissionService(): ForegroundLocationPermissionService {
  return {
    requestForegroundPermission: async () => {
      const emitDiagnostic = captureDriverDiagnosticEmitter();
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        emitDiagnostic({
          ...(permission.status === Location.PermissionStatus.GRANTED
            ? {}
            : { blocker: { reasonCode: 'LOCATION_PERMISSION_DENIED', stage: 'LOCATION' as const } }),
          clearReasonCodes: permission.status === Location.PermissionStatus.GRANTED
            ? ['LOCATION_PERMISSION_DENIED', 'LOCATION_PERMISSION_STATUS_FAILED']
            : ['LOCATION_PERMISSION_STATUS_FAILED'],
          kind: 'STATE',
          patch: {
            locationPermission: permission.status === Location.PermissionStatus.GRANTED
              ? 'GRANTED_FOREGROUND'
              : 'DENIED',
          },
        });
        return { status: normalizePermissionStatus(permission.status) };
      } catch (error) {
        emitDiagnostic({
          blocker: { reasonCode: 'LOCATION_PERMISSION_STATUS_FAILED', stage: 'LOCATION' },
          kind: 'STATE',
          patch: { locationPermission: 'UNKNOWN' },
        });
        throw error;
      }
    },
  };
}

function normalizePermissionStatus(status: Location.PermissionStatus): ForegroundLocationPermissionStatus {
  return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
}
