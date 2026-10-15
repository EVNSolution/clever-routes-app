import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverApiHttpError,
  formatDriverApiErrorForDriver,
  getDriverApiRecoveryReason,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
  isDriverAccountDeletionActiveRouteError,
} from './driverApiError';

describe('driver API recovery classification', () => {
  it('distinguishes Cash input errors, conflicts, and retryable transport failures', () => {
    const error = (code: string, status: number) => createDriverApiHttpError({ code, status, endpoint: 'Driver event record' });
    assert.match(formatDriverApiErrorForDriver(error('CASH_RECEIVED_REQUIRED', 400)), /actual Cash amount/u);
    assert.match(formatDriverApiErrorForDriver(error('CASH_COMPLETION_INVALID', 400)), /amount or currency/u);
    assert.match(formatDriverApiErrorForDriver(error('CASH_COMPLETION_CONFLICT', 409)), /Dispatch must review/u);
    assert.match(formatDriverApiErrorForDriver(error('ROUTE_ASSIGNMENT_CHANGED', 409)), /assignment changed/u);
    assert.match(formatDriverApiErrorForDriver(error('ROUTE_VERSION_MISMATCH', 409)), /route version changed/u);
    assert.match(formatDriverApiErrorForDriver(error('SERVER_ERROR', 503)), /could not be confirmed/u);
    assert.equal(formatDriverApiErrorForDriver(new Error('offline')), 'The update could not be confirmed. Check your connection.');
  });

  it('never exposes transport text, endpoints, or HTTP numbers in driver feedback', () => {
    const endpoint = 'https://route.example.test/private/events';
    const failures: unknown[] = [
      new Error(`java.net.UnknownHostException: ${endpoint} HTTP 503`),
      `HTTP 500 ${endpoint}`,
      null,
      createDriverApiHttpError({ endpoint }),
      createDriverApiHttpError({ endpoint, status: 401 }),
      createDriverApiHttpError({ endpoint, status: 409, code: 'ROUTE_NOT_IN_PROGRESS' }),
      ...['CASH_RECEIVED_REQUIRED', 'CASH_COMPLETION_INVALID', 'CASH_COMPLETION_CONFLICT', 'ROUTE_ASSIGNMENT_CHANGED', 'ROUTE_VERSION_MISMATCH']
        .map(code => createDriverApiHttpError({ endpoint, status: code.includes('REQUIRED') || code.includes('INVALID') ? 400 : 409, code })),
    ];
    for (const error of failures) {
      assert.doesNotMatch(formatDriverApiErrorForDriver(error), /UnknownHostException|https?:|route\.example|HTTP|\b(?:400|401|409|500|503)\b/u);
    }
    assert.equal(getDriverApiRecoveryReason(new Error('HTTP 401')), undefined);
  });

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
    assert.match(formatDriverApiErrorForDriver(unauthorized), /Refresh routes/u);

    assert.equal(getDriverApiRecoveryReason(routeEnded), 'route_not_in_progress');
    assert.equal(getDriverApiRequiresRouteLookup(routeEnded), undefined);
    assert.equal(getDriverApiRequiresRouteReconciliation(routeEnded), true);
    assert.match(formatDriverApiErrorForDriver(routeEnded), /ended or released by the server/u);

    const activeRouteDeletion = createDriverApiHttpError({
      code: 'ACCOUNT_DELETION_ACTIVE_ROUTE',
      endpoint: 'Driver account deletion request',
      status: 409,
    });
    assert.equal(isDriverAccountDeletionActiveRouteError(activeRouteDeletion), true);
    assert.equal(getDriverApiRecoveryReason(activeRouteDeletion), undefined);
  });
});
