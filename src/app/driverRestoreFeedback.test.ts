import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDriverApiHttpError } from '../api/deliveryServer/driverApiError';
import { BoundedOperationTimeoutError } from '../domain/async/boundedAsyncOperation';
import { DriverAuthRefreshPendingError } from '../domain/driverAuth/driverAuth';
import { getDriverReportFeedback, getDriverRestoreFeedback } from './driverRestoreFeedback';

describe('restore failure feedback', () => {
  it('claims server receipt only for an explicit report acknowledgement', () => {
    const at = '2026-10-02T08:00:00.000Z';
    assert.match(getDriverReportFeedback({ state: 'ACKNOWLEDGED', serverReceivedAt: at, updatedAt: at }), /received by the server/iu);
    for (const state of ['SAVING', 'QUEUED'] as const) {
      assert.doesNotMatch(getDriverReportFeedback({ state, updatedAt: at }), /received by the server/iu);
    }
    assert.match(getDriverReportFeedback({ state: 'QUEUED', updatedAt: at }), /saved on this device/iu);
    assert.doesNotMatch(getDriverReportFeedback(null), /saved|received/iu);
    assert.match(getDriverReportFeedback({ state: 'FAILED', failure: 'PERMANENT_REJECTION', updatedAt: at }), /not accepted/iu);
  });
  it('distinguishes local session storage from a network problem without leaking error text', () => {
    const secretError = new Error('secret-token customer@example.com latitude=43');
    const read = getDriverRestoreFeedback('LOAD', secretError);
    const write = getDriverRestoreFeedback('SAVE', secretError);
    assert.equal(read.blocker.reasonCode, 'STORAGE_READ_FAILED');
    assert.equal(write.blocker.reasonCode, 'STORAGE_WRITE_FAILED');
    assert.equal(read.blocker.stage, 'STORAGE');
    assert.doesNotMatch(JSON.stringify([read, write]), /secret-token|customer@|latitude|connection/iu);
  });

  it('identifies the timed-out phase and tells the user when the original operation is still pending', () => {
    const read = getDriverRestoreFeedback('LOAD', new BoundedOperationTimeoutError(), true);
    const refresh = getDriverRestoreFeedback('REFRESH', new BoundedOperationTimeoutError());
    assert.equal(read.blocker.reasonCode, 'STORAGE_OPERATION_TIMEOUT');
    assert.match(read.message, /still finishing/iu);
    assert.equal(refresh.blocker.reasonCode, 'AUTH_REFRESH_TIMEOUT');
    assert.equal(refresh.blocker.stage, 'AUTH');
  });

  it('explains a refresh request that still has not stopped instead of promising another request', () => {
    const result = getDriverRestoreFeedback('REFRESH', new DriverAuthRefreshPendingError());
    assert.equal(result.blocker.reasonCode, 'AUTH_REFRESH_TIMEOUT');
    assert.match(result.message, /still finishing/iu);
    assert.match(result.message, /report the issue and restart the app/iu);
  });

  it('keeps a specific HTTP failure for the server while giving usable recovery guidance', () => {
    const result = getDriverRestoreFeedback('REFRESH', createDriverApiHttpError({
      endpoint: 'refresh', status: 503,
    }));
    assert.equal(result.blocker.reasonCode, 'HTTP_SERVER_ERROR');
    assert.equal(result.blocker.httpStatus, 503);
    assert.match(result.message, /try again/iu);
    assert.doesNotMatch(result.message, /503|token/iu);
  });
});
