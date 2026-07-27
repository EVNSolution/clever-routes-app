import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');
const cameraCapturePath = join(dirname(fileURLToPath(import.meta.url)), '../platform/expo/camera/expoProofPhotoCaptureService.ts');
const nativeMapPath = join(dirname(fileURLToPath(import.meta.url)), 'NativeRouteMapPreview.tsx');
const routeVisualStatePath = join(dirname(fileURLToPath(import.meta.url)), 'routeVisualState.ts');

function getRouteSessionComponentSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function RouteSessionScreen(');
  const end = source.indexOf('function MapPreviewScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('route session current task behavior', () => {
  it('restores server in-progress routes instead of presenting them as Ready', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /companyGuidance\.executionStatus === 'IN_PROGRESS'/u);
    assert.match(appSource, /getAssignedRouteServerProgress/u);
    assert.match(appSource, /const pickupIsUnconfirmed = restoredServerProgress\.navigationStepIndex === COMPANY_STEP_INDEX[\s\S]*activeRouteSession\?\.pickupCompletedAt === undefined/u);
    assert.match(appSource, /pickupIsUnconfirmed[\s\S]*\? COMPANY_STEP_INDEX/u);
    assert.match(appSource, /setCompletedStopIds\(\(current\) => \[/u);
    assert.match(appSource, /markActiveRouteStarted/u);
  });

  it('does not resurrect a server in-progress route while its local terminal event is queued', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /pendingRouteEnd: getPendingRouteEnd\(queue, session\.route\.id\) \?\? undefined/u);
    assert.match(appSource, /session\.companyGuidance\.executionStatus === 'IN_PROGRESS' && session\.pendingRouteEnd === undefined/u);
    assert.match(appSource, /session\.route\.id === activeRouteSession\.routePlanId[\s\S]*session\.pendingRouteEnd === undefined/u);
    assert.match(appSource, /session\.pendingRouteEnd === 'completed'[\s\S]*'completed'[\s\S]*session\.pendingRouteEnd === 'released'[\s\S]*'ready'/u);
  });

  it('clears previous route progress before a new route starts', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const start = appSource.indexOf('async function startRouteSessionAfterConfirmed(');
    const end = appSource.indexOf('\n\n  function handleOpenRoutePreview(', start);
    const startSource = appSource.slice(start, end);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(startSource, /resetActiveRouteProgress\(\);/u);
    assert.ok(startSource.indexOf('routeAccessSaved') < startSource.indexOf('resetActiveRouteProgress();'));
    assert.ok(startSource.indexOf('resetActiveRouteProgress();') < startSource.indexOf('startDeliveryWithForegroundPermission'));
  });

  it('returns to My Routes after restoring an active session on app launch', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const restoreStart = appSource.indexOf('if (restoredActiveSession !== null) {');
    const restoreEnd = appSource.indexOf('if (shouldNavigateOnSuccess) {', restoreStart);
    const restoreSource = appSource.slice(restoreStart, restoreEnd);

    assert.notEqual(restoreStart, -1);
    assert.notEqual(restoreEnd, -1);
    assert.match(restoreSource, /setActiveRoutePlanId\(restoredActiveSession\.route\.id\);[\s\S]*setNavigationStepIndex\(restoredStepIndex\);[\s\S]*setScreen\('mainTabs'\)/u);
    assert.match(restoreSource, /setMessage\('Active route session restored\.'\)/u);
    assert.doesNotMatch(restoreSource, /Tap Continue/u);
    assert.doesNotMatch(restoreSource, /setScreen\('routeSession'\)/u);
  });

  it('starts GPS tracking inside Store Pickup before switching to a compact stop task', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /routeStatus === 'ready' \? \([\s\S]*<Text style=\{styles\.sectionTitle\}>Store Pickup<\/Text>[\s\S]*company\?\.pickupGuidance[\s\S]*<PrimaryButton[\s\S]*label="Start Session"[\s\S]*onPress=\{onStartRoute\}/u);
    assert.match(componentSource, /routeStatus === 'active' && !allStopsCompleted \? \([\s\S]*<View style=\{styles\.currentTaskTitleRow\}>[\s\S]*<Text style=\{styles\.sectionTitle\}>\{currentTaskTitle\}<\/Text>[\s\S]*<StatusChip compact label=\{currentTaskPayment\.status\.label\} tone=\{currentTaskPayment\.status\.tone\} \/>[\s\S]*<\/View>/u);
    assert.match(componentSource, /const currentTaskTitle = isPickupTask \? 'Store Pickup' : stop === null \? 'Next Stop' : `Stop \$\{stop\.sequence\}`/u);
    assert.match(componentSource, /const currentTaskAddress = stop === null \? null : formatStopSearchAddress\(stop\)/u);
    assert.doesNotMatch(componentSource, /company\?\.companyDisplayName/u);
    assert.doesNotMatch(componentSource, />Current Task</u);
    assert.doesNotMatch(componentSource, /Company Pickup/u);
    assert.doesNotMatch(componentSource, /Company pickup guidance/u);
    assert.match(componentSource, /const currentTaskPayment = stop === null \? null : formatAssignedRoutePaymentSummary\(stop\)/u);
    assert.match(componentSource, /const currentTaskPaymentAmount = stop === null[\s\S]*\? null[\s\S]*: formatAssignedRouteCompactPaymentAmount\(stop\.totalPriceAmount, stop\.currencyCode\)/u);
    assert.match(componentSource, /<View style=\{styles\.currentTaskMetaRow\}>[\s\S]*currentTaskAddress !== null \? \([\s\S]*<Text style=\{styles\.currentTaskAddressText\}>\{currentTaskAddress\}<\/Text>[\s\S]*\) : null[\s\S]*<Text style=\{styles\.currentTaskPaymentAmount\}>\{currentTaskPaymentAmount\}<\/Text>/u);
    assert.match(componentSource, /<View style=\{styles\.routeActionRow\}>[\s\S]*<PrimaryButton compact disabled=\{isRecordingArrival\} label="Arrive" loading=\{isRecordingArrival\} onPress=\{onArrived\} \/>[\s\S]*<SecondaryButton compact label="Navigate" onPress=\{onOpenNavigation\} \/>[\s\S]*<\/View>/u);
    assert.match(componentSource, /formatAssignedRouteEta\(stop\.estimatedArrivalAt, route\.timezone\)[\s\S]*>ETA \{currentTaskEta\}<\/Text>/u);
    assert.match(componentSource, /styles\.routeActionButton/u);
    assert.match(componentSource, /styles\.currentTaskAddressText/u);
    assert.match(appSource, /routeActionRow:[\s\S]*flexDirection: 'row'/u);
    assert.match(appSource, /routeActionButton:[\s\S]*flex: 1/u);
    assert.match(appSource, /currentTaskTitleRow:[\s\S]*alignItems: 'center',[\s\S]*flexDirection: 'row',[\s\S]*justifyContent: 'space-between'/u);
    assert.match(appSource, /currentTaskMetaRow:[\s\S]*alignItems: 'center',[\s\S]*flexDirection: 'row'/u);
    assert.match(appSource, /currentTaskStatusColumn:[\s\S]*alignItems: 'flex-end',[\s\S]*marginLeft: 'auto'/u);
    assert.doesNotMatch(componentSource, /Mark as Arrived|View Stop Details|currentTaskActions/u);
    assert.doesNotMatch(componentSource, /onViewCurrentStop/u);
  });

  it('keeps Store Pickup active after GPS starts until pickup is completed', () => {
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /const isPickupTask = routeStatus === 'active' && currentNavigationStepIndex === COMPANY_STEP_INDEX/u);
    assert.match(componentSource, /const currentTaskTitle = isPickupTask \? 'Store Pickup' : stop === null \? 'Next Stop'/u);
    assert.match(componentSource, /const currentTaskAddress = stop === null \? null : formatStopSearchAddress\(stop\)/u);
    assert.match(componentSource, /isPickupTask \? \([\s\S]*<PrimaryButton label="Pickup & Start Route" onPress=\{onArrived\} \/>[\s\S]*\) : \([\s\S]*label="Arrive"[\s\S]*label="Navigate"/u);
    assert.match(readFileSync(appRootPath, 'utf8'), /saveActiveRouteSession\(\{[\s\S]*navigationStepIndex: 1,[\s\S]*pickupCompleted: true/u);
  });

  it('keeps Arrive on the route session without a redundant live tracking page', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const routeSessionSource = getRouteSessionComponentSource();

    assert.match(routeSessionSource, /label="Arrive"/u);
    assert.doesNotMatch(appSource, /liveTracking|LiveTrackingScreen|Live Tracking/u);
  });

  it('opens only the current stop from Navigate and reserves whole-route directions for Open Route', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const routeSessionSource = getRouteSessionComponentSource();

    assert.match(
      appSource,
      /<RouteSessionScreen[\s\S]*onOpenNavigation=\{\(\) => handleOpenNavigationForStop\(currentStop\)\}[\s\S]*onOpenRouteNavigation=\{\(\) => handleOpenRouteNavigation\(selectedRoute\)\}/u,
    );
    assert.match(routeSessionSource, /label="Navigate" onPress=\{onOpenNavigation\}/u);
    assert.match(routeSessionSource, /label="Open Route" onPress=\{onOpenRouteNavigation\}/u);
  });

  it('keeps Store information out of Stops and lists delivery addresses only', () => {
    const componentSource = getRouteSessionComponentSource();
    const sequenceStart = componentSource.indexOf('<Text style={styles.sectionTitle}>Stops</Text>');
    const sequenceEnd = componentSource.indexOf("{routeStartedEventResult?.kind === 'recorded'", sequenceStart);
    const sequenceSource = componentSource.slice(sequenceStart, sequenceEnd);

    assert.notEqual(sequenceStart, -1);
    assert.notEqual(sequenceEnd, -1);
    assert.match(sequenceSource, /route\.stops\.map/u);
    assert.match(sequenceSource, /marker=\{String\(stop\.sequence\)\.padStart\(2, '0'\)\}/u);
    assert.match(sequenceSource, /title=\{formatStopStreetAddress\(stop\)\}/u);
    assert.doesNotMatch(sequenceSource, /Store Pickup|Pickup point|companyDisplayName|pickupGuidance/u);
  });

  it('opens any stop quietly and confirms an out-of-order change only when Arrive is pressed', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const openStart = appSource.indexOf('function handleOpenStopFromRouteSession(');
    const openEnd = appSource.indexOf('\n\n  function handleArriveFromStopDetails(', openStart);
    const openSource = appSource.slice(openStart, openEnd);
    const arriveStart = appSource.indexOf('function handleArriveFromStopDetails(');
    const arriveEnd = appSource.indexOf('\n\n  async function handleOpenRouteNavigation(', arriveStart);
    const arriveSource = appSource.slice(arriveStart, arriveEnd);

    assert.notEqual(openStart, -1);
    assert.notEqual(openEnd, -1);
    assert.match(openSource, /setSelectedStopDetailsId\(selectedStop\.deliveryStopId\)/u);
    assert.match(openSource, /setScreen\('stopDetails'\)/u);
    assert.doesNotMatch(openSource, /Alert\.alert|buildOutOfOrderStopArrivalWarning|saveActiveRouteSession/u);

    assert.notEqual(arriveStart, -1);
    assert.match(arriveSource, /buildOutOfOrderStopArrivalWarning\(\{/u);
    assert.match(arriveSource, /Alert\.alert\(warning\.title, warning\.message/u);
    assert.match(arriveSource, /text: 'Arrive'/u);
    assert.match(arriveSource, /activateAndRecordStopArrival\(selectedStop\)/u);
    assert.match(appSource, /await driverAccessTokenStore\.saveActiveRouteSession\(\{[\s\S]*navigationStepIndex: selectedStopIndex \+ 1/u);
    assert.match(appSource, /await recordStopArrival\(selectedStop, 'stopDetails', requestScreen\)/u);
    assert.match(appSource, /await submitStopArrivalForRouteStop\(selectedRouteSession, stop\)/u);
  });

  it('chooses the next incomplete stop without assuming numeric sequence progression', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /getNextIncompleteRouteStepIndex\(\{/u);
    assert.doesNotMatch(appSource, /const nextNavigationStepIndex = navigationStepIndex \+ 1/u);
  });

  it('shows only the search-ready street and city in the active task address', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /function formatStopSearchAddress\(stop: AssignedRouteStop\): string/u);
    assert.match(appSource, /const street = stop\.address\.address1\.trim\(\)/u);
    assert.match(appSource, /const city = stop\.address\.city\.trim\(\)/u);
    assert.match(appSource, /street\.toLocaleLowerCase\(\)\.includes\(city\.toLocaleLowerCase\(\)\)/u);
    assert.doesNotMatch(appSource.slice(
      appSource.indexOf('function formatStopSearchAddress('),
      appSource.indexOf('function formatStopStreetAddress('),
    ), /address2|province|postalCode|countryCode/u);
  });

  it('starts GPS tracking on Store Pickup before the first delivery stop', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /const initialStepIndex = COMPANY_STEP_INDEX/u);
    assert.match(appSource, /saveActiveRouteSession\(\{[\s\S]*navigationStepIndex: initialStepIndex/u);
    assert.match(appSource, /setNavigationStepIndex\(initialStepIndex\)/u);
    assert.match(appSource, /notification: buildActiveRouteForegroundNotification\(\{ currentStepIndex: initialStepIndex, route: routeSession\.route \}\)/u);
    assert.doesNotMatch(appSource, /GPS tracking (?:is active|started)/u);
    assert.doesNotMatch(appSource, /formatContinuousLocationResult/u);
    assert.doesNotMatch(appSource, /continuousLocationResult !== null \? <StatusBanner/u);
  });

  it('opens the exact stop details screen when the foreground notification is pressed', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const resetStart = appSource.indexOf('function resetActiveRouteProgress()');
    const resetEnd = appSource.indexOf('\n\n  function refreshOfflineQueueCount()', resetStart);
    const resetSource = appSource.slice(resetStart, resetEnd);

    assert.match(appSource, /Linking\.addEventListener\('url', \(\{ url \}\) => handleUrl\(url\)\)/u);
    assert.match(appSource, /parseActiveRouteNotificationUrl\(url\)/u);
    assert.match(appSource, /pendingActiveRouteNotificationTargetRef\.current = target/u);
    assert.match(appSource, /pendingActiveRouteNotificationTarget === null[\s\S]*\|\| routeSessions\.length === 0[\s\S]*\|\| !isDriverRestoreComplete/u);
    assert.match(appSource, /setIsDriverRestoreComplete\(true\)/u);
    assert.match(appSource, /screen === 'mainTabs' &&[\s\S]*pendingActiveRouteNotificationTargetRef\.current === null/u);
    assert.match(appSource, /isActiveRouteNotificationTargetCurrent\(\{/u);
    assert.match(appSource, /setSelectedRouteId\(routeSession\.route\.id\);[\s\S]*setSelectedStopDetailsId\(stop\.deliveryStopId\);[\s\S]*setScreen\('stopDetails'\)/u);
    assert.doesNotMatch(resetSource, /setPendingActiveRouteNotificationTarget\(null\)/u);
  });

  it('records the current stop arrival before an arrival notification opens completion', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const handlerStart = appSource.indexOf('const handleStopArrivalNotificationPress = useCallback(');
    const handlerEnd = appSource.indexOf('\n\n  useEffect(() => {', handlerStart);
    const handlerSource = appSource.slice(handlerStart, handlerEnd);

    assert.notEqual(handlerStart, -1);
    assert.notEqual(handlerEnd, -1);
    assert.match(handlerSource, /activeRoutePlanId !== routeSession\.route\.id/u);
    assert.match(handlerSource, /navigationStepIndex !== stopIndex \+ 1/u);
    assert.match(handlerSource, /await submitStopArrivalForRouteStop\(routeSession, routeSession\.route\.stops\[stopIndex\]\)/u);
    assert.match(handlerSource, /const requestScreen = screenRef\.current/u);
    assert.match(handlerSource, /if \(screenRef\.current !== requestScreen\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setArrivalCheckReturnScreen\('routeSession'\)/u);
    assert.ok(handlerSource.indexOf('activeRoutePlanId !== routeSession.route.id') < handlerSource.indexOf('completedStopIds.includes'));
    assert.ok(handlerSource.indexOf('submitStopArrivalForRouteStop') < handlerSource.indexOf("setScreen('arrivalCheck')"));
  });

  it('returns from arrival completion to the screen that initiated Arrive', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const backHandlerStart = appSource.indexOf('const handleAppBack = useCallback(');
    const backHandlerEnd = appSource.indexOf('\n\n  useEffect(() => {', backHandlerStart);
    const backHandlerSource = appSource.slice(backHandlerStart, backHandlerEnd);

    assert.notEqual(backHandlerStart, -1);
    assert.notEqual(backHandlerEnd, -1);
    assert.match(appSource, /type ArrivalCheckReturnScreen = 'routeSession' \| 'stopDetails'/u);
    assert.match(appSource, /const \[arrivalCheckReturnScreen, setArrivalCheckReturnScreen\] = useState<ArrivalCheckReturnScreen>\('routeSession'\)/u);
    assert.match(appSource, /await recordStopArrival\(currentStop, 'routeSession'\)/u);
    assert.match(appSource, /await recordStopArrival\(selectedStop, 'stopDetails', requestScreen\)/u);
    assert.match(appSource, /void recordStopArrival\(selectedStop, 'stopDetails'\)/u);
    assert.match(appSource, /async function recordStopArrival\([\s\S]*requestScreen = screenRef\.current,[\s\S]*\)/u);
    assert.match(appSource, /setArrivalCheckReturnScreen\(returnScreen\);[\s\S]*setScreen\('arrivalCheck'\)/u);
    assert.match(appSource, /handleStopArrivalNotificationPress[\s\S]*setArrivalCheckReturnScreen\('routeSession'\);[\s\S]*setScreen\('arrivalCheck'\)/u);
    assert.match(backHandlerSource, /case 'arrivalCheck':[\s\S]*setScreen\(arrivalCheckReturnScreen\);[\s\S]*return true/u);
    assert.match(appSource, /\[accountName, arrivalCheckReturnScreen, isPhotoActionSheetVisible, screen, setScreen, stopDetailsReturnScreen\]/u);
    assert.match(appSource, /<ArrivalCheckScreen[\s\S]*onBack=\{\(\) => \{[\s\S]*handleAppBack\(\);[\s\S]*\}\}/u);
    assert.doesNotMatch(backHandlerSource, /setScreen\('stopDetails'\)/u);
  });

  it('treats Back as a global overlay dismissal before navigating the underlying screen', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const backHandlerStart = appSource.indexOf('const handleAppBack = useCallback(');
    const backHandlerEnd = appSource.indexOf('\n\n  useEffect(() => {', backHandlerStart);
    const backHandlerSource = appSource.slice(backHandlerStart, backHandlerEnd);

    assert.notEqual(backHandlerStart, -1);
    assert.notEqual(backHandlerEnd, -1);
    assert.match(backHandlerSource, /if \(isPhotoActionSheetVisible\) \{[\s\S]*setIsPhotoActionSheetVisible\(false\);[\s\S]*return true;[\s\S]*\}[\s\S]*switch \(screen\)/u);
    assert.match(appSource, /\[accountName, arrivalCheckReturnScreen, isPhotoActionSheetVisible, screen, setScreen, stopDetailsReturnScreen\]/u);
  });

  it('does not let a completed async Arrive request pull the user forward after Back', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const arrivalStart = appSource.indexOf('async function recordStopArrival(');
    const arrivalEnd = appSource.indexOf('\n\n  async function activateAndRecordStopArrival(', arrivalStart);
    const arrivalSource = appSource.slice(arrivalStart, arrivalEnd);

    assert.notEqual(arrivalStart, -1);
    assert.notEqual(arrivalEnd, -1);
    assert.match(appSource, /const screenRef = useRef<AppScreen>\('loginPhone'\)/u);
    assert.match(appSource, /const setScreen = useCallback\(\(nextScreen: AppScreen\) => \{[\s\S]*screenRef\.current = nextScreen;[\s\S]*setScreenState\(nextScreen\);[\s\S]*\}, \[\]\)/u);
    assert.match(arrivalSource, /requestScreen = screenRef\.current/u);
    assert.match(arrivalSource, /if \(screenRef\.current !== requestScreen\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setArrivalCheckReturnScreen\(returnScreen\);[\s\S]*setScreen\('arrivalCheck'\)/u);
  });

  it('keeps preview and completed-route screens bound to the explicitly selected route', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const contextStart = appSource.indexOf("const usesSelectedRouteContext = screen === 'completedDeliveries'");
    const contextEnd = appSource.indexOf('\n  const selectedRoute =', contextStart);
    const contextSource = appSource.slice(contextStart, contextEnd);

    assert.notEqual(contextStart, -1);
    assert.notEqual(contextEnd, -1);
    assert.match(contextSource, /const usesSelectedRouteContext = screen === 'completedDeliveries'[\s\S]*\|\| screen === 'mapPreview'[\s\S]*\|\| screen === 'routePreview'/u);
    assert.match(contextSource, /const selectedRouteContextId = usesSelectedRouteContext[\s\S]*\? selectedRouteId[\s\S]*: activeRoutePlanId \?\? selectedRouteId/u);
    assert.match(contextSource, /const selectedRouteSession = selectedRouteContextId === null[\s\S]*\? null[\s\S]*: routeSessions\.find\([\s\S]*\) \?\? null/u);
    assert.doesNotMatch(contextSource, /routeSessions\[0\] \?\? null/u);
  });

  it('defers notification navigation while a delivery-critical surface is active', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const linkingEffectStart = appSource.indexOf("Linking.addEventListener('url'");
    const deepLinkEffectStart = appSource.indexOf('pendingActiveRouteNotificationTarget === null', linkingEffectStart);
    const deepLinkEffectEnd = appSource.indexOf('\n\n  function applyEtaUpdateToRoute(', deepLinkEffectStart);
    const deepLinkEffectSource = appSource.slice(deepLinkEffectStart, deepLinkEffectEnd);

    assert.notEqual(deepLinkEffectStart, -1);
    assert.notEqual(deepLinkEffectEnd, -1);
    assert.match(appSource, /const isNavigationInterruptionProtected = screen === 'arrivalCheck'[\s\S]*\|\| screen === 'proofCamera'[\s\S]*\|\| isPhotoActionSheetVisible[\s\S]*\|\| isCapturingPhoto[\s\S]*\|\| isCompletingStop/u);
    assert.match(deepLinkEffectSource, /pendingActiveRouteNotificationTarget === null[\s\S]*\|\| isNavigationInterruptionProtected/u);
    assert.match(deepLinkEffectSource, /isNavigationInterruptionProtected,[\s\S]*navigationStepIndex/u);
  });

  it('does not let route start or stop completion override a newer global screen choice', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const startBegin = appSource.indexOf('async function startRouteSessionAfterConfirmed(');
    const startEnd = appSource.indexOf('\n\n  function handleOpenRoutePreview(', startBegin);
    const startSource = appSource.slice(startBegin, startEnd);
    const terminalBegin = appSource.indexOf('async function handleTerminalStop(');
    const terminalEnd = appSource.indexOf('\n\n  async function finishRoute(', terminalBegin);
    const terminalSource = appSource.slice(terminalBegin, terminalEnd);

    assert.match(startSource, /const requestScreen = screenRef\.current/u);
    assert.match(startSource, /if \(screenRef\.current === requestScreen\) \{[\s\S]*setScreen\('routeSession'\);[\s\S]*\}/u);
    assert.match(terminalSource, /const requestScreen = screenRef\.current/u);
    assert.match(terminalSource, /if \(screenRef\.current === requestScreen\) \{[\s\S]*setScreen\('routeSession'\);[\s\S]*\}/u);
  });

  it('keeps Store Pickup and out-of-order arrival work from overriding Back', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const arrivedBegin = appSource.indexOf('async function handleArrivedAtStep()');
    const arrivedEnd = appSource.indexOf('\n\n  async function recordStopArrival(', arrivedBegin);
    const arrivedSource = appSource.slice(arrivedBegin, arrivedEnd);
    const activateBegin = appSource.indexOf('async function activateAndRecordStopArrival(');
    const activateEnd = appSource.indexOf('\n\n  function handleOpenStopFromRouteSession(', activateBegin);
    const activateSource = appSource.slice(activateBegin, activateEnd);

    assert.match(arrivedSource, /const requestScreen = screenRef\.current/u);
    assert.match(arrivedSource, /if \(screenRef\.current === requestScreen\) \{[\s\S]*setScreen\('routeSession'\);[\s\S]*\}/u);
    assert.match(activateSource, /const requestScreen = screenRef\.current/u);
    assert.match(activateSource, /recordStopArrival\(selectedStop, 'stopDetails', requestScreen\)/u);
  });

  it('recovers route-bound screens instead of rendering a blank surface after refresh', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const recoveryStart = appSource.indexOf('const isRouteBoundScreen =');
    const recoveryEffectStart = appSource.indexOf('\n\n  useEffect(() => {', recoveryStart);
    const recoveryEnd = appSource.indexOf('\n\n  useEffect(() => {', recoveryEffectStart + 1);
    const recoverySource = appSource.slice(recoveryStart, recoveryEnd);

    assert.notEqual(recoveryStart, -1);
    assert.notEqual(recoveryEffectStart, -1);
    assert.notEqual(recoveryEnd, -1);
    assert.match(recoverySource, /screen === 'arrivalCheck'[\s\S]*screen === 'completedDeliveries'[\s\S]*screen === 'proofCamera'[\s\S]*screen === 'routePreview'[\s\S]*screen === 'routeSession'[\s\S]*screen === 'stopDetails'/u);
    assert.match(recoverySource, /if \(isRouteBoundScreen && selectedRoute === null\) \{[\s\S]*setScreen\('mainTabs'\);[\s\S]*return;[\s\S]*\}/u);
    assert.match(recoverySource, /if \(screen === 'stopDetails' && stopDetailsStop === null\) \{[\s\S]*setScreen\(stopDetailsReturnScreen\);[\s\S]*return;/u);
    assert.match(recoverySource, /if \(\(screen === 'arrivalCheck' \|\| screen === 'proofCamera'\) && currentStop === null\) \{[\s\S]*setScreen\('routeSession'\)/u);
  });

  it('bolds only the current Route Sequence item title', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /style=\{\[styles\.timelineTitle, state === 'completed' && styles\.timelineTitleCompleted, state === 'current' && styles\.timelineTitleCurrent\]\}/u);
    assert.match(appSource, /timelineTitle:[\s\S]*fontWeight: '400'/u);
    assert.match(appSource, /timelineTitleCurrent:[\s\S]*fontWeight: '700'/u);
  });

  it('shows only basic stop addresses in Route Sequence stop rows', () => {
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /title=\{formatStopStreetAddress\(stop\)\}/u);
    assert.doesNotMatch(componentSource, /formatRouteSequenceStopSubtitle/u);
    assert.doesNotMatch(componentSource, /subtitle=\{formatRouteSequenceStopSubtitle\(stop\)\}/u);
  });

  it('renders Route Sequence as a compact divided list without large marker icons or status pills', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /<Text style=\{\[styles\.timelineIndex, state === 'completed' && styles\.timelineIndexCompleted, state === 'current' && styles\.timelineIndexCurrent\]\}>\{marker\}<\/Text>/u);
    assert.match(appSource, /meta !== undefined \? <Text style=\{\[styles\.timelineMeta/u);
    assert.doesNotMatch(appSource, /styles\.timelineMarker/u);
    assert.match(appSource, /timelineRow:[\s\S]*borderBottomWidth: StyleSheet\.hairlineWidth,[\s\S]*minHeight: 44/u);
    assert.match(appSource, /timelineIndex:[\s\S]*backgroundColor: ROUTE_VISUAL_STATE_COLORS\.upcoming,[\s\S]*borderRadius: 6,[\s\S]*height: 26,[\s\S]*width: 30/u);
    assert.match(appSource, /timelineIndexCompleted:[\s\S]*backgroundColor: ROUTE_VISUAL_STATE_COLORS\.completed/u);
    assert.match(appSource, /timelineIndexCurrent:[\s\S]*backgroundColor: ROUTE_VISUAL_STATE_COLORS\.current/u);
    assert.match(appSource, /timelineRowCurrent:[\s\S]*backgroundColor: ROUTE_VISUAL_STATE_SURFACES\.current/u);
    assert.match(appSource, /const metaTone = completed \? 'neutral' : isProcessing \? 'green' : 'neutral'/u);
    assert.match(appSource, /timelineTitle:[\s\S]*fontSize: 13/u);
    assert.doesNotMatch(appSource, /timelineMarkerCompleted|timelineMarkerCurrent|timelineMarkerTextActive/u);
  });

  it('renders Route Session as a flat full-width route-first surface', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const componentSource = getRouteSessionComponentSource();

    assert.match(appSource, /contentContainerStyle=\{\[styles\.container, screen === 'routeSession' && styles\.routeSessionContainer\]\}/u);
    assert.match(appSource, /routeSessionContainer:[\s\S]*gap: 0,[\s\S]*paddingHorizontal: 0,/u);
    assert.match(componentSource, /<View style=\{styles\.routeSessionPage\}>/u);
    assert.match(componentSource, /<ScreenHeader onBack=\{onBack\} title=\{route\.name\} \/>/u);
    assert.match(componentSource, /<View style=\{styles\.routeSessionMetaRow\}>[\s\S]*\{route\.stops\.length\} \{route\.stops\.length === 1 \? 'Stop' : 'Stops'\}[\s\S]*Duration \{formatAssignedRouteDuration\(route\.routeMetrics\)\}[\s\S]*<\/View>/u);
    assert.doesNotMatch(componentSource, /\| Duration/u);
    assert.match(appSource, /routeSessionMetaRow:[\s\S]*gap: 20,[\s\S]*justifyContent: 'center'/u);
    assert.match(appSource, /routeSessionMeta:[\s\S]*color: '#344054'/u);
    assert.match(componentSource, /<View style=\{styles\.routeSessionMap\}>[\s\S]*<MapOverview[\s\S]*mapSize="session"[\s\S]*showUserLocation=\{routeStatus === 'active'\}/u);
    assert.doesNotMatch(componentSource, /Route Preview|Tap for full map/u);
    assert.doesNotMatch(componentSource, /<Pressable[\s\S]*<MapOverview/u);
    assert.doesNotMatch(componentSource, /pointerEvents="none"/u);
    assert.doesNotMatch(componentSource, /styles\.(summaryCard|routeSessionSummaryCard|routePreviewCard|currentTaskCard|timelineCard|listPanel)/u);
    assert.doesNotMatch(componentSource, /<InfoPanel/u);
    assert.doesNotMatch(componentSource, /title="Route Session"/u);
    assert.doesNotMatch(componentSource, /<DataRow label="Date"/u);
    assert.doesNotMatch(componentSource, /route\.deliveryDate/u);
    assert.doesNotMatch(componentSource, /company\?\.companyDisplayName \?\? route\.name/u);
    assert.doesNotMatch(componentSource, /route\.shopDomain/u);
  });

  it('passes current step context into map previews for current destination highlighting', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(appSource, /currentStepIndex=\{currentStepIndex\}/u);
    assert.match(nativeMapSource, /currentStopSequence/u);
    assert.match(nativeMapSource, /sequences\.includes\(currentStopSequence\)/u);
    assert.match(nativeMapSource, /\['==', \['get', 'markerState'\], 'current'\]/u);
    assert.doesNotMatch(nativeMapSource, /Current: Stop/u);
  });

  it('groups co-located stop numbers into a native capsule marker', () => {
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(nativeMapSource, /<GeoJSONSource data=\{routeMarkerCollection\}/u);
    assert.match(nativeMapSource, /id=\{SNAPPED_STOP_SOURCE_ID\} key=\{SNAPPED_STOP_SOURCE_ID\}/u);
    assert.match(nativeMapSource, /id=\{ROUTE_MARKER_SOURCE_ID\} key=\{ROUTE_MARKER_SOURCE_ID\}/u);
    assert.match(nativeMapSource, /id="route-preview-snapped-stop"[\s\S]*id="route-preview-marker-circle"[\s\S]*id="route-preview-marker-label"/u);
    assert.match(nativeMapSource, /'text-field': \['get', 'label'\]/u);
    assert.match(nativeMapSource, /groupRouteStopFeaturesByCoordinate/u);
    assert.match(nativeMapSource, /label: group\.features\.map[\s\S]*join\('  '\)/u);
    assert.match(nativeMapSource, /id="route-preview-marker-group"/u);
    assert.match(nativeMapSource, /'icon-text-fit': 'both'/u);
    assert.match(nativeMapSource, /id="route-preview-marker-group-border"[\s\S]*key="route-preview-marker-group-border"[\s\S]*id="route-preview-marker-group"[\s\S]*key="route-preview-marker-group"/u);
    assert.match(nativeMapSource, /ROUTE_MARKER_GROUP_BORDER_LAYOUT[\s\S]*'icon-text-fit-padding': \[8, 11, 8, 11\]/u);
    assert.match(nativeMapSource, /ROUTE_MARKER_GROUP_BORDER_PAINT[\s\S]*'icon-color': '#ffffff'[\s\S]*'text-opacity': 0/u);
    assert.match(nativeMapSource, /ROUTE_MARKER_GROUP_COMPACT_LAYOUT[\s\S]*'icon-text-fit-padding': \[2, 6, 2, 6\][\s\S]*'text-size': 8/u);
    assert.match(nativeMapSource, /ROUTE_MARKER_GROUP_COMPACT_BORDER_LAYOUT[\s\S]*'icon-text-fit-padding': \[3, 7, 3, 7\]/u);
    assert.match(nativeMapSource, /id="route-preview-marker-group-compact-border"[\s\S]*key="route-preview-marker-group-compact-border"[\s\S]*id="route-preview-marker-group-compact"[\s\S]*key="route-preview-marker-group-compact"/u);
    assert.doesNotMatch(nativeMapSource, /join\('\u00b7'\)|join\("\u00b7"\)/u);
    assert.doesNotMatch(nativeMapSource, /<Marker/u);
    assert.match(nativeMapSource, /activeLegFeature !== null/u);
    assert.doesNotMatch(nativeMapSource, /route-preview-stop-label/u);
  });

  it('keeps compact-map markers fixed to their coordinates and resolves overlap without a zoom cutoff', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(appSource, /compactRouteFocus=\{mapSize === 'session'\}/u);
    assert.doesNotMatch(nativeMapSource, /LIVE_ROUTE_DETAIL_MIN_ZOOM|ROUTE_MARKER_FOCUS_OPACITY|focusLabel/u);
    assert.match(nativeMapSource, /const ROUTE_MARKER_SESSION_FOCUS_LAYOUT = \{[\s\S]*'icon-allow-overlap': true,[\s\S]*'icon-ignore-placement': false,[\s\S]*'text-allow-overlap': true,[\s\S]*'text-ignore-placement': false/u);
    assert.match(nativeMapSource, /const ROUTE_MARKER_SESSION_CONTEXT_LAYOUT = \{[\s\S]*'icon-allow-overlap': false,[\s\S]*'icon-ignore-placement': false,[\s\S]*'text-allow-overlap': false,[\s\S]*'text-ignore-placement': false/u);
    assert.match(nativeMapSource, /\['==', \['get', 'markerState'\], 'current'\][\s\S]*\['==', \['get', 'kind'\], 'depot'\][\s\S]*id="route-preview-marker-session-focus"[\s\S]*layout=\{ROUTE_MARKER_SESSION_FOCUS_LAYOUT\}/u);
    assert.match(nativeMapSource, /\['!=', \['get', 'markerState'\], 'current'\][\s\S]*\['!=', \['get', 'kind'\], 'depot'\][\s\S]*id="route-preview-marker-session-context"[\s\S]*layout=\{ROUTE_MARKER_SESSION_CONTEXT_LAYOUT\}/u);
    assert.doesNotMatch(nativeMapSource, /text-variable-anchor|icon-offset|text-offset/u);
    assert.doesNotMatch(nativeMapSource, /minzoom=\{compactRouteFocus/u);
    assert.match(nativeMapSource, /id="route-preview-completed-line"[\s\S]*id="route-preview-active-leg-line"/u);
  });

  it('uses gray for completed, green for current, and blue for upcoming route states', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');
    const routeVisualStateSource = readFileSync(routeVisualStatePath, 'utf8');

    assert.match(routeVisualStateSource, /ROUTE_VISUAL_STATE_COLORS = \{[\s\S]*completed: '#667085',[\s\S]*current: '#12b76a',[\s\S]*upcoming: '#0b57d0'/u);
    assert.match(nativeMapSource, /import \{ ROUTE_VISUAL_STATE_COLORS \} from '\.\/routeVisualState'/u);
    assert.match(appSource, /import \{ ROUTE_VISUAL_STATE_COLORS, ROUTE_VISUAL_STATE_SURFACES \} from '\.\/routeVisualState'/u);
    assert.match(nativeMapSource, /buildRouteProgressFeature\(model, lastCompletedStopSequence\)/u);
    assert.match(nativeMapSource, /buildRouteLegFeature\(model, lastCompletedStopSequence, currentStopSequence\)/u);
    assert.match(nativeMapSource, /id="route-preview-line"[\s\S]*'line-color': ROUTE_VISUAL_STATE_COLORS\.upcoming,[\s\S]*'line-opacity': 1,[\s\S]*'line-width': 2\.75/u);
    assert.match(nativeMapSource, /id="route-preview-completed-line"[\s\S]*'line-color': ROUTE_VISUAL_STATE_COLORS\.completed,[\s\S]*'line-opacity': 1,[\s\S]*'line-width': 2\.75/u);
    assert.match(nativeMapSource, /id="route-preview-active-leg-line"[\s\S]*'line-color': ROUTE_VISUAL_STATE_COLORS\.current,[\s\S]*'line-opacity': 1,[\s\S]*'line-width': 3\.25/u);
    assert.match(nativeMapSource, /markerState: currentStepIndex > 0 \? 'completed' : 'current'/u);
    assert.match(nativeMapSource, /sequences\.every\(\(sequence\) => sequence < currentStopSequence\)[\s\S]*\? 'completed'/u);
    assert.match(nativeMapSource, /\['==', \['get', 'markerState'\], 'completed'\], ROUTE_VISUAL_STATE_COLORS\.completed/u);
    assert.match(nativeMapSource, /'circle-opacity': 1/u);
    assert.match(nativeMapSource, /'icon-opacity': 1/u);
    assert.match(nativeMapSource, /'text-opacity': 1/u);
  });

  it('keeps the inline session map adaptive and visually focused without disabling gestures', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const componentSource = getRouteSessionComponentSource();
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.doesNotMatch(appSource, /allowMapDragPan/u);
    assert.match(nativeMapSource, /attribution=\{false\}/u);
    assert.match(nativeMapSource, /compass=\{false\}/u);
    assert.match(nativeMapSource, /scaleBar=\{false\}/u);
    assert.match(nativeMapSource, /\sdragPan\s/u);
    assert.match(nativeMapSource, /\stouchZoom\s/u);
    assert.match(nativeMapSource, /\sdoubleTapZoom\s/u);
    assert.doesNotMatch(nativeMapSource, /preferredFramesPerSecond/u);
    assert.doesNotMatch(nativeMapSource, /route-preview-line-shadow|route-preview-marker-halo/u);
    assert.match(nativeMapSource, /id="route-preview-marker-circle"/u);
    assert.match(nativeMapSource, /'circle-radius': \[\s*'case',[\s\S]*10\.5,[\s\S]*8\.5,[\s\S]*6/u);
    assert.match(nativeMapSource, /'circle-color': \[\s*'case',[\s\S]*ROUTE_VISUAL_STATE_COLORS\.current,[\s\S]*ROUTE_VISUAL_STATE_COLORS\.completed,[\s\S]*ROUTE_VISUAL_STATE_COLORS\.current,[\s\S]*ROUTE_VISUAL_STATE_COLORS\.upcoming/u);
    assert.match(nativeMapSource, /'circle-opacity': 1/u);
    assert.match(nativeMapSource, /'circle-stroke-color': '#ffffff'/u);
    assert.match(nativeMapSource, /'text-opacity': 1/u);
    assert.doesNotMatch(componentSource, /Tap for full map/u);
    assert.doesNotMatch(componentSource, /routePreviewHeader/u);
    assert.doesNotMatch(appSource, /Tap the preview for a larger map/u);
    assert.doesNotMatch(appSource, /full interactive map/u);
    assert.doesNotMatch(nativeMapSource, /Interactive map/u);
    assert.doesNotMatch(nativeMapSource, /Pinch to zoom/u);
    assert.doesNotMatch(nativeMapSource, /Drag to pan/u);
    assert.match(nativeMapSource, /androidView="texture"/u);
  });

  it('opens the large map as a full-screen surface instead of a card', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /const isFullMapScreen = screen === 'mapPreview' && selectedRoute !== null/u);
    assert.match(appSource, /function MapPreviewScreen\(/u);
    assert.match(appSource, /style=\{styles\.fullScreenMap\}/u);
    assert.match(appSource, /paddingTop: 34/u);
    assert.match(appSource, /fullMapCanvas:[\s\S]*height: '100%'/u);
    assert.doesNotMatch(appSource, /mapHeight/u);
    assert.doesNotMatch(appSource, /liveMapPreviewCard/u);
  });

  it('shows live GPS in active sessions and focuses map controls on the current trip', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(appSource, /const isLiveLocationEnabled = selectedRoute !== null[\s\S]*deliveryStartResult\?\.kind === 'delivery_active'[\s\S]*activeRoutePlanId === selectedRoute\.id[\s\S]*deliveryFinishResult\?\.flowState !== 'delivery_finished'/u);
    assert.match(appSource, /showUserLocation=\{routeStatus === 'active'\}/u);
    assert.match(appSource, /showUserLocation \|\| \(route\.routeGeometry !== null/u);
    assert.doesNotMatch(appSource, /View Live|Back to Routes|LiveTrackingScreen|liveMapPreview/u);
    assert.doesNotMatch(appSource, /liveLocationStatusOverlay|GPS active|Locating GPS|GPS unavailable/u);

    assert.doesNotMatch(nativeMapSource, /useCurrentPosition/u);
    assert.match(nativeMapSource, /import \* as Location from 'expo-location'/u);
    assert.match(nativeMapSource, /LIVE_LOCATION_UPDATE_INTERVAL_MS = 1_000/u);
    assert.match(nativeMapSource, /LIVE_LOCATION_DISTANCE_INTERVAL_METERS = 0/u);
    assert.match(nativeMapSource, /Location\.getLastKnownPositionAsync\(\{[\s\S]*maxAge: LIVE_LOCATION_MAX_AGE_MS,[\s\S]*requiredAccuracy: LIVE_LOCATION_CACHED_REQUIRED_ACCURACY_METERS/u);
    assert.match(nativeMapSource, /Date\.now\(\) - position\.timestamp > LIVE_LOCATION_MAX_AGE_MS/u);
    assert.match(nativeMapSource, /Location\.watchPositionAsync\(\{[\s\S]*accuracy: Location\.Accuracy\.Highest,[\s\S]*distanceInterval: LIVE_LOCATION_DISTANCE_INTERVAL_METERS,[\s\S]*timeInterval: LIVE_LOCATION_UPDATE_INTERVAL_MS/u);
    assert.doesNotMatch(nativeMapSource, /watchHeadingAsync|deviceHeading|'text-field': '▲'/u);
    assert.match(nativeMapSource, /id="route-preview-user-location"/u);
    assert.match(nativeMapSource, /'circle-blur': 0\.1/u);
    assert.match(nativeMapSource, /'circle-color': '#e32636'/u);
    assert.match(nativeMapSource, /'circle-radius': 9\.9/u);
    assert.match(nativeMapSource, /'circle-stroke-color': '#ffffff'/u);
    assert.match(nativeMapSource, /'circle-stroke-width': 2/u);
    assert.doesNotMatch(nativeMapSource, /route-preview-user-location-ring|route-preview-user-location-dot/u);
    assert.match(nativeMapSource, /id="route-preview-marker-label"/u);
    assert.match(nativeMapSource, /id="route-preview-snapped-stop"[\s\S]*minzoom=\{15\}/u);
    assert.match(nativeMapSource, /data=\{model\.snappedStopCollection\}/u);
    assert.doesNotMatch(nativeMapSource, /<Marker/u);
    assert.match(nativeMapSource, /const currentDestinationCoordinate/u);
    assert.match(nativeMapSource, /CURRENT_TRIP_CAMERA_PADDING = \{ bottom: 72, left: 52, right: 96, top: 72 \}/u);
    assert.match(nativeMapSource, /buildCurrentTripBounds\(userCoordinate, currentDestinationCoordinate\)/u);
    assert.match(nativeMapSource, /accessibilityLabel="Fit current location and next destination"/u);
    assert.match(nativeMapSource, /accessibilityLabel="Center on next destination"/u);
    assert.match(nativeMapSource, /accessibilityLabel="Center on current location"/u);
    assert.match(nativeMapSource, /center: userCoordinate, duration: 300, zoom: CURRENT_LOCATION_ZOOM/u);
    assert.doesNotMatch(nativeMapSource, /handleShowFullRoute/u);
    assert.doesNotMatch(nativeMapSource, /recordForegroundLocationUpdateAfterDeliveryStart|recordContinuousLocationUpdateBatch|recordDriverEvent/u);
  });

  it('defaults every route map refresh to the next destination and leaves trip fitting to the zoom control', () => {
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(nativeMapSource, /const DESTINATION_FOCUS_ZOOM = 13;/u);
    assert.doesNotMatch(nativeMapSource, /hasAdjustedForUserRef/u);
    assert.match(nativeMapSource, /if \(currentDestinationFocusCoordinate !== null\) \{[\s\S]*easeTo\(\{ center: currentDestinationFocusCoordinate, duration: 0, zoom: DESTINATION_FOCUS_ZOOM \}\)/u);
    assert.match(nativeMapSource, /initialViewState=\{currentDestinationCoordinate !== null[\s\S]*center: currentDestinationFocusCoordinate \?\? currentDestinationCoordinate[\s\S]*zoom: DESTINATION_FOCUS_ZOOM/u);
    assert.match(nativeMapSource, /function handleFitCurrentTrip\(\)[\s\S]*buildCurrentTripBounds\(userCoordinate, currentDestinationCoordinate\)/u);
    assert.match(nativeMapSource, /accessibilityLabel="Center on next destination"[\s\S]*accessibilityLabel="Fit current location and next destination"[\s\S]*accessibilityLabel="Center on current location"/u);
    assert.match(nativeMapSource, /function handleCenterNextDestination\(\)[\s\S]*focusNextDestination\(300\)/u);
  });
});


describe('current task density', () => {
  it('keeps Current Task buttons compact with normal-weight text and matching heights', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /compactButton:[\s\S]*minHeight: 42,[\s\S]*paddingVertical: 8,/u);
    assert.match(appSource, /compactButtonText:[\s\S]*fontSize: 14,[\s\S]*fontWeight: '600'/u);
    assert.match(appSource, /currentTaskAddressText:[\s\S]*fontSize: 14,[\s\S]*fontWeight: '400'/u);
  });
});

describe('stop completion proof copy', () => {
  it('uses driver-facing photo labels instead of proof jargon', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /title="Complete Delivery"/u);
    assert.match(appSource, />Delivery Photo \(Optional\)</u);
    assert.match(appSource, /label=\{photoUri === undefined \? 'Add Photo' : 'Change Photo'\}/u);
    assert.match(appSource, /source=\{\{ uri: photoUri \}\}/u);
    assert.match(appSource, /style=\{styles\.proofPhotoPreview\}/u);
    assert.match(appSource, /label="Delivery Result"/u);
    assert.match(appSource, /placeholder="e\.g\. Left at front door"/u);
    assert.match(appSource, /label="Location Tip"/u);
    assert.match(appSource, /placeholder="e\.g\. Side entrance, gate code, parking note"/u);
    assert.match(appSource, /label="Other Notes"/u);
    assert.match(appSource, /placeholder="Anything else for this stop"/u);
    assert.doesNotMatch(appSource, /Select an issue/u);
    assert.doesNotMatch(appSource, /Add or select a delivery tip/u);
    assert.match(appSource, /function DeliveryPhotoActionSheet/u);
    assert.match(appSource, /photoActionSheetCard/u);
    assert.match(appSource, /photoActionSheetAction:[\s\S]*borderColor: '#0b57d0'/u);
    assert.match(appSource, /photoActionSheetCancel:[\s\S]*borderColor: '#dc2626'/u);
    assert.match(appSource, /photoActionSheetCancelText:[\s\S]*color: '#dc2626'/u);
    assert.match(appSource, /photoActionSheetAction:[\s\S]*height: 44/u);
    assert.match(appSource, /photoActionSheetAction:[\s\S]*paddingVertical: 0/u);
    assert.match(appSource, /photoActionSheetActionText:[\s\S]*fontSize: 14/u);
    assert.match(appSource, /photoActionSheetActionText:[\s\S]*lineHeight: 18/u);
    assert.match(appSource, /photoActionSheetCancel:[\s\S]*height: 44/u);
    assert.match(appSource, /photoActionSheetCancel:[\s\S]*paddingVertical: 0/u);
    assert.match(appSource, /photoActionSheetCancelText:[\s\S]*fontSize: 14/u);
    assert.match(appSource, /photoActionSheetCancelText:[\s\S]*lineHeight: 18/u);
    assert.match(appSource, />Take Photo</u);
    assert.match(appSource, />Choose from Album</u);
    assert.doesNotMatch(appSource, /Alert\.alert\('Add Photo'/u);
    assert.doesNotMatch(appSource, /label="Take Photo"/u);
    assert.doesNotMatch(appSource, /label="Choose Photo"/u);
    assert.doesNotMatch(appSource, /setMessage\('Add a delivery photo first\.'\)/u);
    assert.doesNotMatch(appSource, /Photo Ready/u);
    assert.doesNotMatch(appSource, /No Photo Yet/u);
    assert.doesNotMatch(appSource, /Photo taken/u);
    assert.doesNotMatch(appSource, /Photo uploaded/u);
    assert.doesNotMatch(appSource, /Proof Item/u);
    assert.doesNotMatch(appSource, /Proof uploaded: \$\{result\.media\.mediaId\}/u);
  });

  it('wires expired driver token recovery through the shared driver API client filter', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /const buildDriverAccessRefresh = useCallback/u);
    assert.match(appSource, /const getActiveAccountAccess = useCallback/u);
    assert.match(appSource, /driverAuthService\.refreshSession/u);
    assert.match(appSource, /driverAccessTokenStore\.saveRefreshedAccountAccess\(refreshResult\.accountAccess\)/u);
    assert.match(appSource, /accountAccessToken: accountAccess\.accessToken/u);
    assert.match(appSource, /refreshDriverAccess: buildDriverAccessRefresh\(submission\)/u);
    assert.match(appSource, /refreshDriverAccess: buildDriverAccessRefresh\(choiceSubmission\)/u);
    assert.match(appSource, /setRouteSessions\(\(current\) => current\.map/u);
    assert.match(appSource, /\? refreshedSubmission/u);
    assert.doesNotMatch(appSource, /refreshDriverAuthSessionForProofUpload/u);
    assert.doesNotMatch(appSource, /uploadResult\.kind === 'upload_failed' && uploadResult\.reason === 'driver_access_expired'/u);
  });

  it('uses an in-app rear camera screen and makes proof media optional for completion', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const cameraSource = readFileSync(cameraCapturePath, 'utf8');

    assert.match(appSource, /import \{ CameraView, useCameraPermissions \} from 'expo-camera'/u);
    assert.match(appSource, /\| 'proofCamera'/u);
    assert.match(appSource, /if \(source === 'camera'\) \{[\s\S]*setScreen\('proofCamera'\)/u);
    assert.match(appSource, /<ProofCameraScreen/u);
    assert.match(appSource, /facing="back"/u);
    assert.match(appSource, /flash=\{flashMode\}/u);
    assert.match(appSource, /takePictureAsync\(\{ quality: 0\.7 \}\)/u);
    assert.match(appSource, /Please make sure the package and surrounding location are clearly visible\./u);
    assert.match(appSource, />Gallery</u);
    assert.match(appSource, />Flash</u);
    assert.match(appSource, /This photo will be used as proof of delivery\./u);
    assert.match(appSource, /proofCameraDimTop/u);
    assert.match(appSource, /proofCameraGuideCornerTopLeft/u);
    assert.match(appSource, /proofCameraCaptureInner/u);
    assert.match(appSource, /proofCameraInstructionCard:[^}]*left: 34,[^}]*right: 34/u);
    assert.match(appSource, /proofCameraGuide:[^}]*left: 34,[^}]*right: 34/u);
    assert.match(appSource, /proofCameraInstructionText:[^}]*textAlign: 'left'/u);
    assert.doesNotMatch(appSource, /proofCameraInstructionIcon/u);
    assert.doesNotMatch(appSource, /proofCameraSideButtonIcon/u);
    assert.doesNotMatch(appSource, /proofCameraFooterIcon/u);
    assert.doesNotMatch(appSource, /proofCameraGuide:[^}]*borderRadius/u);
    assert.match(cameraSource, /cameraType: ImagePicker\.CameraType\.back/u);
    assert.doesNotMatch(appSource, /mediaResult\?\.kind !== 'uploaded'/u);
    assert.doesNotMatch(appSource, /Photo is not uploaded yet\. Add the photo again\./u);
    assert.match(appSource, /media: mediaResult\?\.kind === 'uploaded' \? \[mediaResult\.media\] : \[\]/u);
    assert.match(appSource, /photoUris: photoResult\?\.kind === 'captured' \? \[photoResult\.uri\] : \[\]/u);
    assert.match(appSource, /queue\.enqueueProofMediaUpload\([\s\S]*?await queue\.whenPersisted\(\)/u);
    assert.match(appSource, /const queue = offlineSubmissionQueue \?\? await getExpoOfflineSubmissionQueue\(\)[\s\S]*?offlineQueue: queue/u);
  });

  it('returns directly to Route Session after completing a non-final stop', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /const activeRouteSaved = await driverAccessTokenStore\.saveActiveRouteSession\(\{[\s\S]*navigationStepIndex: nextNavigationStepIndex,[\s\S]*routePlanId: selectedRoute\.id,[\s\S]*\}\);[\s\S]*if \(!activeRouteSaved\)[\s\S]*setNavigationStepIndex\(nextNavigationStepIndex\);[\s\S]*setScreen\('routeSession'\);/u);
    assert.doesNotMatch(appSource, /stopCompleted|StopCompletedScreen|Stop Completed|Find Next Stop when ready/u);
  });
});
