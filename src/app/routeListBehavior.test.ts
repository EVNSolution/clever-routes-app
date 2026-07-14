import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getRoutesPageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function RoutesPage(');
  const end = source.indexOf('function EarningsPage(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('routes list behavior', () => {
  it('lets the selected route card collapse to title date and status only', () => {
    const source = getRoutesPageSource();

    assert.match(source, /const \[collapsedRouteKey, setCollapsedRouteKey\] = useState<string \| null>\(null\)/u);
    assert.match(source, /const isRouteCardExpanded = activeRouteCollapseKey === null \|\| collapsedRouteKey !== activeRouteCollapseKey/u);
    assert.match(source, /setCollapsedRouteKey\(\(value\) => value === activeRouteCollapseKey \? null : activeRouteCollapseKey\)/u);
    assert.match(source, /<Text numberOfLines=\{1\} style=\{styles\.cardTitle\}>\{activeSession\.route\.name\}<\/Text>/u);
    assert.match(source, /<Text numberOfLines=\{1\} style=\{styles\.helperText\}>\{activeSession\.route\.deliveryDate\}<\/Text>/u);
    assert.match(source, /label=\{formatRouteStatus\(activeRouteStatusForTabs \?\? 'upcoming'\)\}/u);
    assert.doesNotMatch(source, /<DataRow label="Company"/u);
    assert.doesNotMatch(source, /<DataRow label="Route"/u);
    assert.match(source, /\{getInitials\(activeSession\.route\.name\)\}/u);
  });

  it('removes routes that are no longer assigned on the server', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const openMainTabSource = source.slice(
      source.indexOf('function openMainTab'),
      source.indexOf('function openHomeRoot'),
    );
    const refreshRoutesSource = source.slice(
      source.indexOf('const handleRefreshRoutes'),
      source.indexOf('useEffect(() => {', source.indexOf('const handleRefreshRoutes')),
    );
    const noAssignedRouteSource = source.slice(
      source.indexOf('const openVerifiedNoAssignedRoute'),
      source.indexOf('const handleLoginAndLoadRoutes'),
    );
    const appStateRefreshSource = source.slice(
      source.indexOf("AppState.addEventListener('change'"),
      source.indexOf('return () => subscription.remove()', source.indexOf("AppState.addEventListener('change'")),
    );

    assert.match(openMainTabSource, /tab === 'routes'/u);
    assert.match(openMainTabSource, /void handleRefreshRoutes\(\)/u);
    assert.match(refreshRoutesSource, /allowVerifiedDriverNoRoute: true/u);
    assert.match(noAssignedRouteSource, /resetRouteProgress\(\)/u);
    assert.match(noAssignedRouteSource, /clearCachedRouteAccess\(\)/u);
    assert.match(appStateRefreshSource, /screen === 'mainTabs'/u);
    assert.doesNotMatch(appStateRefreshSource, /selectedMainTab === 'routes'/u);
  });
});
