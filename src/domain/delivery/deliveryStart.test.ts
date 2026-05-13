import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startDeliveryWithForegroundPermission, type ForegroundLocationPermissionService } from './deliveryStart';

function createPermissionService(status: 'denied' | 'granted'): ForegroundLocationPermissionService & { requests: number } {
  return {
    requests: 0,
    requestForegroundPermission: async function requestForegroundPermission() {
      this.requests += 1;
      return { status };
    },
  };
}

describe('delivery start location permission gate', () => {
  it('does not request OS location permission before route_ready', async () => {
    const permissionService = createPermissionService('granted');

    const result = await startDeliveryWithForegroundPermission({
      flowState: 'consent_recorded',
      permissionService,
    });

    assert.deepEqual(result, {
      flowState: 'consent_recorded',
      kind: 'blocked',
      reason: 'route_not_ready',
      message: 'Load the assigned route before starting delivery.',
    });
    assert.equal(permissionService.requests, 0);
  });

  it('moves route_ready to delivery_active when foreground location permission is granted', async () => {
    const permissionService = createPermissionService('granted');

    const result = await startDeliveryWithForegroundPermission({
      flowState: 'route_ready',
      permissionService,
    });

    assert.deepEqual(result, {
      flowState: 'delivery_active',
      kind: 'delivery_active',
      locationPermission: 'foreground',
      message: 'Delivery started with foreground location permission.',
    });
    assert.equal(permissionService.requests, 1);
  });

  it('keeps route_ready when foreground location permission is denied', async () => {
    const permissionService = createPermissionService('denied');

    const result = await startDeliveryWithForegroundPermission({
      flowState: 'route_ready',
      permissionService,
    });

    assert.deepEqual(result, {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Foreground location permission is required to start delivery. Enable it in system settings or retry permission.',
    });
    assert.equal(permissionService.requests, 1);
  });
});
