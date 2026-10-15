import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldShowRouteLoading } from './routeLoadingFeedback';

const ready = {
  isApplyingLiveRoute: false, isInitialRouteRestoreComplete: true, isManualRouteRefresh: false,
  routeCount: 2, routeSyncState: 'ready' as const, screen: 'mainTabs',
};

describe('route loading feedback', () => {
  it('covers the first empty load, then releases on success or error', () => {
    const initial = { ...ready, isInitialRouteRestoreComplete: false, routeCount: 0, routeSyncState: 'loading' as const };
    assert.equal(shouldShowRouteLoading(initial), true);
    assert.equal(shouldShowRouteLoading({ ...initial, routeSyncState: 'error' }), false);
    assert.equal(shouldShowRouteLoading({ ...initial, routeSyncState: 'ready' }), false);
    assert.equal(shouldShowRouteLoading({ ...initial, screen: 'settings' }), false);
  });

  it('keeps an empty or populated list interactive during automatic refresh', () => {
    for (const routeCount of [0, 2]) {
      assert.equal(shouldShowRouteLoading({ ...ready, routeCount, routeSyncState: 'loading' }), false);
    }
  });

  it('releases manual loading at its timeout even if an empty-list request remains pending', () => {
    const pending = { ...ready, routeCount: 0, routeSyncState: 'loading' as const };
    assert.equal(shouldShowRouteLoading({ ...pending, isManualRouteRefresh: true }), true);
    assert.equal(shouldShowRouteLoading({ ...pending, isManualRouteRefresh: false }), false);
  });

  it('covers Apply only for the duration of its request', () => {
    assert.equal(shouldShowRouteLoading({ ...ready, isApplyingLiveRoute: true }), true);
    assert.equal(shouldShowRouteLoading(ready), false);
  });
});
