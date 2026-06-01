import type { DriverFlowState } from '../driverFlow/driverFlow';

export type ForegroundLocationPermissionStatus = 'denied' | 'granted' | 'undetermined';

export type ForegroundLocationPermissionService = {
  requestForegroundPermission(): Promise<{ status: ForegroundLocationPermissionStatus }>;
};

export type DeliveryStartResult =
  | {
      flowState: Exclude<DriverFlowState, 'delivery_active'>;
      kind: 'blocked';
      message: string;
      reason: 'route_not_ready';
    }
  | {
      flowState: 'route_ready';
      kind: 'permission_denied';
      message: string;
      reason: 'foreground_location_denied';
    }
  | {
      flowState: 'delivery_active';
      kind: 'delivery_active';
      locationPermission: 'foreground';
      message: string;
    };

export async function startDeliveryWithForegroundPermission(input: {
  flowState: DriverFlowState;
  permissionService: ForegroundLocationPermissionService;
}): Promise<DeliveryStartResult> {
  if (input.flowState !== 'route_ready') {
    return {
      flowState: input.flowState as Exclude<DriverFlowState, 'delivery_active'>,
      kind: 'blocked',
      reason: 'route_not_ready',
      message: 'Load the assigned route before starting delivery.',
    };
  }

  const permission = await input.permissionService.requestForegroundPermission();
  if (permission.status !== 'granted') {
    return {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Foreground location permission is required to start delivery. Enable it in system settings or retry permission.',
    };
  }

  return {
    flowState: 'delivery_active',
    kind: 'delivery_active',
    locationPermission: 'foreground',
    message: 'Delivery started with foreground location permission.',
  };
}
