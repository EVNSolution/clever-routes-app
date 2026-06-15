import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getAppRootSource(): string {
  return readFileSync(appRootPath, 'utf8');
}

function getStopDetailsComponentSource(): string {
  const source = getAppRootSource();
  const start = source.indexOf('function StopDetailsScreen(');
  const end = source.indexOf('function ArrivalCheckScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('stop details simplification', () => {
  it('renders only concise read-only stop reference content', () => {
    const componentSource = getStopDetailsComponentSource();

    assert.match(componentSource, /formatStopStreetAddress\(stop\)/u);
    assert.match(componentSource, /StatusChip label=\{payment\.label\} tone=\{payment\.tone\}/u);
    assert.match(componentSource, /No delivery instructions provided\./u);
    assert.match(componentSource, /No location tips provided\./u);
    assert.match(componentSource, /label="Open Stop Map"/u);
    assert.match(componentSource, /label="Call"/u);
    assert.match(componentSource, /label="Message"/u);

    assert.doesNotMatch(componentSource, /payment\.detail/u);
    assert.doesNotMatch(componentSource, /Delivery instructions are provided by dispatch/u);
    assert.doesNotMatch(componentSource, /getNavigationTip/u);
    assert.doesNotMatch(componentSource, /label="Arrived"/u);
    assert.doesNotMatch(componentSource, /I’m Nearby/u);
    assert.doesNotMatch(componentSource, /canMarkArrived/u);
    assert.doesNotMatch(componentSource, /onAnnounceTip/u);
  });

  it('uses a basic street address on Stop Details without hiding full address formatting elsewhere', () => {
    const source = getAppRootSource();

    assert.match(source, /function formatStopStreetAddress\(stop: AssignedRouteStop\): string/u);
    assert.match(source, /\[stop\.address\.address1, stop\.address\.address2\]/u);
    assert.match(source, /streetAddress\.length === 0 \? formatStopAddress\(stop\) : streetAddress/u);
  });

  it('restores horizontal swipe-back through the shared app back decision', () => {
    const source = getAppRootSource();

    assert.match(source, /PanResponder/u);
    assert.match(source, /const handleAppBack = useCallback\(\(\): boolean =>/u);
    assert.match(source, /BackHandler\.addEventListener\('hardwareBackPress', handleAppBack\)/u);
    assert.match(source, /const swipeBackResponder = useMemo\(\(\) => PanResponder\.create/u);
    assert.match(source, /SWIPE_BACK_DIRECTIONALITY_RATIO/u);
    assert.match(source, /SWIPE_BACK_DISTANCE/u);
    assert.match(source, /SWIPE_BACK_EDGE_WIDTH/u);
    assert.match(source, /screen === 'liveMapPreview'/u);
    assert.match(source, /gestureState\.x0 > SWIPE_BACK_EDGE_WIDTH/u);
    assert.match(source, /SWIPE_BACK_MAX_VERTICAL_DELTA/u);
    assert.match(source, /\.\.\.swipeBackResponder\.panHandlers/u);
    assert.match(source, /case 'stopDetails':[\s\S]*setSelectedStopDetailsId\(null\);[\s\S]*setScreen\(stopDetailsBackTarget\);[\s\S]*return true;/u);
    assert.match(source, /<StopDetailsScreen[\s\S]*onBack=\{\(\) => \{[\s\S]*handleAppBack\(\);[\s\S]*\}\}/u);
    assert.doesNotMatch(source, /trackingDeckPanResponder/u);
  });
});
