import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DriverAccessRestoreResult } from '../domain/driver/driverAccessTokenStore';
import type { DriverAccountAccessToken } from '../domain/driverAuth/driverAuth';
import { createDriverRestoreAttemptCoordinator } from './driverRestoreAttempt';

const staleAccountAccess: DriverAccountAccessToken = {
  accessToken: 'stale-access',
  expiresAt: '2026-10-01T14:00:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-11-01T14:00:00.000Z',
  tokenType: 'Bearer',
  ttlSeconds: 900,
  use: 'driver_account',
};

const refreshedAccountAccess: DriverAccountAccessToken = {
  ...staleAccountAccess,
  accessToken: 'refreshed-access',
  expiresAt: '2026-10-01T15:00:00.000Z',
};

const refreshRequired: Extract<DriverAccessRestoreResult, { kind: 'refresh_required' }> = {
  accountAccess: staleAccountAccess,
  driverProfile: { phoneE164: '+14165550123' },
  kind: 'refresh_required',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('driver restore attempt coordinator', () => {
  it('runs load, refresh, and save once and returns the refreshed active access', async () => {
    const phases: string[] = [];
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => { phases.push('load'); return refreshRequired; },
      refresh: async (refreshToken) => {
        phases.push(`refresh:${refreshToken}`);
        return { accountAccess: refreshedAccountAccess };
      },
      save: async (access, expectedIdentity) => {
        phases.push(`save:${access.accessToken}:${expectedIdentity.accessToken}:${expectedIdentity.phoneE164}:${expectedIdentity.refreshToken}`);
      },
    });

    const result = await coordinator.attempt();

    assert.deepEqual(phases, [
      'load',
      'refresh:refresh-token',
      'save:refreshed-access:stale-access:+14165550123:refresh-token',
    ]);
    assert.equal(result.kind, 'restored');
    if (result.kind === 'restored') {
      assert.equal(result.access.kind, 'active');
      assert.equal(result.access.accountAccess.accessToken, 'refreshed-access');
    }
  });

  it('shares one complete attempt between concurrent Retry actions', async () => {
    const loaded = deferred<DriverAccessRestoreResult>();
    let loads = 0;
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => { loads += 1; return loaded.promise; },
      refresh: async () => ({ accountAccess: refreshedAccountAccess }),
      save: async () => undefined,
    });

    const first = coordinator.attempt();
    const second = coordinator.attempt();
    assert.equal(first, second);
    loaded.resolve({ ...refreshRequired, accountAccess: refreshedAccountAccess, kind: 'active' });

    assert.equal((await first).kind, 'restored');
    assert.equal(loads, 1);
  });

  it('does not start duplicate storage loads while a timed-out raw load is still pending', async () => {
    let expire!: () => void;
    let loads = 0;
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => { loads += 1; return new Promise(() => undefined); },
      refresh: async () => ({ accountAccess: refreshedAccountAccess }),
      save: async () => undefined,
      scheduleTimeout: (run) => { expire = run; return 'load-timeout'; },
      cancelTimeout: () => undefined,
    });

    const first = coordinator.attempt();
    expire();
    const failed = await first;
    const retry = await coordinator.attempt();

    assert.deepEqual(
      { kind: failed.kind, pending: failed.kind === 'retryable_failure' && failed.stillPending, phase: failed.kind === 'retryable_failure' ? failed.phase : null },
      { kind: 'retryable_failure', pending: true, phase: 'LOAD' },
    );
    assert.deepEqual(
      { kind: retry.kind, pending: retry.kind === 'retryable_failure' && retry.stillPending, phase: retry.kind === 'retryable_failure' ? retry.phase : null },
      { kind: 'retryable_failure', pending: true, phase: 'LOAD' },
    );
    assert.equal(loads, 1);
  });

  it('does not save a refresh result after the restore generation is invalidated', async () => {
    const refreshed = deferred<{ accountAccess: DriverAccountAccessToken }>();
    let saves = 0;
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => refreshRequired,
      refresh: async () => refreshed.promise,
      save: async () => { saves += 1; },
    });

    const attempt = coordinator.attempt();
    await new Promise((resolve) => setImmediate(resolve));
    coordinator.invalidate();
    refreshed.resolve({ accountAccess: refreshedAccountAccess });

    assert.deepEqual(await attempt, { kind: 'stale' });
    assert.equal(saves, 0);
  });

  it('returns the loaded identity when refresh fails so callers can conditionally clear it', async () => {
    const refreshError = new Error('refresh rejected');
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => refreshRequired,
      refresh: async () => { throw refreshError; },
      save: async () => undefined,
    });

    const result = await coordinator.attempt();

    assert.deepEqual(result, {
      error: refreshError,
      expectedIdentity: { accessToken: 'stale-access', phoneE164: '+14165550123', refreshToken: 'refresh-token' },
      kind: 'retryable_failure',
      phase: 'REFRESH',
      stillPending: false,
    });
  });

  it('does not overlap storage writes when save exceeds its bounded wait', async () => {
    let expire!: () => void;
    let saves = 0;
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => refreshRequired,
      refresh: async () => ({ accountAccess: refreshedAccountAccess }),
      save: async () => { saves += 1; return new Promise(() => undefined); },
      scheduleTimeout: (run) => { expire = run; return `timeout-${saves}`; },
      cancelTimeout: () => undefined,
    });

    const attempt = coordinator.attempt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saves, 1);
    expire();
    const failed = await attempt;
    const retry = await coordinator.attempt();

    assert.deepEqual(
      {
        expectedIdentity: failed.kind === 'retryable_failure' ? failed.expectedIdentity : undefined,
        kind: failed.kind,
        pending: failed.kind === 'retryable_failure' && failed.stillPending,
        phase: failed.kind === 'retryable_failure' ? failed.phase : null,
      },
      {
        expectedIdentity: { accessToken: 'stale-access', phoneE164: '+14165550123', refreshToken: 'refresh-token' },
        kind: 'retryable_failure',
        pending: true,
        phase: 'SAVE',
      },
    );
    assert.deepEqual(
      {
        expectedIdentity: retry.kind === 'retryable_failure' ? retry.expectedIdentity : undefined,
        kind: retry.kind,
        pending: retry.kind === 'retryable_failure' && retry.stillPending,
        phase: retry.kind === 'retryable_failure' ? retry.phase : null,
      },
      {
        expectedIdentity: { accessToken: 'stale-access', phoneE164: '+14165550123', refreshToken: 'refresh-token' },
        kind: 'retryable_failure',
        pending: true,
        phase: 'SAVE',
      },
    );
    assert.equal(saves, 1);
  });

  it('returns login-required access without clearing or refreshing it', async () => {
    let refreshes = 0;
    let saves = 0;
    const coordinator = createDriverRestoreAttemptCoordinator({
      load: async () => ({ driverProfile: { phoneE164: '+14165550123' }, kind: 'expired' }),
      refresh: async () => { refreshes += 1; return { accountAccess: refreshedAccountAccess }; },
      save: async () => { saves += 1; },
    });

    const result = await coordinator.attempt();

    assert.equal(result.kind, 'login_required');
    assert.equal(refreshes, 0);
    assert.equal(saves, 0);
  });
});
