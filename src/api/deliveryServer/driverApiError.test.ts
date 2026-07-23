import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverApiHttpError,
  formatDriverApiErrorForDriver,
  getDriverApiRecoveryReason,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from './driverApiError';

describe('driver API recovery classification', () => {
  it('keeps 401 access refresh separate from 409 terminal route reconciliation', () => {
    const unauthorized = createDriverApiHttpError({ endpoint: 'Driver event record', status: 401 });
    const routeEnded = createDriverApiHttpError({
      code: 'ROUTE_NOT_IN_PROGRESS',
      endpoint: 'Driver event record',
      status: 409,
    });

    assert.equal(getDriverApiRecoveryReason(unauthorized), 'driver_access_expired');
    assert.equal(getDriverApiRequiresRouteLookup(unauthorized), true);
    assert.equal(getDriverApiRequiresRouteReconciliation(unauthorized), undefined);

    assert.equal(getDriverApiRecoveryReason(routeEnded), 'route_not_in_progress');
    assert.equal(getDriverApiRequiresRouteLookup(routeEnded), undefined);
    assert.equal(getDriverApiRequiresRouteReconciliation(routeEnded), true);
    assert.match(formatDriverApiErrorForDriver(routeEnded), /ended or released by the server/u);
  });
});
