import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');
const cameraCapturePath = join(dirname(fileURLToPath(import.meta.url)), '../platform/expo/camera/expoProofPhotoCaptureService.ts');
const nativeMapPath = join(dirname(fileURLToPath(import.meta.url)), 'NativeRouteMapPreview.tsx');

function getRouteSessionComponentSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function RouteSessionScreen(');
  const end = source.indexOf('function LiveTrackingScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('route session current task behavior', () => {
  it('restores server in-progress routes instead of presenting them as Ready', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /companyGuidance\.executionStatus === 'IN_PROGRESS'/u);
    assert.match(appSource, /getAssignedRouteServerProgress/u);
    assert.match(appSource, /setCompletedStopIds\(\(current\) => \[/u);
    assert.match(appSource, /markActiveRouteStarted/u);
  });

  it('keeps Arrive and Navigate as equal-width Current Task actions', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /<View style=\{styles\.routeActionRow\}>[\s\S]*<PrimaryButton compact label="Arrive" onPress=\{onArrived\} \/>[\s\S]*<SecondaryButton compact label="Navigate" onPress=\{onOpenNavigation\} \/>[\s\S]*<\/View>/u);
    assert.match(componentSource, /styles\.routeActionButton/u);
    assert.match(componentSource, /styles\.currentTaskAddressText/u);
    assert.match(appSource, /routeActionRow:[\s\S]*flexDirection: 'row'/u);
    assert.match(appSource, /routeActionButton:[\s\S]*flex: 1/u);
    assert.doesNotMatch(componentSource, /Complete Pickup|Mark as Arrived|View Stop Details|currentTaskActions/u);
    assert.doesNotMatch(componentSource, /onViewCurrentStop/u);
  });

  it('bolds only the current Route Sequence item title', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /style=\{\[styles\.timelineTitle, state === 'current' && styles\.timelineTitleCurrent\]\}/u);
    assert.match(appSource, /timelineTitle:[\s\S]*fontWeight: '400'/u);
    assert.match(appSource, /timelineTitleCurrent:[\s\S]*fontWeight: '700'/u);
  });

  it('shows only basic stop addresses in Route Sequence stop rows', () => {
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /title=\{formatStopStreetAddress\(stop\)\}/u);
    assert.doesNotMatch(componentSource, /formatRouteSequenceStopSubtitle/u);
    assert.doesNotMatch(componentSource, /subtitle=\{formatRouteSequenceStopSubtitle\(stop\)\}/u);
  });

  it('keeps the route session summary compact with the route title and date on one line', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /<View style=\{\[styles\.summaryCard, styles\.routeSessionSummaryCard\]\}>/u);
    assert.match(componentSource, /<Text numberOfLines=\{1\} style=\{styles\.cardTitle\}>[\s\S]*\{route\.name\}[\s\S]*<Text style=\{styles\.routeSessionSummaryDate\}> - \{route\.deliveryDate\}<\/Text>[\s\S]*<\/Text>/u);
    assert.match(componentSource, /<View style=\{\[styles\.summaryGrid, styles\.routeSessionSummaryGrid\]\}>/u);
    assert.doesNotMatch(componentSource, /<DataRow label="Date"/u);
    assert.doesNotMatch(componentSource, /company\?\.companyDisplayName \?\? route\.name/u);
    assert.doesNotMatch(componentSource, /route\.shopDomain/u);
    assert.match(appSource, /routeSessionSummaryCard:[\s\S]*gap: 6,[\s\S]*paddingHorizontal: 14,[\s\S]*paddingVertical: 10,/u);
    assert.match(appSource, /routeSessionSummaryGrid:[\s\S]*borderTopWidth: 0,[\s\S]*paddingTop: 0,/u);
  });

  it('passes current step context into map previews for current destination highlighting', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(appSource, /currentStepIndex=\{currentStepIndex\}/u);
    assert.match(nativeMapSource, /currentStopSequence/u);
    assert.match(nativeMapSource, /currentMarkerHalo/u);
    assert.doesNotMatch(nativeMapSource, /Current: Stop/u);
  });

  it('uses numbered marker overlays while keeping the route line server-geometry-only', () => {
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(nativeMapSource, /<Marker/u);
    assert.match(nativeMapSource, /<Text style=\{styles\.markerText\}>/u);
    assert.match(nativeMapSource, /model\.routeFeature !== null/u);
    assert.doesNotMatch(nativeMapSource, /route-preview-stop-label/u);
  });

  it('mutes completed markers and the route segment to the current stop', () => {
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(nativeMapSource, /buildRouteProgressFeature\(model, currentStopSequence\)/u);
    assert.match(nativeMapSource, /id="route-preview-progress-line"/u);
    assert.match(nativeMapSource, /'line-color': '#f97316'/u);
    assert.match(nativeMapSource, /currentStepIndex > 0 && styles\.completedMarkerDot/u);
    assert.match(nativeMapSource, /isCompletedStop && styles\.completedMarkerDot/u);
  });

  it('keeps map preview copy visually light without disabling the map gestures', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.doesNotMatch(appSource, /allowMapDragPan/u);
    assert.match(nativeMapSource, /attribution=\{false\}/u);
    assert.match(nativeMapSource, /compass=\{false\}/u);
    assert.match(nativeMapSource, /scaleBar=\{false\}/u);
    assert.match(nativeMapSource, /\sdragPan\s/u);
    assert.match(nativeMapSource, /\stouchZoom\s/u);
    assert.match(nativeMapSource, /\sdoubleTapZoom\s/u);
    assert.match(nativeMapSource, /markerDot:[\s\S]*height: 12,[\s\S]*width: 12/u);
    assert.match(nativeMapSource, /markerHalo:[\s\S]*height: 14,[\s\S]*width: 14/u);
    assert.match(appSource, /Tap for full map/u);
    assert.match(appSource, /routePreviewHeader/u);
    assert.doesNotMatch(appSource, /Tap the preview for a larger map/u);
    assert.doesNotMatch(appSource, /full interactive map/u);
    assert.doesNotMatch(nativeMapSource, /Interactive map/u);
    assert.doesNotMatch(nativeMapSource, /Pinch to zoom/u);
    assert.doesNotMatch(nativeMapSource, /Drag to pan/u);
    assert.doesNotMatch(nativeMapSource, /androidView="texture"/u);
  });

  it('opens the large map as a full-screen surface instead of a card', () => {
    const appSource = readFileSync(appRootPath, 'utf8');

    assert.match(appSource, /const isFullMapScreen = screen === 'liveMapPreview' && selectedRoute !== null/u);
    assert.match(appSource, /style=\{styles\.fullScreenMap\}/u);
    assert.match(appSource, /paddingTop: 34/u);
    assert.match(appSource, /fullMapCanvas:[\s\S]*height: '100%'/u);
    assert.doesNotMatch(appSource, /mapHeight/u);
    assert.doesNotMatch(appSource, /contentContainerStyle=\{\[styles\.container/u);
    assert.doesNotMatch(appSource, /liveMapPreviewCard/u);
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
    assert.match(appSource, />Delivery Photo</u);
    assert.match(appSource, /label="Add Photo"/u);
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
    assert.match(appSource, /setMessage\('Add a delivery photo first\.'\)/u);
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

  it('uses an in-app rear camera screen and requires uploaded proof media before completion', () => {
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
    assert.match(appSource, /mediaResult\?\.kind !== 'uploaded'/u);
    assert.match(appSource, /Photo is not uploaded yet\. Add the photo again\./u);
    assert.match(appSource, /media: \[mediaResult\.media\]/u);
    assert.doesNotMatch(appSource, /mediaResult\?\.kind === 'uploaded' \? \[mediaResult\.media\] : \[\]/u);
  });
});
