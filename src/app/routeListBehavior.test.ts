import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { formatRouteListUpdatedAt } from './routeListBehavior';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getRoutesPageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function MyRoutesPage(');
  const end = source.indexOf('function SettingsPage(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('routes list behavior', () => {
  it('uses a routes-first shell with a gear-only Settings action and a revealed pull-refresh area', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const routesPage = getRoutesPageSource();
    const routesHeaderStyles = source.slice(source.indexOf('myRoutesHeader:'), source.indexOf('pageHeader:'));
    const pageTitleStyles = source.slice(source.indexOf('pageTitle:'), source.indexOf('settingsIconButton:'));
    const settingsButtonStyles = source.slice(source.indexOf('settingsIconButton:'), source.indexOf('pageTitleSmall:'));

    assert.match(source, /import Ionicons from '@expo\/vector-icons\/Ionicons'/u);
    assert.match(routesPage, /<Text style=\{styles\.pageTitle\}>My Routes<\/Text>/u);
    assert.match(routesPage, /accessibilityLabel="Settings"/u);
    assert.match(routesPage, /<Ionicons[\s\S]*name="settings"[\s\S]*size=\{30\}/u);
    assert.doesNotMatch(routesPage, /⚙/u);
    assert.doesNotMatch(routesHeaderStyles, /backgroundColor|borderColor|borderRadius|borderWidth/u);
    assert.match(routesHeaderStyles, /justifyContent: 'center'/u);
    assert.match(routesHeaderStyles, /marginTop: 16/u);
    assert.match(routesHeaderStyles, /minHeight: 76/u);
    assert.match(pageTitleStyles, /textAlign: 'center'/u);
    assert.match(settingsButtonStyles, /position: 'absolute'/u);
    assert.match(settingsButtonStyles, /right: 8/u);
    assert.match(settingsButtonStyles, /top: 16/u);
    assert.doesNotMatch(settingsButtonStyles, /settingsIcon:/u);
    assert.match(routesPage, /title="No routes assigned yet"/u);
    assert.match(routesPage, /body="When dispatch assigns you a route, it’ll appear here\."/u);
    assert.match(source, /styles\.pullRefreshReveal/u);
    assert.match(source, /formatRouteListUpdatedAt\(lastRoutesUpdatedAt\)/u);
    assert.match(source, /GestureHandlerRootView/u);
    assert.match(source, /GestureDetector gesture=\{pullRefreshGesture\}/u);
    assert.match(source, /Gesture\.Pan\(\)/u);
    assert.match(source, /const pullRefreshOffset = useSharedValue\(0\)/u);
    assert.match(source, /withSpring\(PULL_REFRESH_REVEAL_HEIGHT/u);
    assert.match(source, /reduceMotion: ReduceMotion\.System/u);
    assert.match(source, /const \{ top: topInset \} = useSafeAreaInsets\(\)/u);
    assert.match(source, /style=\{\[styles\.pullRefreshReveal, \{ top: topInset \}\]\}/u);
    assert.match(source, /<ActivityIndicator/u);
    assert.doesNotMatch(source, /pullRefreshResponder|pullRefreshSpin|Animated\.loop|>↻</u);
    assert.doesNotMatch(source, /RefreshControl|routeRefreshFooter/u);
    assert.doesNotMatch(source, /function BottomNavigation|function HomePage|function EarningsPage|selectedMainTab|<SegmentedTabs/u);
  });

  it('formats the latest authoritative route update in local yyyy.mm.dd hh:mm:ss time', () => {
    assert.equal(
      formatRouteListUpdatedAt(new Date(2026, 6, 15, 9, 5, 7)),
      'Last updated 2026.07.15 09:05:07',
    );
  });

  it('starts route cards collapsed with a direct title, summary row, and visible side-by-side actions', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const source = getRoutesPageSource();
    const routeActionRowStyles = appSource.slice(
      appSource.indexOf('routeActionRow:'),
      appSource.indexOf('selectedRouteCard:'),
    );
    const routeCardHeaderStyles = appSource.slice(
      appSource.indexOf('routeCardHeader:'),
      appSource.indexOf('routeHeaderText:'),
    );

    assert.match(source, /const \[expandedRouteKey, setExpandedRouteKey\] = useState<string \| null>\(null\)/u);
    assert.match(source, /const isRouteCardExpanded = activeRouteCollapseKey !== null && expandedRouteKey === activeRouteCollapseKey/u);
    assert.match(source, /setExpandedRouteKey\(\(value\) => value === activeRouteCollapseKey \? null : activeRouteCollapseKey\)/u);
    assert.match(source, /<View style=\{styles\.routeCardHeader\}>[\s\S]*?<Text numberOfLines=\{1\} style=\{\[styles\.cardTitle, styles\.routeCardTitle\]\}>\{activeSession\.route\.name\}<\/Text>[\s\S]*?<Text numberOfLines=\{1\} style=\{styles\.routeDateText\}>\{activeSession\.route\.deliveryDate\}<\/Text>[\s\S]*?<StatusChip[\s\S]*?<Pressable[\s\S]*?style=\{styles\.routeToggleButton\}/u);
    assert.match(source, /<Text numberOfLines=\{1\} style=\{styles\.routeDateText\}>\{activeSession\.route\.deliveryDate\}<\/Text>/u);
    assert.match(source, /label=\{formatRouteStatus\(activeRouteStatus \?\? 'ready'\)\}/u);
    assert.doesNotMatch(source, /routeInitialBadge|routeInitialText|getInitials|routeCardMetaRow|routeCardStatusGroup/u);
    assert.doesNotMatch(source, /<DataRow label="Date"/u);
    assert.match(source, /\{isRouteCardExpanded \? \([\s\S]*?<\/>[\s\S]*?\) : null\}[\s\S]*?label="Start"[\s\S]*?label="Detail"/u);
    assert.match(source, /<View style=\{styles\.routeActionRow\}>/u);
    assert.match(routeActionRowStyles, /flexDirection: 'row'/u);
    assert.match(routeActionRowStyles, /routeActionButton:[\s\S]*flex: 1/u);
    assert.match(routeCardHeaderStyles, /alignItems: 'center'/u);
    assert.match(routeCardHeaderStyles, /flexDirection: 'row'/u);
  });

  it('removes routes that are no longer assigned on the server', () => {
    const source = readFileSync(appRootPath, 'utf8');
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

    assert.match(refreshRoutesSource, /allowVerifiedDriverNoRoute: true/u);
    assert.match(refreshRoutesSource, /setMessage\(null\)/u);
    assert.doesNotMatch(refreshRoutesSource, /successMessagePrefix|routeLoadSuccessMessage|buildAuthSuccessMessage|getRuntimeHostLabel/u);
    assert.match(noAssignedRouteSource, /resetRouteProgress\(\)/u);
    assert.match(noAssignedRouteSource, /clearCachedRouteAccess\(\)/u);
    assert.doesNotMatch(noAssignedRouteSource, /setMessage\(/u);
    assert.doesNotMatch(source, /Signed in\. No current or ready route is assigned/u);
    assert.match(source, /assignedRouteResult\.kind !== 'no_assigned_route'/u);
    assert.match(appStateRefreshSource, /screen === 'mainTabs'/u);
    assert.doesNotMatch(appStateRefreshSource, /selectedMainTab === 'routes'/u);
  });
});
