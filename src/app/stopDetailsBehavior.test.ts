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
  it('renders the selected order details and the server customer note', () => {
    const componentSource = getStopDetailsComponentSource();

    assert.match(componentSource, /<View style=\{styles\.stopDetailsPage\}>/u);
    assert.match(componentSource, /<ScreenHeader hideRightAction onBack=\{onBack\} title=\{`Stop \$\{stop\.sequence\}`\} \/>/u);
    assert.match(componentSource, /style=\{styles\.stopDetailsAddress\}/u);
    assert.match(componentSource, /formatStopStreetAddress\(stop\)/u);
    assert.doesNotMatch(componentSource, /numberOfLines=\{2\} style=\{styles\.stopDetailsAddress\}/u);
    assert.match(componentSource, /<Text style=\{styles\.stopDetailsSectionTitle\}>Order<\/Text>/u);
    assert.match(componentSource, /<DataRow label="Order" value=\{stop\.orderName\}/u);
    assert.match(componentSource, /<DataRow label="Recipient" value=\{stop\.recipientName/u);
    assert.match(componentSource, /<DataRow label="Phone" value=\{stop\.phone/u);
    assert.match(componentSource, /formatAssignedRoutePaymentSummary\(stop\)/u);
    assert.match(componentSource, /isAssignedRoutePickupStop\(stop\)/u);
    assert.match(componentSource, /isPickupStop \? 'Order Type' : 'Payment'/u);
    assert.match(componentSource, /isPickupStop \? \([\s\S]*label="Pickup"/u);
    assert.match(componentSource, /const paymentAmount = formatAssignedRouteCompactPaymentAmount\(stop\.totalPriceAmount, stop\.currencyCode\)/u);
    assert.match(componentSource, /StatusChip large label=\{paymentAmount\} tone=\{payment\.status\.tone\}/u);
    assert.doesNotMatch(componentSource, /payment\.amountLabel|payment\.methodLabel|label=\{payment\.status\.label\}/u);
    assert.doesNotMatch(componentSource, /payment\.detail|stopDetailsPaymentDetail/u);
    assert.match(componentSource, />Qty<\/Text>/u);
    assert.match(componentSource, />Item<\/Text>/u);
    assert.match(componentSource, /\{item\.quantity\} EA/u);
    assert.match(componentSource, /const itemName = splitStopItemName\(item\.name\)/u);
    assert.match(componentSource, /styles\.stopDetailsItemNamePrimary/u);
    assert.match(componentSource, /styles\.stopDetailsItemNameSecondary/u);
    assert.match(componentSource, /item\.options\.map\(\(option\) => `\$\{option\.key\}: \$\{option\.value\}`\)\.join\(', '\)/u);
    assert.match(componentSource, /stop\.customerNote\?\.trim\(\) \|\| 'No delivery instructions provided\.'/u);
    assert.match(componentSource, /No delivery instructions provided\./u);
    assert.match(componentSource, /label="Arrive"/u);
    assert.match(componentSource, /label="Navigate"/u);
    assert.match(componentSource, /label="Call"/u);
    assert.match(componentSource, />Skip Stop<\/Text>/u);
    assert.match(componentSource, /styles\.stopDetailsSkipAction/u);
    assert.match(componentSource, /canArrive/u);
    assert.match(componentSource, /isArriving/u);

    assert.doesNotMatch(componentSource, /Location Tips/u);
    assert.doesNotMatch(componentSource, /No location tips provided\./u);
    assert.doesNotMatch(componentSource, /Delivery instructions are provided by dispatch/u);
    assert.doesNotMatch(componentSource, /getNavigationTip/u);
    assert.doesNotMatch(componentSource, /label="Arrived"/u);
    assert.doesNotMatch(componentSource, /I’m Nearby/u);
    assert.doesNotMatch(componentSource, /canMarkArrived/u);
    assert.doesNotMatch(componentSource, /onAnnounceTip/u);
    assert.doesNotMatch(componentSource, /label="Complete"|label="Search Address"|label="Message"|onMessage/u);
    assert.doesNotMatch(componentSource, /Stop Details|stopSummaryCard|stopBadge|listPanel|paymentBadgeOnlyPanel|stopItemsPanel|TextCard/u);
    assert.doesNotMatch(componentSource, /Items to drop|formatAssignedRouteItemLine/u);
  });

  it('keeps the full address visible and reduces Payment to one large amount pill', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsAddress:'), source.indexOf('stopDetailsItemHeader:'));

    assert.match(componentSource, /<Text style=\{styles\.stopDetailsAddress\}>\{formatStopStreetAddress\(stop\)\}<\/Text>/u);
    assert.match(stylesSource, /stopDetailsAddress:[\s\S]*flexShrink: 0,[\s\S]*width: '100%'/u);
    assert.match(source, /statusChipLarge:[\s\S]*fontSize: 18,[\s\S]*paddingHorizontal: 14,[\s\S]*paddingVertical: 9/u);
    assert.match(stylesSource, /stopDetailsPaymentRow:[\s\S]*justifyContent: 'flex-end'/u);
  });

  it('uses a clear arrival, navigation, and call action hierarchy', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsActions:'), source.indexOf('nearbyBanner:'));

    assert.match(
      componentSource,
      /label="Arrive"[\s\S]*tone="arrive"[\s\S]*label="Navigate"[\s\S]*tone="navigate"[\s\S]*label="Call"[\s\S]*tone="call"/u,
    );
    assert.match(componentSource, /disabled=\{!canArrive \|\| isArriving\}/u);
    assert.match(componentSource, /loading=\{isArriving\}/u);
    assert.match(stylesSource, /stopDetailsActionArrive:[\s\S]*backgroundColor: '#0b57d0'[\s\S]*borderColor: '#0b57d0'/u);
    assert.match(stylesSource, /stopDetailsActionSecondary:[\s\S]*backgroundColor: '#ffffff'[\s\S]*borderColor: '#0b57d0'/u);
    assert.match(stylesSource, /stopDetailsActionSecondaryText:[\s\S]*color: '#0b57d0'/u);
    assert.doesNotMatch(stylesSource, /#087443|#98a2b3/u);
  });

  it('places a full-width destructive Skip Stop action below the primary action row', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsActions:'), source.indexOf('nearbyBanner:'));

    assert.match(
      componentSource,
      /<View style=\{styles\.stopDetailsActionStack\}>[\s\S]*<View style=\{\[styles\.buttonRow, styles\.stopDetailsActions\]\}>[\s\S]*>Skip Stop<\/Text>/u,
    );
    assert.match(componentSource, /disabled=\{!canSkip \|\| isSkipping\}/u);
    assert.match(componentSource, /\{isSkipping \? \([\s\S]*<ActivityIndicator color="#ffffff" \/>/u);
    assert.match(stylesSource, /stopDetailsActionStack:[\s\S]*gap: 10/u);
    assert.match(stylesSource, /stopDetailsSkipAction:[\s\S]*alignSelf: 'stretch'[\s\S]*backgroundColor: '#b42318'/u);
  });

  it('confirms Skip Stop and records the administrator assignment error before advancing', () => {
    const source = getAppRootSource();

    assert.match(
      source,
      /const canSkipFromStopDetails = canArriveFromStopDetails[\s\S]*currentStop\?\.deliveryStopId === stopDetailsStop\?\.deliveryStopId/u,
    );
    assert.match(source, /Alert\.alert\(\s*'Skip this stop\?'/u);
    assert.match(source, /text: 'Skip Stop'/u);
    assert.match(source, /handleTerminalStop\(selectedStop, 'failed'\)/u);
    assert.match(source, /reason: 'ADMIN_ROUTE_ASSIGNMENT_ERROR'/u);
  });

  it('lays stop information out as flat divided sections instead of cards', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsPage:'), source.indexOf('stopDetailsActions:'));

    assert.match(componentSource, /styles\.stopDetailsSection/u);
    assert.match(componentSource, /styles\.stopDetailsNote/u);
    assert.match(componentSource, /styles\.stopDetailsItemRow/u);
    assert.match(componentSource, /styles\.stopDetailsItemQuantity/u);
    assert.match(componentSource, /styles\.stopDetailsItemContent/u);
    assert.match(stylesSource, /stopDetailsSection:[\s\S]*borderBottomWidth: StyleSheet\.hairlineWidth/u);
    assert.match(stylesSource, /stopDetailsPage:[\s\S]*gap: 0,[\s\S]*paddingBottom: 96/u);
    assert.doesNotMatch(stylesSource, /borderRadius|backgroundColor|shadow/u);
  });

  it('uses a basic street address on Stop Details without hiding full address formatting elsewhere', () => {
    const source = getAppRootSource();

    assert.match(source, /function formatStopStreetAddress\(stop: AssignedRouteStop\): string/u);
    assert.match(source, /\[stop\.address\.address1, stop\.address\.address2\]/u);
    assert.match(source, /streetAddress\.length === 0 \? formatStopAddress\(stop\) : streetAddress/u);
  });

  it('removes global horizontal swipe-back while keeping explicit back decisions', () => {
    const source = getAppRootSource();

    assert.match(source, /const handleAppBack = useCallback\(\(\): boolean =>/u);
    assert.match(source, /BackHandler\.addEventListener\('hardwareBackPress', handleAppBack\)/u);
    assert.doesNotMatch(source, /PanResponder|swipeBackResponder|SWIPE_BACK_|panHandlers/u);
    assert.match(source, /case 'stopDetails':[\s\S]*setSelectedStopDetailsId\(null\);[\s\S]*setScreen\(stopDetailsReturnScreen\);[\s\S]*return true;/u);
    assert.doesNotMatch(source, /stopDetailsBackTarget/u);
    assert.match(source, /<StopDetailsScreen[\s\S]*onBack=\{\(\) => \{[\s\S]*handleAppBack\(\);[\s\S]*\}\}/u);
    assert.doesNotMatch(source, /trackingDeckPanResponder/u);
  });
});
