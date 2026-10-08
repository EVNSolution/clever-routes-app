import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('cached active route connection wiring', () => {
  it('refreshes authoritative assignments before polling or acknowledging a cached route', () => {
    const poll = source.slice(source.indexOf('const pollLiveRouteChanges ='), source.indexOf('const buildLiveRouteUiDraft ='));
    assert.match(poll, /if \(cached !== null\) \{[\s\S]*canRefreshCachedLiveRoute\([\s\S]*await handleRefreshRoutes\(\{ isCurrent \}\);[\s\S]*return;/u);
    assert.ok(poll.indexOf('await handleRefreshRoutes') < poll.indexOf('service.getLiveRouteChange'));
  });

  it('defers automatic validation while a native camera scope or photo sheet is open', () => {
    const poll = source.slice(source.indexOf('const pollLiveRouteChanges ='), source.indexOf('const buildLiveRouteUiDraft ='));
    assert.match(poll, /screenRef\.current === 'proofCamera' \|\| isPhotoActionSheetVisible/u);
    assert.ok(poll.indexOf("screenRef.current === 'proofCamera'") < poll.indexOf('await handleRefreshRoutes'));
  });

  it('pauses offline evidence replay until fresh route hydration clears the cached marker', () => {
    const retry = source.slice(source.indexOf('const retryOfflineSubmissionsForSessions ='), source.indexOf('const selectedRouteSession ='));
    assert.match(retry, /if \(cachedLiveRouteValidationRef\.current !== null\) return false;/u);
    assert.ok(retry.indexOf('cachedLiveRouteValidationRef') < retry.indexOf('getExpoOfflineSubmissionQueue'));
    const load = source.slice(source.indexOf('const handleLoginAndLoadRoutes ='), source.indexOf('const handleRefreshRoutes ='));
    assert.match(load, /cachedLiveRouteValidationRef\.current = cachedActiveSession === null \? null : \{/u);
    assert.ok(load.indexOf('cachedLiveRouteValidationRef.current =') < load.indexOf('void retryOfflineSubmissionsForSessions(loadedSessionsWithPendingEnds)'));
  });
});
