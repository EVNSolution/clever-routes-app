import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getNetworkReachability,
  shouldRetryOfflineSubmissionsAfterNetworkChange,
} from './offlineRetryTrigger';

describe('offline retry network trigger', () => {
  it('requires confirmed internet reachability before treating the device as online', () => {
    assert.equal(getNetworkReachability({}), 'unknown');
    assert.equal(getNetworkReachability({ isConnected: true }), 'unknown');
    assert.equal(getNetworkReachability({ isConnected: false, isInternetReachable: true }), 'offline');
    assert.equal(getNetworkReachability({ isConnected: true, isInternetReachable: false }), 'offline');
    assert.equal(getNetworkReachability({ isConnected: true, isInternetReachable: true }), 'online');
  });

  it('retries only on a confirmed offline-to-online transition with pending route data', () => {
    assert.equal(shouldRetryOfflineSubmissionsAfterNetworkChange({
      current: 'online',
      hasPendingSubmissions: true,
      previous: 'offline',
    }), true);
    assert.equal(shouldRetryOfflineSubmissionsAfterNetworkChange({
      current: 'online',
      hasPendingSubmissions: false,
      previous: 'offline',
    }), false);
    assert.equal(shouldRetryOfflineSubmissionsAfterNetworkChange({
      current: 'online',
      hasPendingSubmissions: true,
      previous: 'unknown',
    }), false);
    assert.equal(shouldRetryOfflineSubmissionsAfterNetworkChange({
      current: 'online',
      hasPendingSubmissions: true,
      previous: 'online',
    }), false);
  });
});
