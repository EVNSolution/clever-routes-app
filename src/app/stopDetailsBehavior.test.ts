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
    const source = getAppRootSource();

    assert.match(componentSource, /<View style=\{styles\.stopDetailsPage\}>/u);
    assert.match(source, /screen === 'stopDetails' \? \([\s\S]*`Stop \$\{stopDetailsStop\.sequence\}`/u);
    assert.match(componentSource, /style=\{styles\.stopDetailsAddress\}/u);
    assert.match(componentSource, /formatStopStreetAddress\(stop\)/u);
    assert.doesNotMatch(componentSource, /numberOfLines=\{2\} style=\{styles\.stopDetailsAddress\}/u);
    assert.match(componentSource, /<Text style=\{styles\.stopDetailsSectionTitle\}>Order<\/Text>/u);
    assert.match(componentSource, /<DataRow label="Order" value=\{stop\.orderName\}/u);
    assert.match(componentSource, /<Text style=\{styles\.stopDetailsSectionTitle\}>Customer<\/Text>/u);
    assert.match(componentSource, /customerName \?\? 'Not available'/u);
    assert.match(componentSource, /customerPhone \?\? 'Phone unavailable'/u);
    assert.match(componentSource, /formatAssignedRoutePaymentSummary\(stop\)/u);
    assert.match(componentSource, /isAssignedRoutePickupStop\(stop\)/u);
    assert.match(componentSource, /isPickupStop \? 'Order Type' : 'Payment'/u);
    assert.match(componentSource, /isPickupStop \? \([\s\S]*label="Pickup"/u);
    assert.match(componentSource, /const paymentAmount = formatAssignedRouteCompactPaymentAmount\(stop\.totalPriceAmount, stop\.currencyCode\)/u);
    assert.match(componentSource, /const paymentMethodLabel = payment\.methodLabel === 'Payment' \? null : payment\.methodLabel/u);
    assert.match(componentSource, /payment\.methodLabel/u);
    assert.match(componentSource, /paymentMethodLabel === null \? null : \([\s\S]*\{paymentMethodLabel\}/u);
    assert.match(componentSource, /label=\{payment\.status\.label\}/u);
    assert.match(componentSource, /StatusChip large label=\{paymentAmount\} tone=\{payment\.status\.tone\}/u);
    assert.doesNotMatch(componentSource, /payment\.amountLabel/u);
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
    assert.doesNotMatch(componentSource, /label="Complete"|label="Search Address"|label="Call"|label="Message"/u);
    assert.doesNotMatch(componentSource, /Stop Details|stopSummaryCard|stopBadge|listPanel|paymentBadgeOnlyPanel|stopItemsPanel|TextCard/u);
    assert.doesNotMatch(componentSource, /Items to drop|formatAssignedRouteItemLine/u);
  });

  it('keeps the full address visible and restores compact payment context beside the amount pill', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsAddressRow:'), source.indexOf('stopDetailsItemHeader:'));

    assert.match(componentSource, /<Text style=\{styles\.stopDetailsAddress\}>\{stopAddress\}<\/Text>/u);
    assert.match(stylesSource, /stopDetailsAddressRow:[\s\S]*flexDirection: 'row'/u);
    assert.match(stylesSource, /stopDetailsAddress:[\s\S]*flex: 1/u);
    assert.match(source, /statusChipLarge:[\s\S]*fontSize: 18,[\s\S]*paddingHorizontal: 14,[\s\S]*paddingVertical: 9/u);
    assert.match(stylesSource, /stopDetailsPaymentRow:[\s\S]*justifyContent: 'space-between'/u);
    assert.match(stylesSource, /stopDetailsPaymentContext:[\s\S]*flexDirection: 'row'/u);
  });

  it('copies the exact visible Stop Details address with an accessible shortcut', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();

    assert.match(source, /import \* as Clipboard from 'expo-clipboard'/u);
    assert.match(source, /async function handleCopyAddress\(address: string\)/u);
    assert.match(source, /await Clipboard\.setStringAsync\(address\)/u);
    assert.match(source, /setMessage\('Address copied\.'\)/u);
    assert.match(source, /setMessage\('Address could not be copied\.'\)/u);
    assert.match(source, /onCopyAddress=\{\(\) => \{ void handleCopyAddress\(formatStopStreetAddress\(stopDetailsStop\)\); \}\}/u);
    assert.match(componentSource, /const stopAddress = formatStopStreetAddress\(stop\)/u);
    assert.match(componentSource, /<View style=\{styles\.stopDetailsAddressRow\}>[\s\S]*\{stopAddress\}[\s\S]*accessibilityLabel="Copy address"[\s\S]*icon="copy-outline"[\s\S]*onPress=\{onCopyAddress\}/u);
  });

  it('keeps call and message as customer icon shortcuts outside the delivery action hierarchy', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const customerSectionSource = componentSource.slice(
      componentSource.indexOf('<Text style={styles.stopDetailsSectionTitle}>Customer</Text>'),
      componentSource.indexOf('<View style={[styles.stopDetailsSection, styles.stopDetailsPaymentSection]}>'),
    );
    const stylesSource = source.slice(source.indexOf('stopDetailsCustomerRow:'), source.indexOf('nearbyBanner:'));

    assert.match(
      componentSource,
      /label="Arrive"[\s\S]*tone="arrive"[\s\S]*label="Navigate"[\s\S]*tone="navigate"/u,
    );
    assert.doesNotMatch(componentSource, /label="Call"|tone="call"/u);
    assert.match(componentSource, /onMessage\(\): void/u);
    assert.match(componentSource, /const customerPhone = stop\.phone\?\.trim\(\) \|\| null/u);
    assert.match(customerSectionSource, /<StopContactIconButton[\s\S]*accessibilityLabel=\{`Call \$\{customerName \?\? 'customer'\}`\}[\s\S]*icon="call-outline"[\s\S]*onPress=\{onCall\}/u);
    assert.match(customerSectionSource, /<StopContactIconButton[\s\S]*accessibilityLabel=\{`Message \$\{customerName \?\? 'customer'\}`\}[\s\S]*icon="chatbubble-outline"[\s\S]*onPress=\{onMessage\}/u);
    assert.match(componentSource, /customerPhone !== null \? \([\s\S]*styles\.stopDetailsCustomerActions/u);
    const callHandlerSource = source.slice(
      source.indexOf('async function handleCallStop'),
      source.indexOf('async function handleMessageStop'),
    );
    assert.match(callHandlerSource, /const phone = stop\?\.phone\?\.trim\(\)/u);
    assert.match(callHandlerSource, /Linking\.openURL\(`tel:\$\{phone\}`\)/u);
    assert.doesNotMatch(callHandlerSource, /operatorSupportContact/u);
    assert.match(source, /onMessage=\{\(\) => handleMessageStop\(stopDetailsStop\)\}/u);
    assert.match(source, /async function handleMessageStop\(stop: AssignedRouteStop \| null\)[\s\S]*Linking\.openURL\(`sms:\$\{phone\}`\)/u);
    assert.match(componentSource, /disabled=\{!canArrive \|\| isArriving\}/u);
    assert.match(componentSource, /loading=\{isArriving\}/u);
    assert.match(stylesSource, /stopDetailsContactIconButton:[\s\S]*height: 48,[\s\S]*width: 48/u);
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
    assert.match(source, /showOperationalDialog\(\s*'Skip this stop\?'/u);
    assert.match(source, /text: 'Skip Stop'/u);
    assert.match(source, /handleTerminalStop\(selectedStop, 'failed'\)/u);
    assert.match(source, /reason: 'ADMIN_ROUTE_ASSIGNMENT_ERROR'/u);
  });

  it('lays stop information out as flat divided sections instead of cards', () => {
    const source = getAppRootSource();
    const componentSource = getStopDetailsComponentSource();
    const stylesSource = source.slice(source.indexOf('stopDetailsPage:'), source.indexOf('stopDetailsCustomerRow:'));

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
    assert.match(source, /screen === 'stopDetails' \? \([\s\S]*<FixedScreenHeader[\s\S]*onBack=\{handleAppBack\}/u);
    assert.doesNotMatch(source, /trackingDeckPanResponder/u);
  });
});
