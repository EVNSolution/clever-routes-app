import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRouteProgressRefreshGuard } from './routeProgressRefreshGuard';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('route progress refresh guard', () => {
  it('blocks a completion after refresh state is read until the reordered route is applied', async () => {
    const guard = createRouteProgressRefreshGuard();
    const applyRefresh = deferred();
    const releaseRefresh = guard.beginRefresh();
    assert.notEqual(releaseRefresh, null);

    let routeOrder = ['stop-1', 'stop-2'];
    let completedStopIds: string[] = [];
    let navigationStepIndex = 1;
    const refresh = (async () => {
      await applyRefresh.promise;
      routeOrder = ['stop-2', 'stop-1'];
      navigationStepIndex = 1;
      releaseRefresh?.();
    })();

    assert.equal(guard.beginMutation(), null);
    assert.deepEqual(completedStopIds, []);
    assert.equal(navigationStepIndex, 1);

    applyRefresh.resolve();
    await refresh;

    const releaseCompletion = guard.beginMutation();
    assert.notEqual(releaseCompletion, null);
    completedStopIds = ['stop-2'];
    navigationStepIndex = routeOrder.indexOf('stop-1') + 1;
    releaseCompletion?.();

    assert.deepEqual(completedStopIds, ['stop-2']);
    assert.equal(navigationStepIndex, 2);
  });

  it('does not start a refresh while a progress mutation is active', () => {
    const guard = createRouteProgressRefreshGuard();
    const releaseMutation = guard.beginMutation();

    assert.notEqual(releaseMutation, null);
    assert.equal(guard.beginRefresh(), null);

    releaseMutation?.();
    assert.notEqual(guard.beginRefresh(), null);
  });

  it('automatically retries a pending notification refresh when the blocking mutation releases', () => {
    let refreshRequired = true;
    let refreshAttempts = 0;
    let guard: ReturnType<typeof createRouteProgressRefreshGuard>;
    const attemptNotificationRefresh = () => {
      refreshAttempts += 1;
      const releaseRefresh = guard.beginRefresh();
      if (releaseRefresh === null) return;
      refreshRequired = false;
      releaseRefresh();
    };
    guard = createRouteProgressRefreshGuard(() => {
      if (refreshRequired) attemptNotificationRefresh();
    });
    const releaseMutation = guard.beginMutation();

    attemptNotificationRefresh();
    assert.equal(refreshRequired, true);
    assert.equal(refreshAttempts, 1);

    releaseMutation?.();

    assert.equal(refreshRequired, false);
    assert.equal(refreshAttempts, 2);
  });
});
