import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');
const bannerPath = join(dirname(fileURLToPath(import.meta.url)), 'liveRouteChangeBanner.tsx');
const source = readFileSync(appRootPath, 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

describe('live route banner, Apply and pull refresh recovery', () => {
  it('selects the changed-list banner only for a real unapplied change, never for an error alone', () => {
    const selection = between('const liveBannerSession = routeSessions.find(', 'const liveBannerKey =');
    assert.doesNotMatch(selection, /liveRouteErrors\[/u);
    assert.match(selection, /hasPendingLiveRouteChange\(state\)/u);
  });

  it('shows no extra banner for a communication error without a change', () => {
    const banner = readFileSync(bannerPath, 'utf8');
    assert.doesNotMatch(banner, /LiveRouteCheckNotice/u);
    assert.doesNotMatch(source, /LiveRouteCheckNotice|liveCheckErrorMessage/u);
  });

  it('recovers a route the server ended from the latest assignments instead of showing a change notice', () => {
    const poll = between('const pollLiveRouteChanges = useCallback(', 'liveRoutePollRunningRef.current = false; }');
    assert.match(poll, /isDriverRouteNotInProgressError\(error\)[\s\S]*endedRouteRefreshRequestedRef\.current\.add\(key\)[\s\S]*void handleRefreshRoutes\(\)[\s\S]*continue;/u);
    const gate = between('const gateLiveRouteSession = useCallback(', 'liveRouteBasesRef.current[key] = route;');
    assert.match(gate, /isDriverRouteNotInProgressError\(error\)/u);
  });

  it('reports every Apply outcome instead of returning silently', () => {
    const apply = between('async function handleApplyLiveRoute(', 'useEffect(() => {\n    const receiveRouteNotification');
    assert.match(apply, /if \(release === null\) \{\s*setMessage\('Finish the current delivery action before applying the update\.'\);/u);
    assert.match(apply, /if \(owner === null\) \{\s*release\(\);\s*setMessage\('Sign in again to apply the update\.'\);/u);
    assert.doesNotMatch(apply, /Delivery list updated/u);
    assert.match(apply, /The route update is not fully confirmed/u);
  });

  it('releases the pull refresh lock even when a refresh request never answers', () => {
    const pull = between('const handlePullRefresh = useCallback(', 'const retryDriverRestore = useCallback(');
    assert.match(pull, /PULL_REFRESH_MAX_WAIT_MS/u);
    assert.match(pull, /Promise\.race\(\[[\s\S]*Promise\.all\(\[[\s\S]*handleRefreshRoutes\(\)[\s\S]*checkForDriverAppUpdate\(true, true\)[\s\S]*\]\)[\s\S]*\]\)/u);
    assert.match(pull, /finally \{[\s\S]*clearTimeout\([\s\S]*pullRefreshOffset\.value = withSpring\(0[\s\S]*isPullRefreshingRef\.current = false/u);
    assert.match(source, /const PULL_REFRESH_MAX_WAIT_MS = \d+/u);
  });
});
