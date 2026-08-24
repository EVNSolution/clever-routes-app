import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Speech from 'expo-speech';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import {
  OperationalDialog,
  type OperationalDialogButton,
  type OperationalDialogState,
} from './OperationalDialog';

import {
  createMockAssignedRouteService,
  formatAssignedRouteDistance,
  formatAssignedRouteDuration,
  formatAssignedRouteEta,
  formatAssignedRoutePickupTiming,
  formatAssignedRouteCompactPaymentAmount,
  formatAssignedRoutePaymentSummary,
  isAssignedRoutePickupStop,
  loadAssignedRouteAfterConsent,
  resolveRouteMapPreviewState,
  sampleAssignedRoute,
  type AssignedRoute,
  type AssignedRouteService,
  type AssignedRouteStop,
} from '../domain/route/assignedRoute';
import {
  classifyAssignedRouteSession,
  type RouteSessionStatus,
} from '../domain/route/routeSessionClassification';
import {
  buildOutOfOrderStopArrivalWarning,
  getAssignedRouteProgressAfterPickup,
  getAssignedRouteServerProgress,
  getCurrentRouteStop,
  getNextIncompleteRouteStepIndex,
  getStopDetailsProgressState,
  isStopCompleted,
  ROUTE_COMPANY_STEP_INDEX,
} from '../domain/route/routeStepProgress';
import {
  clearAndStopContinuousLocationSession,
  CONTINUOUS_LOCATION_TASK_NAME,
  requestContinuousLocationBackgroundPermission,
  startContinuousLocationUpdatesAfterDeliveryStart,
  type BackgroundPermissionResult,
  type ContinuousLocationStopResult,
  type ContinuousLocationStreamStartResult,
} from '../domain/location/continuousLocationStream';
import { finishDeliveryAfterActive, type DeliveryFinishResult } from '../domain/delivery/deliveryFinish';
import { startDeliveryWithForegroundPermission, type DeliveryStartResult } from '../domain/delivery/deliveryStart';
import { createDriverApiClientsFromRouteAccess } from '../api/deliveryServer/driverApiClients';
import { createDriverAppReleaseApiClient } from '../api/deliveryServer/driverAppReleaseApi';
import {
  isDriverAccountDeletionActiveRouteError,
  isDriverApiUnauthorizedError,
} from '../api/deliveryServer/driverApiError';
import {
  applyDriverRouteEtaUpdate,
  createMockDriverEventService,
  recordPickupCompletedAfterDeliveryStart,
  recordRouteStartedAfterDeliveryStart,
  recordStopArrivedAfterDeliveryStart,
  type DriverEventService,
  type DriverRouteEtaUpdate,
  type RouteStartedRecordResult,
  type StopArrivalEvidence,
  type StopArrivedRecordResult,
} from '../domain/events/driverEvents';
import { createExpoContinuousLocationStreamService, registerContinuousLocationTaskObserver } from '../platform/expo/location/expoContinuousLocationStreamService';
import { createExpoForegroundLocationSnapshotService } from '../platform/expo/location/expoForegroundLocationSnapshotService';
import { createExpoForegroundLocationPermissionService } from '../platform/expo/location/expoLocationPermissionService';
import { getExpoOfflineSubmissionQueue } from '../platform/expo/storage/expoOfflineSubmissionQueueStorage';
import { createExpoProofPhotoCaptureService } from '../platform/expo/camera/expoProofPhotoCaptureService';
import { createExpoSecureDriverAccessTokenStore } from '../platform/expo/secureStore/expoSecureDriverAccessTokenStore';
import { readInstalledDriverAppVersion } from '../platform/expo/application/expoAppVersionService';
import {
  createRouteOrderedDriverEventService,
  getOfflineSubmissionQueueSummary,
  getPendingRouteEnd,
  retryOfflineSubmissions,
  type OfflineSubmissionQueue,
  type PendingRouteEnd,
} from '../domain/offline/offlineSubmissionQueue';
import {
  getNetworkReachability,
  shouldRetryOfflineSubmissionsAfterNetworkChange,
} from '../domain/offline/offlineRetryTrigger';
import { createOfflineRetryScheduler } from '../domain/offline/offlineRetryScheduler';
import { captureProofPhoto, type ProofPhotoCaptureResult, type ProofPhotoCaptureSource } from '../domain/proof/proofPhotoCapture';
import {
  createMockProofMediaUploadService,
  shouldQueueFailedProofMediaUpload,
  uploadCapturedProofPhoto,
  type ProofMediaUploadResult,
  type ProofMediaUploadService,
} from '../domain/proof/proofMediaUpload';
import { createDriverRuntimeServices, readDriverRuntimeConfig } from './config/driverRuntimeConfig';
import { createMockDriverConsentService, submitDriverConsent, type DriverConsentService, type DriverConsentSubmissionResult } from '../domain/consent/driverConsent';
import { resetDriverSession } from '../domain/driver/driverSessionReset';
import type { PersistedActiveRouteSession } from '../domain/driver/driverAccessTokenStore';
import type { DriverAccountAccessToken } from '../domain/driverAuth/driverAuth';
import {
  DEFAULT_DRIVER_PHONE_COUNTRY,
  findDriverPhoneCountry,
  formatDriverNationalPhoneInput,
  normalizeDriverPhoneEntry,
  searchDriverPhoneCountries,
  type DriverPhoneCountry,
} from '../domain/phone/phoneEntry';
import {
  createMockRouteAccessService,
  sampleInvitedRouteAccess,
  submitRouteAccess,
  type DriverAccessToken,
  type RouteAccessCompanyGuidance,
  type RouteAccessLookupResult,
  type RouteAccessRouteChoice,
  type RouteAccessSubmissionResult,
} from '../domain/routeAccess/routeAccess';
import {
  recordStopProofEventAfterDeliveryStart,
  type StopProofEventResult,
  type StopProofFailureReason,
} from '../domain/stop/stopProofEvents';
import { openRouteNavigation, openStopNavigation } from '../domain/stop/stopNavigation';
import {
  getCountrySelectorRowText,
  getSelectedCountryCardText,
} from '../ui/components/countrySelectorBehavior';
import {
  getConsentCheckboxVisualState,
} from '../ui/components/authFormUxBehavior';
import { DriverUpdateScreen } from '../ui/components/DriverUpdateScreen';
import { FixedScreenHeader } from '../ui/components/FixedScreenHeader';
import { TransientToast } from '../ui/components/TransientToast';
import { scheduleTransientToastDismiss } from '../ui/components/transientToastBehavior';
import {
  classifyDriverAppUpdate,
  shouldPresentDriverAppUpdate,
  type DriverAppUpdateState,
} from '../domain/appUpdate/driverAppUpdate';
import { buildAuthFailureMessage, shouldDiscardSavedLoginAfterRefreshFailure } from './authDiagnostics';
import {
  buildActiveRouteForegroundNotification,
  isActiveRouteNotificationTargetCurrent,
  parseActiveRouteNotificationUrl,
  type ActiveRouteNotificationTarget,
} from './activeRouteNotification';
import { NativeRouteMapPreview } from './NativeRouteMapPreview';
import { getBottomChromeOffset, getBottomChromePadding } from './appLayoutMetrics';
import { formatRouteListUpdatedAt } from './routeListBehavior';
import { readDriverMapStyleUrl } from './routeMapGeoJson';
import { ROUTE_VISUAL_STATE_COLORS, ROUTE_VISUAL_STATE_SURFACES } from './routeVisualState';
import { splitStopItemName } from './stopItemDisplay';
import { buildRouteInventory } from './routeInventory';
import {
  getDriverRouteNotificationNavigation,
  getStopArrivalNotificationCandidate,
  getStopArrivalProximityEvidence,
  STOP_ARRIVAL_NOTIFICATION_TYPE,
  type DriverRouteNotificationData,
  type StopArrivalNotificationData,
  type StopArrivalNotificationAction,
  type StopArrivalProximityEvidence,
  type StopArrivalNotificationResponse,
} from '../domain/notifications/stopArrivalNotifications';
import { createExpoStopArrivalNotificationService } from '../platform/expo/notifications/expoStopArrivalNotificationService';
import { requestRouteStartSessionConfirmation } from './routeStartConfirmation';
import { requestActiveRouteSwitchConfirmation } from './activeRouteSwitchConfirmation';
import { requestRouteReconciliationClearConfirmation } from './routeReconciliationClearConfirmation';
import {
  createDriverReleasedRoutePayload,
  requestActiveRouteDeletionConfirmation,
} from '../domain/route/routeDeletion';

type AppScreen =
  | 'accountName'
  | 'arrivalCheck'
  | 'completedDeliveries'
  | 'countrySelect'
  | 'loginPhone'
  | 'loginDetail'
  | 'mainTabs'
  | 'proofCamera'
  | 'routeSession'
  | 'settings'
  | 'stopDetails';
type RouteStatus = RouteSessionStatus;
type RouteSyncState = 'error' | 'idle' | 'loading' | 'ready';
type RouteRecoveryRefreshReason = 'driver_access_expired' | 'pickup_eta_snapshot_synced' | 'route_not_in_progress';
type BackgroundLocationPermissionState = BackgroundPermissionResult | 'checking';
type CompletedDeliveriesFilter = 'all' | 'delivered' | 'issues';
type RouteSessionContentTab = 'inventory' | 'stops';
type StopDetailsReturnScreen = 'completedDeliveries' | 'routeSession';
type ArrivalCheckReturnScreen = 'mainTabs' | 'routeSession' | 'stopDetails';
type PendingDriverRouteNotification = {
  data: DriverRouteNotificationData;
  openRequested: boolean;
  refreshRequired: boolean;
};

type StopProofDraft = {
  additionalNotes: string;
  locationTip: string;
  todayNote: string;
};

type RouteSession = RouteAccessRouteChoice & {
  pendingRouteEnd?: PendingRouteEnd;
  route: AssignedRoute;
};

type RouteLoadOptions = {
  allowVerifiedDriverNoRoute?: boolean;
  activeRouteSession?: PersistedActiveRouteSession | null;
  navigateOnSuccess?: boolean;
  resetProgress?: boolean;
};

const COMPANY_STEP_INDEX = ROUTE_COMPANY_STEP_INDEX;
const DRIVER_CONSENT_DOCUMENT_URL = 'https://clever-route-api.cleversystem.ai/privacy';
const ROUTES_APP_UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DRIVER_RESTORE_LOADING_TIMEOUT_MS = 8_000;
const PULL_REFRESH_DRAG_RESISTANCE = 0.72;
const PULL_REFRESH_MAX_DISTANCE = 120;
const PULL_REFRESH_REVEAL_HEIGHT = 96;
const PULL_REFRESH_TRIGGER_DISTANCE = 80;
const PULL_REFRESH_SPRING_CONFIG = {
  damping: 18,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
  stiffness: 180,
} as const;

function runAfterUiInteractions(callback: () => void): void {
  requestIdleCallback(callback);
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <DriverApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function DriverApp() {
  const { top: topInset } = useSafeAreaInsets();
  const [screen, setScreenState] = useState<AppScreen>('loginPhone');
  const screenRef = useRef<AppScreen>('loginPhone');
  const setScreen = useCallback((nextScreen: AppScreen) => {
    screenRef.current = nextScreen;
    setScreenState(nextScreen);
  }, []);
  const [selectedPhoneCountryIso2, setSelectedPhoneCountryIso2] = useState(DEFAULT_DRIVER_PHONE_COUNTRY.iso2);
  const [selectedDriverLocale, setSelectedDriverLocale] = useState(DEFAULT_DRIVER_PHONE_COUNTRY.defaultLocale);
  const [nationalPhoneInput, setNationalPhoneInput] = useState('');
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [isRegistration, setIsRegistration] = useState(false);
  const [verifiedDriverPhoneE164, setVerifiedDriverPhoneE164] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountNameDraft, setAccountNameDraft] = useState('');
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedLocation, setAcceptedLocation] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = useState(COMPANY_STEP_INDEX);
  const [selectedStopDetailsId, setSelectedStopDetailsId] = useState<string | null>(null);
  const [stopDetailsReturnScreen, setStopDetailsReturnScreen] = useState<StopDetailsReturnScreen>('routeSession');
  const [arrivalCheckReturnScreen, setArrivalCheckReturnScreen] = useState<ArrivalCheckReturnScreen>('routeSession');
  const [routeSessions, setRouteSessions] = useState<RouteSession[]>([]);
  const [routeSyncState, setRouteSyncState] = useState<RouteSyncState>('idle');
  const [backgroundLocationPermission, setBackgroundLocationPermission] = useState<BackgroundLocationPermissionState>('checking');
  const [isDriverRestoreComplete, setIsDriverRestoreComplete] = useState(false);
  const [isInitialRouteRestoreComplete, setIsInitialRouteRestoreComplete] = useState(false);
  const [driverRestoreProblem, setDriverRestoreProblem] = useState<string | null>(null);
  const [driverRestoreAttempt, setDriverRestoreAttempt] = useState(0);
  const [driverAppUpdateState, setDriverAppUpdateState] = useState<DriverAppUpdateState>({ kind: 'checking' });
  const [dismissedDriverAppVersionCode, setDismissedDriverAppVersionCode] = useState<number | null>(null);
  const [explicitDriverAppUpdatePrompt, setExplicitDriverAppUpdatePrompt] = useState(false);
  const [pendingActiveRouteNotificationTarget, setPendingActiveRouteNotificationTarget] = useState<ActiveRouteNotificationTarget | null>(null);
  const pendingActiveRouteNotificationTargetRef = useRef<ActiveRouteNotificationTarget | null>(null);
  const [pendingStopArrivalNotification, setPendingStopArrivalNotification] = useState<StopArrivalNotificationResponse | null>(null);
  const [pendingStopArrivalCompletion, setPendingStopArrivalCompletion] = useState<StopArrivalNotificationData | null>(null);
  const [stopArrivalProximityByStopId, setStopArrivalProximityByStopId] = useState<Record<string, StopArrivalProximityEvidence | null>>({});
  const [pendingDriverRouteNotification, setPendingDriverRouteNotification] = useState<PendingDriverRouteNotification | null>(null);

  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [, setConsentSubmission] = useState<DriverConsentSubmissionResult | null>(null);
  const [deliveryStartResult, setDeliveryStartResult] = useState<DeliveryStartResult | null>(null);
  const [deliveryFinishResult, setDeliveryFinishResult] = useState<DeliveryFinishResult | null>(null);
  const [activeRoutePlanId, setActiveRoutePlanId] = useState<string | null>(null);
  const [pendingRoutePlanId, setPendingRoutePlanId] = useState<string | null>(null);
  const [operationalDialog, setOperationalDialog] = useState<OperationalDialogState | null>(null);
  const [routeStartedEventResult, setRouteStartedEventResult] = useState<RouteStartedRecordResult | null>(null);
  const [, setContinuousLocationResult] = useState<ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null>(null);
  const [stopProofResults, setStopProofResults] = useState<Record<string, StopProofEventResult>>({});
  const [proofDrafts, setProofDrafts] = useState<Record<string, StopProofDraft>>({});
  const [proofPhotoResults, setProofPhotoResults] = useState<Record<string, ProofPhotoCaptureResult>>({});
  const [proofMediaResults, setProofMediaResults] = useState<Record<string, ProofMediaUploadResult>>({});
  const [completedStopIds, setCompletedStopIds] = useState<string[]>([]);
  const [, setServerConfirmedStopIds] = useState<string[]>([]);
  const [completedStopTimes, setCompletedStopTimes] = useState<Record<string, string>>({});
  const [offlineSubmissionQueue, setOfflineSubmissionQueue] = useState<OfflineSubmissionQueue | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [routeReconciliationCount, setRouteReconciliationCount] = useState(0);
  const [routeRecoveryRefreshReason, setRouteRecoveryRefreshReason] = useState<RouteRecoveryRefreshReason | null>(null);
  const [lastRoutesUpdatedAt, setLastRoutesUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const showOperationalDialog = useCallback((
    title: string,
    message: string,
    buttons: OperationalDialogButton[],
    options?: { cancelable?: boolean },
  ): void => {
    setOperationalDialog({
      buttons,
      cancelable: options?.cancelable ?? true,
      message,
      title,
    });
  }, []);
  const dismissOperationalDialog = useCallback((): void => {
    setOperationalDialog(null);
  }, []);
  const handleOperationalDialogAction = useCallback((button: OperationalDialogButton): void => {
    setOperationalDialog(null);
    button.onPress?.();
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingAccountProfile, setIsLoadingAccountProfile] = useState(false);
  const [isRequestingAccountDeletion, setIsRequestingAccountDeletion] = useState(false);
  const [isSavingAccountName, setIsSavingAccountName] = useState(false);
  const [isRefreshingRoutes, setIsRefreshingRoutes] = useState(false);
  const [isRequestingBackgroundLocation, setIsRequestingBackgroundLocation] = useState(false);
  const [isStartingRoute, setIsStartingRoute] = useState(false);
  const [isRecordingArrival, setIsRecordingArrival] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isPhotoActionSheetVisible, setIsPhotoActionSheetVisible] = useState(false);
  const [isCompletingStop, setIsCompletingStop] = useState(false);
  const [isDeletingRoute, setIsDeletingRoute] = useState(false);
  const [isFinishingRoute, setIsFinishingRoute] = useState(false);
  const isNavigationInterruptionProtected = screen === 'arrivalCheck'
    || screen === 'proofCamera'
    || isPhotoActionSheetVisible
    || isCapturingPhoto
    || isCompletingStop
    || isRecordingArrival
    || isStartingRoute
    || isFinishingRoute;
  const selectedRouteIdRef = useRef<string | null>(null);
  const routesAtTopRef = useRef(true);
  const [areRoutesAtTop, setAreRoutesAtTop] = useState(true);
  const isPullRefreshingRef = useRef(false);
  const pullRefreshOffset = useSharedValue(0);
  const notifiedStopArrivalIdsRef = useRef<Set<string>>(new Set());
  const isRecordingArrivalRef = useRef(false);
  const completeStopFromNotificationRef = useRef<(data: StopArrivalNotificationData) => Promise<void>>(async () => undefined);
  const hasCheckedInitialDriverRouteNotificationRef = useRef(false);
  const networkState = Network.useNetworkState();
  const networkReachability = getNetworkReachability(networkState);
  const previousDriverRestoreNetworkRef = useRef(networkReachability);
  const previousRouteSyncNetworkRef = useRef(networkReachability);
  const isRetryingOfflineSubmissionsRef = useRef(false);
  const previousNetworkReachabilityRef = useRef(networkReachability);
  const driverAppUpdateCheckRunningRef = useRef(false);
  const explicitDriverAppUpdatePromptRequestedRef = useRef(false);
  const lastDriverAppUpdateCheckAtRef = useRef<number | null>(null);
  const previousActiveRoutePlanIdRef = useRef<string | null>(null);
  const registeredDevicePushTokenRef = useRef<string | null>(null);
  const isPushRegistrationRunningRef = useRef(false);

  const syncOfflineQueueState = useCallback((queue: OfflineSubmissionQueue | null) => {
    if (queue === null) {
      setOfflineQueueCount(0);
      setRouteReconciliationCount(0);
      return;
    }
    const summary = getOfflineSubmissionQueueSummary(queue);
    setOfflineQueueCount(summary.retryableCount);
    setRouteReconciliationCount(summary.blockedCount);
  }, []);

  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);

  const driverAccessTokenStore = useMemo(() => createExpoSecureDriverAccessTokenStore(), []);
  const foregroundLocationPermissionService = useMemo(() => createExpoForegroundLocationPermissionService(), []);
  const foregroundLocationSnapshotService = useMemo(() => createExpoForegroundLocationSnapshotService(), []);
  const continuousLocationStreamService = useMemo(() => createExpoContinuousLocationStreamService(), []);
  const stopArrivalNotificationService = useMemo(() => createExpoStopArrivalNotificationService(), []);
  const proofPhotoCaptureService = useMemo(() => createExpoProofPhotoCaptureService(), []);
  const mockDriverEventService = useMemo(() => createMockDriverEventService(), []);
  const mockDriverConsentService = useMemo(() => createMockDriverConsentService(), []);
  const mockAssignedRouteService = useMemo(() => createMockAssignedRouteService({ status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute }), []);
  const mockProofMediaUploadService = useMemo(() => createMockProofMediaUploadService({ mode: 'success' }), []);
  const refreshBackgroundLocationPermission = useCallback(async (): Promise<BackgroundPermissionResult> => {
    const permission = await continuousLocationStreamService.getBackgroundPermission();
    setBackgroundLocationPermission(permission);
    return permission;
  }, [continuousLocationStreamService]);

  const requestBackgroundLocationPermissionAfterDisclosure = useCallback(async (): Promise<void> => {
    if (isRequestingBackgroundLocation) {
      return;
    }

    setIsRequestingBackgroundLocation(true);
    setMessage(null);
    try {
      const foregroundPermission = await foregroundLocationPermissionService.requestForegroundPermission();
      if (foregroundPermission.status !== 'granted') {
        setBackgroundLocationPermission('denied');
        await Linking.openSettings();
        return;
      }

      const result = await requestContinuousLocationBackgroundPermission({
        streamService: continuousLocationStreamService,
      });
      await refreshBackgroundLocationPermission();
      if (result.kind === 'blocked') {
        setMessage(result.message);
      }
    } finally {
      setIsRequestingBackgroundLocation(false);
    }
  }, [
    continuousLocationStreamService,
    foregroundLocationPermissionService,
    isRequestingBackgroundLocation,
    refreshBackgroundLocationPermission,
  ]);

  const handleOpenBackgroundLocationSettings = useCallback((): void => {
    if (isRequestingBackgroundLocation) {
      return;
    }

    showOperationalDialog(
      'Allow background location',
      'CLEVER Routes collects your precise location while a delivery route is in progress, even when the app is closed or not in use. This keeps the store’s live route progress and arrival records up to date. Location tracking stops when the route ends.',
      [
        { style: 'cancel', text: 'Not Now' },
        {
          onPress: requestBackgroundLocationPermissionAfterDisclosure,
          text: 'Continue',
        },
      ],
      { cancelable: true },
    );
  }, [isRequestingBackgroundLocation, requestBackgroundLocationPermissionAfterDisclosure, showOperationalDialog]);

  const clearAndStopActiveLocationSession = useCallback(async (routePlanId?: string): Promise<void> => {
    try {
      const result = await clearAndStopContinuousLocationSession({
        activeRouteSessionStore: driverAccessTokenStore,
        ...(routePlanId === undefined ? {} : { routePlanId }),
        streamService: continuousLocationStreamService,
      });
      if (result.kind === 'stopped') {
        setActiveRoutePlanId(null);
      }
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      console.warn(`[location] Active tracking cleanup failed: ${errorMessage}`);
    }
  }, [continuousLocationStreamService, driverAccessTokenStore]);
  const selectedPhoneCountry = findDriverPhoneCountry(selectedPhoneCountryIso2) ?? DEFAULT_DRIVER_PHONE_COUNTRY;
  const visiblePhoneCountries = useMemo(
    () => searchDriverPhoneCountries(countrySearchQuery),
    [countrySearchQuery],
  );
  const normalizedPhoneEntry = normalizeDriverPhoneEntry({
    countryIso2: selectedPhoneCountry.iso2,
    nationalPhoneInput,
  });
  const phoneE164Preview = normalizedPhoneEntry.ok ? normalizedPhoneEntry.phoneE164 : null;

  const runtimeConfig = useMemo(
    () => readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL,
      EXPO_PUBLIC_DRIVER_RUNTIME_MODE: process.env.EXPO_PUBLIC_DRIVER_RUNTIME_MODE,
    }),
    [],
  );
  const driverMapStyleUrl = useMemo(() => readDriverMapStyleUrl(process.env.EXPO_PUBLIC_DRIVER_MAP_STYLE_URL), []);

  const runtimeServices = useMemo(() => createDriverRuntimeServices({ config: runtimeConfig }), [runtimeConfig]);
  const installedDriverAppVersion = useMemo(() => readInstalledDriverAppVersion(), []);
  const driverAppReleaseService = useMemo(() => (
    runtimeConfig.mode === 'live' && Platform.OS === 'android'
      ? createDriverAppReleaseApiClient({ baseUrl: runtimeConfig.deliveryServerBaseUrl })
      : null
  ), [runtimeConfig]);
  const checkForDriverAppUpdate = useCallback(async (
    force = false,
    explicitRefreshRequested = false,
  ): Promise<void> => {
    if (explicitRefreshRequested) {
      explicitDriverAppUpdatePromptRequestedRef.current = true;
    }
    if (driverAppUpdateCheckRunningRef.current) {
      return;
    }

    const lastCheckedAt = lastDriverAppUpdateCheckAtRef.current;
    if (
      !force
      && lastCheckedAt !== null
      && Date.now() - lastCheckedAt < ROUTES_APP_UPDATE_RECHECK_INTERVAL_MS
    ) {
      return;
    }
    if (driverAppReleaseService === null || installedDriverAppVersion === null) {
      setDriverAppUpdateState({ kind: 'unavailable' });
      setExplicitDriverAppUpdatePrompt(false);
      explicitDriverAppUpdatePromptRequestedRef.current = false;
      return;
    }

    driverAppUpdateCheckRunningRef.current = true;
    try {
      const release = await driverAppReleaseService.getAndroidRelease();
      const nextState = classifyDriverAppUpdate({
        currentPackageId: installedDriverAppVersion.packageId,
        currentVersionCode: installedDriverAppVersion.versionCode,
        release,
      });
      setDriverAppUpdateState(nextState);
      setExplicitDriverAppUpdatePrompt(
        explicitDriverAppUpdatePromptRequestedRef.current
        && (
          nextState.kind === 'optional_update'
          || nextState.kind === 'required_update'
          || nextState.kind === 'required_reinstall'
        ),
      );
      explicitDriverAppUpdatePromptRequestedRef.current = false;
      lastDriverAppUpdateCheckAtRef.current = Date.now();
    } catch {
      setDriverAppUpdateState({ kind: 'unavailable' });
      setExplicitDriverAppUpdatePrompt(false);
      explicitDriverAppUpdatePromptRequestedRef.current = false;
    } finally {
      driverAppUpdateCheckRunningRef.current = false;
    }
  }, [driverAppReleaseService, installedDriverAppVersion]);
  const routeAccessService = useMemo(() => (
    runtimeConfig.mode === 'live'
      ? runtimeServices.routeAccessService
      : createMockRouteAccessService(sampleInvitedRouteAccess)
  ), [runtimeConfig.mode, runtimeServices.routeAccessService]);
  const driverAuthService = runtimeServices.driverAuthService;

  const getActiveAccountAccess = useCallback(async (): Promise<DriverAccountAccessToken | null> => {
    const restoredAccess = await driverAccessTokenStore.loadActiveDriverAccess();
    if (restoredAccess.kind === 'active') {
      return restoredAccess.accountAccess;
    }
    if (restoredAccess.kind !== 'refresh_required') {
      return null;
    }

    const refreshResult = await driverAuthService.refreshSession({
      refreshToken: restoredAccess.accountAccess.refreshToken,
    });
    await driverAccessTokenStore.saveRefreshedAccountAccess(refreshResult.accountAccess);
    return refreshResult.accountAccess;
  }, [driverAccessTokenStore, driverAuthService]);

  const submitAccountRouteAccess = useCallback(async (
    accountAccess: DriverAccountAccessToken,
  ): Promise<RouteAccessSubmissionResult> => {
    try {
      return await submitRouteAccess({
        accountAccessToken: accountAccess.accessToken,
      }, routeAccessService);
    } catch (error) {
      if (!isDriverApiUnauthorizedError(error)) {
        throw error;
      }

      const refreshed = await driverAuthService.refreshSession({
        refreshToken: accountAccess.refreshToken,
      });
      await driverAccessTokenStore.saveRefreshedAccountAccess(refreshed.accountAccess);
      return submitRouteAccess({
        accountAccessToken: refreshed.accountAccess.accessToken,
      }, routeAccessService);
    }
  }, [driverAccessTokenStore, driverAuthService, routeAccessService]);

  const registerCurrentPushInstallation = useCallback(async (): Promise<void> => {
    if (
      runtimeConfig.mode !== 'live'
      || installedDriverAppVersion === null
      || isPushRegistrationRunningRef.current
    ) {
      return;
    }

    isPushRegistrationRunningRef.current = true;
    try {
      const registration = await stopArrivalNotificationService.registerForStopArrivalNotifications();
      if (registration.kind !== 'registered' || registration.devicePushToken === null) {
        return;
      }
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        return;
      }
      await driverAuthService.registerPushInstallation({
        accountAccessToken: accountAccess.accessToken,
        appId: installedDriverAppVersion.packageId,
        appVersion: installedDriverAppVersion.versionName,
        devicePushToken: registration.devicePushToken,
        locale: selectedDriverLocale,
        platform: Platform.OS,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      registeredDevicePushTokenRef.current = registration.devicePushToken;
    } catch {
      // Push registration is best-effort and retried on authenticated app activation.
    } finally {
      isPushRegistrationRunningRef.current = false;
    }
  }, [
    driverAuthService,
    getActiveAccountAccess,
    installedDriverAppVersion,
    runtimeConfig.mode,
    selectedDriverLocale,
    stopArrivalNotificationService,
  ]);

  async function loadAccountProfile(): Promise<void> {
    setIsLoadingAccountProfile(true);
    try {
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        setMessage('Your saved login expired. Sign in again to view account details.');
        return;
      }
      const result = await driverAuthService.getAccountProfile({
        accountAccessToken: accountAccess.accessToken,
      });
      setAccountName(result.account.name);
      setAccountNameDraft(result.account.name ?? '');
      setVerifiedDriverPhoneE164(result.account.phone);
    } catch {
      setMessage('Account details could not be loaded. Check your connection and try again.');
    } finally {
      setIsLoadingAccountProfile(false);
    }
  }

  function handleOpenSettings(): void {
    setMessage(null);
    setScreen('settings');
    void loadAccountProfile();
  }

  function handleOpenConsentDocument(): void {
    void Linking.openURL(DRIVER_CONSENT_DOCUMENT_URL).catch(() => {
      setMessage('Policy document could not be opened.');
    });
  }

  function handleOpenAccountName(): void {
    setAccountNameDraft(accountName ?? '');
    setScreen('accountName');
  }

  async function handleSaveAccountName(): Promise<void> {
    const name = accountNameDraft.trim();
    if (name.length === 0 || name.length > 80 || isSavingAccountName) {
      return;
    }

    const requestScreen = screenRef.current;
    setIsSavingAccountName(true);
    setMessage(null);
    try {
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        setMessage('Your saved login expired. Sign in again to update your name.');
        return;
      }
      const result = await driverAuthService.updateAccountProfile({
        accountAccessToken: accountAccess.accessToken,
        name,
      });
      setAccountName(result.account.name);
      setAccountNameDraft(result.account.name ?? '');
      setVerifiedDriverPhoneE164(result.account.phone);
      if (screenRef.current === requestScreen) {
        setScreen('settings');
      }
    } catch {
      setMessage('Name could not be updated. Check your connection and try again.');
    } finally {
      setIsSavingAccountName(false);
    }
  }

  function handleRequestAccountDeletion(): void {
    if (isRequestingAccountDeletion) {
      return;
    }

    showOperationalDialog(
      'Delete CLEVER Routes account?',
      'This sends an account deletion request and signs you out. Delivery records that the store must retain are reviewed separately.',
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => { void submitAccountDeletionRequest(); },
          style: 'destructive',
          text: 'Request Deletion',
        },
      ],
      { cancelable: true },
    );
  }

  async function submitAccountDeletionRequest(): Promise<void> {
    setIsRequestingAccountDeletion(true);
    setMessage(null);
    try {
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const queueSummary = getOfflineSubmissionQueueSummary(queue);
      if (queueSummary.totalCount > 0) {
        setMessage('Account deletion cannot be requested while delivery updates are waiting to sync or reconcile.');
        return;
      }

      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        setMessage('Your saved login expired. Sign in again to request account deletion.');
        return;
      }
      await driverAuthService.requestAccountDeletion({
        accountAccessToken: accountAccess.accessToken,
      });
      await handleLogout();
      setMessage('Account deletion request received. You have been signed out.');
    } catch (error) {
      setMessage(
        isDriverAccountDeletionActiveRouteError(error)
          ? 'Finish or release the active route before requesting account deletion.'
          : 'Account deletion could not be requested. Check your connection and try again.',
      );
    } finally {
      setIsRequestingAccountDeletion(false);
    }
  }

  function handleRequestRouteReconciliationClear(): void {
    if (routeReconciliationCount <= 0) {
      return;
    }

    requestRouteReconciliationClearConfirmation({
      alertApi: {
        alert: showOperationalDialog,
      },
      count: routeReconciliationCount,
      onConfirm: () => {
        void clearRouteReconciliationRecords();
      },
    });
  }

  async function clearRouteReconciliationRecords(): Promise<void> {
    try {
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const discarded = queue.discardReconciliationRecords();
      await queue.whenPersisted();
      syncOfflineQueueState(queue);
      setRouteRecoveryRefreshReason(null);
      setMessage(discarded === 0
        ? 'No saved reconciliation records remain.'
        : `${discarded} saved reconciliation record${discarded === 1 ? '' : 's'} cleared. Ready routes can be started again.`);
    } catch {
      setMessage('Saved reconciliation records could not be cleared. Try again.');
    }
  }

  const refreshRouteAccessLookupForSubmission = useCallback(async (routePlanId: string): Promise<DriverAccessToken | null> => {
    if (runtimeConfig.mode !== 'live') {
      return null;
    }

    try {
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        return null;
      }
      const lookupResult = await submitRouteAccess({
        accountAccessToken: accountAccess.accessToken,
      }, routeAccessService);
      if (lookupResult.kind !== 'company_guidance' && lookupResult.kind !== 'route_choices') {
        if (lookupResult.kind === 'denied' && lookupResult.status === 'NOT_FOUND') {
          await clearAndStopActiveLocationSession();
          await driverAccessTokenStore.clearCachedRouteAccess();
          setRouteSessions([]);
          setSubmission(null);
        }
        return null;
      }

      const refreshedChoice = getRouteChoicesFromSubmission(lookupResult).find(
        (choice) => choice.routeAccess.routePlanId === routePlanId,
      );
      if (refreshedChoice === undefined) {
        await clearAndStopActiveLocationSession(routePlanId);
        await driverAccessTokenStore.clearCachedRouteAccess(routePlanId);
        setRouteSessions((current) => current.filter(
          (session) => session.routeAccess.routePlanId !== routePlanId,
        ));
        return null;
      }

      const refreshedSubmission = toCompanyGuidanceSubmission(refreshedChoice);
      setSubmission((current) => (
        current?.kind === 'company_guidance' && current.routeAccess.routePlanId === routePlanId
          ? refreshedSubmission
          : current
      ));
      setRouteSessions((current) => current.map((session) => (
        session.routeAccess.routePlanId === routePlanId ? { ...session, ...refreshedChoice } : session
      )));
      await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(refreshedSubmission)).catch((error) => {
        const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
        console.warn(`[driver-api] Refreshed route access could not be saved: ${errorMessage}`);
        return false;
      });
      console.info('[driver-api] Refreshed route access after expired token.');
      return refreshedSubmission.driverAccess;
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      console.warn(`[driver-api] Route access refresh failed: ${errorMessage}`);
      return null;
    }
  }, [clearAndStopActiveLocationSession, driverAccessTokenStore, getActiveAccountAccess, routeAccessService, runtimeConfig.mode]);

  const refreshDriverAccessForSubmission = useCallback(async (
    currentSubmission: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }>,
  ): Promise<DriverAccessToken | null> => {
    return refreshRouteAccessLookupForSubmission(currentSubmission.routeAccess.routePlanId);
  }, [refreshRouteAccessLookupForSubmission]);

  const buildDriverAccessRefresh = useCallback((
    currentSubmission: RouteAccessSubmissionResult | null,
  ): (() => Promise<DriverAccessToken | null>) | undefined => (
    currentSubmission?.kind === 'company_guidance'
      ? () => refreshDriverAccessForSubmission(currentSubmission)
      : undefined
  ), [refreshDriverAccessForSubmission]);

  const retryOfflineSubmissionsForSessions = useCallback(async (sessions: RouteSession[]): Promise<boolean> => {
    if (isRetryingOfflineSubmissionsRef.current || sessions.length === 0) {
      return true;
    }

    isRetryingOfflineSubmissionsRef.current = true;
    let completedWithoutRetainedFailures = true;
    try {
      const queue = await getExpoOfflineSubmissionQueue();
      for (const session of sessions) {
        const routeSubmission = toCompanyGuidanceSubmission(session);
        const refreshDriverAccess = buildDriverAccessRefresh(routeSubmission);
        const result = await retryOfflineSubmissions({
          driverEventService: getDriverEventServiceForCurrentSubmission({
            fallback: mockDriverEventService,
            refreshDriverAccess,
            runtimeConfig,
            submission: routeSubmission,
          }),
          proofMediaUploadService: getProofMediaUploadServiceForCurrentSubmission({
            fallback: mockProofMediaUploadService,
            refreshDriverAccess,
            runtimeConfig,
            submission: routeSubmission,
          }),
          queue,
          routePlanId: session.route.id,
        });
        if (result.failed > 0) {
          completedWithoutRetainedFailures = false;
        }
        if (result.reconciliationRoutePlanIds?.includes(session.route.id) === true) {
          if (activeRoutePlanId === session.route.id) {
            await clearAndStopActiveLocationSession(session.route.id);
            setActiveRoutePlanId(null);
            setDeliveryStartResult(null);
            setContinuousLocationResult({
              kind: 'stopped',
              taskName: CONTINUOUS_LOCATION_TASK_NAME,
            });
            setScreen('mainTabs');
          }
          setRouteRecoveryRefreshReason('route_not_in_progress');
          setMessage('Route ended or released on server. Unsynced delivery results were preserved for reconciliation.');
        } else if (result.requiresRouteLookup === true) {
          setRouteRecoveryRefreshReason(
            result.routeLookupReason === 'pickup_eta_snapshot_synced'
              ? 'pickup_eta_snapshot_synced'
              : 'driver_access_expired',
          );
          setMessage(
            result.routeLookupReason === 'pickup_eta_snapshot_synced'
              ? 'Pickup synced. Refreshing route ETA.'
              : 'Driver access expired. Refreshing route assignments.',
          );
        }
      }
      await queue.whenPersisted();
      syncOfflineQueueState(queue);
      setRouteSessions((current) => current.map((session) => ({
        ...session,
        pendingRouteEnd: getPendingRouteEnd(queue, session.route.id) ?? undefined,
      })));
    } catch (error) {
      completedWithoutRetainedFailures = false;
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      console.warn(`[offline-queue] Retry failed: ${errorMessage}`);
    } finally {
      isRetryingOfflineSubmissionsRef.current = false;
    }
    return completedWithoutRetainedFailures;
  }, [
    activeRoutePlanId,
    buildDriverAccessRefresh,
    clearAndStopActiveLocationSession,
    mockDriverEventService,
    mockProofMediaUploadService,
    runtimeConfig,
    setScreen,
    syncOfflineQueueState,
  ]);

  const usesSelectedRouteContext = screen === 'completedDeliveries'
    || (screen === 'stopDetails' && stopDetailsReturnScreen === 'completedDeliveries');
  const selectedRouteContextId = usesSelectedRouteContext
    ? selectedRouteId
    : activeRoutePlanId ?? selectedRouteId;
  const selectedRouteSession = selectedRouteContextId === null
    ? null
    : routeSessions.find(
      (session) => session.route.id === selectedRouteContextId,
    ) ?? null;
  const selectedRoute = selectedRouteSession?.route ?? null;
  const routeStatus = getRouteStatus(deliveryStartResult, deliveryFinishResult);
  const isLiveLocationEnabled = selectedRoute !== null
    && deliveryStartResult?.kind === 'delivery_active'
    && activeRoutePlanId === selectedRoute.id
    && deliveryFinishResult?.flowState !== 'delivery_finished';
  const currentStop = selectedRoute === null ? null : getCurrentRouteStop({ navigationStepIndex, route: selectedRoute });
  const currentStopPhotoResult = currentStop === null ? undefined : proofPhotoResults[currentStop.deliveryStopId];
  const currentStopPhotoUri = currentStopPhotoResult?.kind === 'captured' ? currentStopPhotoResult.uri : undefined;
  const stopDetailsProgressState = selectedRoute === null
    ? null
    : getStopDetailsProgressState({
      navigationStepIndex,
      route: selectedRoute,
      selectedStopDetailsId,
    });
  const stopDetailsStop = stopDetailsProgressState?.stop ?? null;
  const isCompanyStep = navigationStepIndex === COMPANY_STEP_INDEX;
  const canArriveFromStopDetails = stopDetailsReturnScreen === 'routeSession'
    && routeStatus === 'active'
    && navigationStepIndex !== COMPANY_STEP_INDEX
    && stopDetailsStop !== null
    && !isStopCompleted(stopDetailsStop, completedStopIds);
  const canSkipFromStopDetails = canArriveFromStopDetails
    && currentStop?.deliveryStopId === stopDetailsStop?.deliveryStopId
    && !isCompletingStop
    && !isRecordingArrival;
  const allStopsCompleted = selectedRoute !== null && selectedRoute.stops.every((stop) => completedStopIds.includes(stop.deliveryStopId));
  const currentCompany = selectedRouteSession?.companyGuidance ?? null;
  const isRouteBoundScreen = screen === 'arrivalCheck'
    || screen === 'completedDeliveries'
    || screen === 'proofCamera'
    || screen === 'routeSession'
    || screen === 'stopDetails';

  useEffect(() => {
    if (!isDriverRestoreComplete || routeSyncState !== 'ready') {
      return undefined;
    }
    const shouldRecoverMissingRoute = isRouteBoundScreen && selectedRoute === null;
    const shouldRecoverMissingStop = screen === 'stopDetails' && stopDetailsStop === null;
    const shouldRecoverMissingActiveStop = (screen === 'arrivalCheck' || screen === 'proofCamera')
      && currentStop === null;
    if (!shouldRecoverMissingRoute && !shouldRecoverMissingStop && !shouldRecoverMissingActiveStop) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      if (isRouteBoundScreen && selectedRoute === null) {
        setSelectedStopDetailsId(null);
        setScreen('mainTabs');
        setMessage('This route is no longer available. My Routes was refreshed.');
        return;
      }
      if (screen === 'stopDetails' && stopDetailsStop === null) {
        setSelectedStopDetailsId(null);
        setScreen(stopDetailsReturnScreen);
        setMessage('This stop is no longer available on the selected route.');
        return;
      }
      if ((screen === 'arrivalCheck' || screen === 'proofCamera') && currentStop === null) {
        setScreen('routeSession');
        setMessage('The active stop changed. Route Session was restored.');
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [
    currentStop,
    isDriverRestoreComplete,
    isRouteBoundScreen,
    routeSyncState,
    screen,
    selectedRoute,
    setScreen,
    stopDetailsReturnScreen,
    stopDetailsStop,
  ]);

  useEffect(() => {
    if (
      !isLiveLocationEnabled
      || selectedRoute === null
      || continuousLocationStreamService.updateLocationNotification === undefined
    ) {
      return;
    }

    void continuousLocationStreamService.updateLocationNotification({
      notification: buildActiveRouteForegroundNotification({
        currentStepIndex: navigationStepIndex,
        route: selectedRoute,
      }),
      taskName: CONTINUOUS_LOCATION_TASK_NAME,
    }).catch((error) => {
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      console.warn(`[location] Route notification could not be updated: ${errorMessage}`);
    });
  }, [continuousLocationStreamService, currentStop, isLiveLocationEnabled, navigationStepIndex, selectedRoute]);

  useEffect(() => {
    let isMounted = true;
    const handleUrl = (url: string | null) => {
      if (!isMounted || url === null) {
        return;
      }
      const target = parseActiveRouteNotificationUrl(url);
      if (target !== null) {
        if (target.action !== undefined) {
          if (isRecordingArrivalRef.current) {
            setMessage('Arrival is already being recorded. The extra action was ignored.');
            return;
          }
          const response: StopArrivalNotificationResponse = {
            action: target.action,
            data: {
              deliveryStopId: target.deliveryStopId,
              routePlanId: target.routePlanId,
              type: STOP_ARRIVAL_NOTIFICATION_TYPE,
            },
          };
          setPendingStopArrivalNotification((current) => current ?? response);
          return;
        }
        pendingActiveRouteNotificationTargetRef.current = target;
        setPendingActiveRouteNotificationTarget(target);
      }
    };

    void Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (
      pendingActiveRouteNotificationTarget === null
      || routeSessions.length === 0
      || !isDriverRestoreComplete
      || !isInitialRouteRestoreComplete
      || routeSyncState !== 'ready'
      || isNavigationInterruptionProtected
    ) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      const routeSession = routeSessions.find(
        (session) => session.route.id === pendingActiveRouteNotificationTarget.routePlanId,
      );
      const stop = routeSession?.route.stops.find(
        (candidate) => candidate.deliveryStopId === pendingActiveRouteNotificationTarget.deliveryStopId,
      );
      pendingActiveRouteNotificationTargetRef.current = null;
      setPendingActiveRouteNotificationTarget(null);

      if (
        routeSession === undefined
        || stop === undefined
        || !isActiveRouteNotificationTargetCurrent({
          activeRoutePlanId,
          completedStopIds,
          currentStepIndex: navigationStepIndex,
          route: routeSession.route,
          target: pendingActiveRouteNotificationTarget,
        })
      ) {
        setMessage('This stop is no longer available on the active route.');
        return;
      }

      setSelectedRouteId(routeSession.route.id);
      setSubmission(toCompanyGuidanceSubmission(routeSession));
      setSelectedStopDetailsId(stop.deliveryStopId);
      setStopDetailsReturnScreen('routeSession');
      setScreen('stopDetails');
      setMessage(null);
    }, 0);

    return () => clearTimeout(timeout);
  }, [
    activeRoutePlanId,
    completedStopIds,
    isDriverRestoreComplete,
    isInitialRouteRestoreComplete,
    isNavigationInterruptionProtected,
    navigationStepIndex,
    pendingActiveRouteNotificationTarget,
    routeSyncState,
    routeSessions,
    setScreen,
  ]);

  function applyEtaUpdateToRoute(routePlanId: string, etaUpdate: DriverRouteEtaUpdate) {
    setRouteSessions((current) => current.map((session) => (
      session.route.id === routePlanId
        ? { ...session, route: applyDriverRouteEtaUpdate(session.route, etaUpdate) }
        : session
    )));
  }

  function applyEtaSnapshotToRoute(routePlanId: string, etaSnapshot: AssignedRoute['etaSnapshot']) {
    setRouteSessions((current) => current.map((session) => {
      if (session.route.id !== routePlanId) {
        return session;
      }

      return {
        ...session,
        route: {
          ...session.route,
          etaSnapshot: etaSnapshot ?? null,
        },
      };
    }));
  }

  const submitStopArrivalForRouteStop = useCallback(async (
    routeSession: RouteSession,
    stop: AssignedRouteStop,
    arrivalEvidence?: StopArrivalEvidence,
  ): Promise<StopArrivedRecordResult> => {
    if (deliveryStartResult === null) {
      return {
        kind: 'blocked',
        message: 'The active delivery session could not be confirmed. Refresh the route and try again.',
        reason: 'delivery_not_active',
      };
    }

    const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
    if (offlineSubmissionQueue === null) {
      setOfflineSubmissionQueue(queue);
    }

    const routeSubmission = toCompanyGuidanceSubmission(routeSession);
    const result = await recordStopArrivedAfterDeliveryStart({
      ...(arrivalEvidence === undefined ? {} : { arrivalEvidence }),
      deliveryStart: deliveryStartResult,
      deliveryStopId: stop.deliveryStopId,
      driverEventService: createRouteOrderedDriverEventService({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          refreshDriverAccess: buildDriverAccessRefresh(routeSubmission),
          runtimeConfig,
          submission: routeSubmission,
        }),
        queue,
        routePlanId: routeSession.route.id,
      }),
      offlineQueue: queue,
      routePlanId: routeSession.route.id,
    });

    if (result.kind === 'recorded' && result.etaSnapshot !== undefined) {
      applyEtaSnapshotToRoute(routeSession.route.id, result.etaSnapshot);
    }
    if (result.kind === 'recorded' && result.etaUpdate !== undefined) {
      applyEtaUpdateToRoute(routeSession.route.id, result.etaUpdate);
    }
    if (result.kind === 'queued') {
      await queue.whenPersisted();
    }
    syncOfflineQueueState(queue);
    return result;
  }, [
    buildDriverAccessRefresh,
    deliveryStartResult,
    mockDriverEventService,
    offlineSubmissionQueue,
    runtimeConfig,
    syncOfflineQueueState,
  ]);

  const recordStopArrival = useCallback(async (
    stop: AssignedRouteStop,
    returnScreen: ArrivalCheckReturnScreen,
    requestScreen = screenRef.current,
    action: StopArrivalNotificationAction = 'add_proof',
    routeSession = selectedRouteSession,
  ): Promise<boolean> => {
    if (routeSession === null) {
      setMessage('The active route could not be confirmed. Refresh the route and try again.');
      return false;
    }
    if (isRecordingArrivalRef.current) {
      setMessage('Arrival is already being recorded. The extra action was ignored.');
      return false;
    }

    isRecordingArrivalRef.current = true;
    setIsRecordingArrival(true);
    setMessage(null);
    setStopArrivalProximityByStopId((current) => ({
      ...current,
      [stop.deliveryStopId]: null,
    }));
    try {
      let arrivalEvidence: StopArrivalEvidence | undefined;
      try {
        const location = await foregroundLocationSnapshotService.getCurrentForegroundLocation();
        const proximity = getStopArrivalProximityEvidence({
          location,
          route: routeSession.route,
          stop,
        });
        setStopArrivalProximityByStopId((current) => ({
          ...current,
          [stop.deliveryStopId]: proximity,
        }));
        arrivalEvidence = {
          ...(proximity === null ? {} : { distanceToPlannedStopMeters: proximity.distanceMeters }),
          latitude: location.latitude,
          longitude: location.longitude,
          recordedAt: location.recordedAt,
        };
      } catch {
        // Arrival must still be recorded when a fresh GPS fix is unavailable.
      }

      const result = await submitStopArrivalForRouteStop(routeSession, stop, arrivalEvidence);
      if (result.kind === 'blocked') {
        setMessage(result.message);
        return false;
      }
      if (screenRef.current !== requestScreen) {
        setMessage(result.kind === 'queued'
          ? result.message
          : 'Arrival was recorded. Open the stop again to continue.');
        return false;
      }
      if (action === 'next_stop') {
        setScreen('routeSession');
        setPendingStopArrivalCompletion({
          deliveryStopId: stop.deliveryStopId,
          routePlanId: routeSession.route.id,
          type: STOP_ARRIVAL_NOTIFICATION_TYPE,
        });
        setMessage(result.kind === 'queued'
          ? `${result.message} Completing the stop next.`
          : 'Arrival confirmed. Completing this stop and preparing next-stop navigation.');
        return true;
      }

      setArrivalCheckReturnScreen(returnScreen);
      setScreen('arrivalCheck');
      setMessage(result.kind === 'queued'
        ? result.message
        : 'Arrival confirmed by server. Future stop ETAs were updated.');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      setMessage(`Arrival could not be recorded: ${errorMessage}`);
      return false;
    } finally {
      isRecordingArrivalRef.current = false;
      setIsRecordingArrival(false);
    }
  }, [foregroundLocationSnapshotService, selectedRouteSession, setScreen, submitStopArrivalForRouteStop]);

  const handleStopArrivalNotificationPress = useCallback(async (response: StopArrivalNotificationResponse) => {
    const { action, data } = response;
    if (!isInitialRouteRestoreComplete || routeSyncState !== 'ready') {
      setPendingStopArrivalNotification((current) => current ?? response);
      return;
    }
    if (isNavigationInterruptionProtected) {
      setPendingStopArrivalNotification(null);
      setMessage('Finish the current delivery action first. The extra arrival action was ignored.');
      return;
    }

    const routeSession = routeSessions.find((session) => session.route.id === data.routePlanId) ?? null;
    if (routeSession === null) {
      setPendingStopArrivalNotification((current) => current ?? response);
      setMessage('Arrival alert opened. Loading the assigned route.');
      return;
    }

    const stopIndex = routeSession.route.stops.findIndex((candidate) => candidate.deliveryStopId === data.deliveryStopId);
    setPendingStopArrivalNotification(null);

    if (stopIndex < 0) {
      setMessage('Arrival alert opened, but the stop is no longer available on this route.');
      return;
    }

    if (deliveryStartResult?.kind !== 'delivery_active') {
      setSelectedRouteId(routeSession.route.id);
      setSubmission(toCompanyGuidanceSubmission(routeSession));
      setNavigationStepIndex(stopIndex + 1);
      setScreen('routeSession');
      setMessage('Arrival alert opened, but the route is not active yet. Start the session first.');
      return;
    }

    if (activeRoutePlanId !== routeSession.route.id || navigationStepIndex !== stopIndex + 1) {
      setSelectedRouteId(activeRoutePlanId ?? routeSession.route.id);
      setScreen('routeSession');
      setMessage('This arrival alert is no longer for the current stop. The active route was kept unchanged.');
      return;
    }

    if (completedStopIds.includes(data.deliveryStopId)) {
      setScreen('routeSession');
      setMessage('This stop is already completed. The active route was kept unchanged.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setSelectedStopDetailsId(null);
    setNavigationStepIndex(stopIndex + 1);
    const requestScreen = screenRef.current;
    const stop = routeSession.route.stops[stopIndex];
    if (stop === undefined) {
      setMessage('Arrival alert opened, but the stop is no longer available on this route.');
      return;
    }
    await recordStopArrival(stop, 'routeSession', requestScreen, action, routeSession);
  }, [
    activeRoutePlanId,
    completedStopIds,
    deliveryStartResult?.kind,
    isInitialRouteRestoreComplete,
    isNavigationInterruptionProtected,
    navigationStepIndex,
    recordStopArrival,
    routeSyncState,
    routeSessions,
    setScreen,
  ]);

  useEffect(() => {
    let isMounted = true;
    getExpoOfflineSubmissionQueue()
      .then((queue) => {
        if (!isMounted) {
          return;
        }

        setOfflineSubmissionQueue(queue);
        syncOfflineQueueState(queue);
      })
      .catch(() => {
        if (isMounted) {
          setMessage('Offline retry storage is unavailable. This session will retry in memory only.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [syncOfflineQueueState]);

  useEffect(() => scheduleTransientToastDismiss({
    dismiss: () => setMessage(null),
    message,
  }), [message]);

  useEffect(() => {
    if (
      pendingStopArrivalNotification !== null
      && isInitialRouteRestoreComplete
      && routeSyncState === 'ready'
      && routeSessions.length > 0
    ) {
      const timeout = setTimeout(() => {
        handleStopArrivalNotificationPress(pendingStopArrivalNotification);
      }, 0);

      return () => clearTimeout(timeout);
    }

    return undefined;
  }, [
    handleStopArrivalNotificationPress,
    isInitialRouteRestoreComplete,
    pendingStopArrivalNotification,
    routeSessions.length,
    routeSyncState,
  ]);

  useEffect(() => {
    if (
      pendingStopArrivalCompletion === null
      || isNavigationInterruptionProtected
      || selectedRoute?.id !== pendingStopArrivalCompletion.routePlanId
      || currentStop?.deliveryStopId !== pendingStopArrivalCompletion.deliveryStopId
    ) {
      return undefined;
    }

    const completion = pendingStopArrivalCompletion;
    const timeout = setTimeout(() => {
      setPendingStopArrivalCompletion(null);
      void completeStopFromNotificationRef.current(completion);
    }, 0);
    return () => clearTimeout(timeout);
  }, [
    currentStop?.deliveryStopId,
    isNavigationInterruptionProtected,
    pendingStopArrivalCompletion,
    selectedRoute?.id,
  ]);

  useEffect(() => {
    if (deliveryStartResult?.kind !== 'delivery_active' || deliveryFinishResult?.flowState === 'delivery_finished') {
      registerContinuousLocationTaskObserver(null);
      return;
    }

    registerContinuousLocationTaskObserver(async (locations, taskResult) => {
      if (taskResult?.kind === 'deactivated') {
        const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue().catch(() => null);
        if (queue !== null && offlineSubmissionQueue === null) {
          setOfflineSubmissionQueue(queue);
        }
        syncOfflineQueueState(queue);
        setActiveRoutePlanId(null);
        setDeliveryStartResult(null);
        setContinuousLocationResult({
          kind: 'stopped',
          taskName: CONTINUOUS_LOCATION_TASK_NAME,
        });
        setScreen('mainTabs');
        if (taskResult.reason === 'route_not_in_progress') {
          setRouteRecoveryRefreshReason('route_not_in_progress');
          setMessage('Route ended or released on server. Unsynced delivery results were preserved for reconciliation.');
        } else {
          setRouteRecoveryRefreshReason('driver_access_expired');
          setMessage('Driver access expired. Live location tracking stopped while route assignments refresh.');
        }
        return;
      }
      syncOfflineQueueState(offlineSubmissionQueue);

      const lastLocation = locations[locations.length - 1] ?? null;
      const candidate = getStopArrivalNotificationCandidate({
        completedStopIds,
        currentStepIndex: navigationStepIndex,
        isActiveRoute: routeStatus === 'active',
        lastLocation,
        notifiedStopIds: [...notifiedStopArrivalIdsRef.current],
        route: selectedRoute,
      });

      if (candidate !== null && selectedRoute !== null) {
        notifiedStopArrivalIdsRef.current.add(candidate.stop.deliveryStopId);
        await continuousLocationStreamService.updateLocationNotification?.({
          notification: buildActiveRouteForegroundNotification({
            currentStepIndex: navigationStepIndex,
            route: selectedRoute,
          }),
          taskName: CONTINUOUS_LOCATION_TASK_NAME,
        }).catch(() => undefined);
        await stopArrivalNotificationService.scheduleStopArrivalNotification(candidate);
      }
    });

    return () => registerContinuousLocationTaskObserver(null);
  }, [
    completedStopIds,
    continuousLocationStreamService,
    deliveryFinishResult,
    deliveryStartResult,
    navigationStepIndex,
    offlineSubmissionQueue,
    routeStatus,
    selectedRoute,
    setScreen,
    stopArrivalNotificationService,
    syncOfflineQueueState,
  ]);

  function handlePhoneInputChange(value: string) {
    setNationalPhoneInput(formatDriverNationalPhoneInput({
      countryIso2: selectedPhoneCountry.iso2,
      nationalPhoneInput: value,
    }));
  }

  function handlePhoneCountrySelect(country: DriverPhoneCountry) {
    setSelectedPhoneCountryIso2(country.iso2);
    setSelectedDriverLocale(country.defaultLocale);
    setCountrySearchQuery('');
    setScreen('loginPhone');
    setNationalPhoneInput(formatDriverNationalPhoneInput({
      countryIso2: country.iso2,
      nationalPhoneInput,
    }));
  }

  function openPhoneCountrySelector() {
    setCountrySearchQuery('');
    setScreen('countrySelect');
  }

  async function handlePhoneSubmit() {
    const phoneEntry = normalizeDriverPhoneEntry({
      countryIso2: selectedPhoneCountry.iso2,
      nationalPhoneInput,
    });

    if (!phoneEntry.ok) {
      setMessage(formatDriverPhoneEntryProblem(phoneEntry.reason));
      return;
    }

    setIsRegistration(false);
    setInviteCode('');
    setPin('');
    setPinConfirmation('');
    setMessage('Enter your 6-digit PIN.');
    setScreen('loginDetail');
  }

  async function handleDetailSubmit() {
    const phoneEntry = normalizeDriverPhoneEntry({
      countryIso2: selectedPhoneCountry.iso2,
      nationalPhoneInput,
    });

    if (!phoneEntry.ok) {
      setMessage(formatDriverPhoneEntryProblem(phoneEntry.reason));
      return;
    }

    if (!acceptedPrivacy || !acceptedLocation) {
      setMessage('Privacy Policy and Location-Based Services consent are required.');
      return;
    }

    const safePin = pin.trim();
    if (!/^\d{6}$/u.test(safePin)) {
      setMessage('Enter your 6-digit numeric PIN.');
      return;
    }

    const safeInviteCode = inviteCode.trim().toUpperCase();
    if (isRegistration && !/^[0-9A-F]{6}$/u.test(safeInviteCode)) {
      setMessage('Enter the 6-character invite code from dispatch.');
      return;
    }
    if (isRegistration && pinConfirmation.trim() !== safePin) {
      setMessage('PIN confirmation does not match.');
      return;
    }

    setIsLoggingIn(true);
    setMessage(`${isRegistration ? 'Creating account' : 'Signing in'}...`);
    try {
      const authResult = isRegistration
        ? await driverAuthService.register({
            phoneE164: phoneEntry.phoneE164,
            inviteCode: safeInviteCode,
            pin: safePin,
          })
        : await driverAuthService.login({
            phoneE164: phoneEntry.phoneE164,
            pin: safePin,
          });
      await driverAccessTokenStore.saveAuthenticatedDriver({
        accountAccess: authResult.accountAccess,
        phoneE164: phoneEntry.phoneE164,
      });
      setVerifiedDriverPhoneE164(phoneEntry.phoneE164);
      setPin('');
      setPinConfirmation('');
      setMessage(null);
      setIsLoggingIn(false);
      setScreen('mainTabs');
      await handleLoginAndLoadRoutes(
        authResult.accountAccess,
        phoneEntry.phoneE164,
        { allowVerifiedDriverNoRoute: true },
      );
    } catch (error) {
      const failure = buildAuthFailureMessage({
        runtimeConfig,
        phase: isRegistration ? 'invite_verify' : 'pin_login',
        error,
      });
      setMessage(failure.message);
    } finally {
      setIsLoggingIn(false);
    }
  }

  const openVerifiedNoAssignedRoute = useCallback(async () => {
    await clearAndStopActiveLocationSession();
    resetRouteProgress();
    setSubmission(null);
    setLastRoutesUpdatedAt(new Date());
    setRouteSyncState('ready');
    setScreen('mainTabs');
    void driverAccessTokenStore.clearCachedRouteAccess().catch(() => undefined);
  }, [clearAndStopActiveLocationSession, driverAccessTokenStore, setScreen]);

  const handleLoginAndLoadRoutes = useCallback(async (
    accountAccess: DriverAccountAccessToken,
    phoneE164: string,
    options: RouteLoadOptions = {},
  ) => {
    const allowVerifiedDriverNoRoute = options.allowVerifiedDriverNoRoute ?? false;
    const shouldResetProgress = options.resetProgress ?? true;
    const shouldNavigateOnSuccess = options.navigateOnSuccess ?? true;
    setIsLoggingIn(true);
    setRouteSyncState('loading');
    setMessage(null);
    setVerifiedDriverPhoneE164(phoneE164);
    if (shouldResetProgress) {
      resetRouteProgress();
    }

    try {
      const lookupResult = await submitAccountRouteAccess(accountAccess);
      setSubmission(lookupResult);

      if (lookupResult.kind !== 'company_guidance' && lookupResult.kind !== 'route_choices') {
        if (lookupResult.kind === 'denied' && lookupResult.status === 'NOT_FOUND') {
          await driverAccessTokenStore.clearCachedRouteAccess();
        }
        if (allowVerifiedDriverNoRoute && lookupResult.kind === 'denied' && lookupResult.status === 'NOT_FOUND') {
          await openVerifiedNoAssignedRoute();
          return;
        }

        setMessage(formatRouteAccessProblem(lookupResult));
        setRouteSyncState('error');
        setScreen('mainTabs');
        return;
      }

      const choices = getRouteChoicesFromSubmission(lookupResult);
      if (choices.length === 0) {
        await openVerifiedNoAssignedRoute();
        return;
      }

      const loadedSessions: RouteSession[] = [];
      let routeLoadFailed = false;

      for (const choice of choices) {
        const choiceSubmission = toCompanyGuidanceSubmission(choice);
        const consentResult = await submitDriverConsent(
          {
            appContext: { appVersion: installedDriverAppVersion?.versionName ?? 'unknown' },
            deviceContext: { platform: Platform.OS },
            routeContext: choice.routeAccess.routeContext,
          },
          getDriverConsentServiceForCurrentSubmission({
            fallback: mockDriverConsentService,
            refreshDriverAccess: buildDriverAccessRefresh(choiceSubmission),
            runtimeConfig,
            submission: choiceSubmission,
          }),
        );
        setConsentSubmission(consentResult);

        if (consentResult.kind !== 'consent_recorded') {
          routeLoadFailed = true;
          setMessage(consentResult.message);
          continue;
        }
        setAcceptedPrivacy(true);
        setAcceptedLocation(true);

        const assignedRouteResult = await loadAssignedRouteAfterConsent(
          {
            consentState: consentResult.flowState,
            routeContext: choice.routeAccess.routeContext,
          },
          getAssignedRouteServiceForCurrentSubmission({
            fallback: mockAssignedRouteService,
            refreshDriverAccess: buildDriverAccessRefresh(choiceSubmission),
            runtimeConfig,
            submission: choiceSubmission,
          }),
        );
        if (assignedRouteResult.kind === 'route_ready') {
          loadedSessions.push({
            ...choice,
            route: assignedRouteResult.route,
          });
        } else if (assignedRouteResult.kind !== 'no_assigned_route') {
          routeLoadFailed = true;
          setMessage(assignedRouteResult.message);
        }
      }

      if (loadedSessions.length === 0) {
        if (routeLoadFailed) {
          setRouteSyncState('error');
          setScreen('mainTabs');
          return;
        }
        await openVerifiedNoAssignedRoute();
        return;
      }

      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const loadedSessionsWithPendingEnds = loadedSessions.map((session): RouteSession => ({
        ...session,
        pendingRouteEnd: getPendingRouteEnd(queue, session.route.id) ?? undefined,
      }));

      const persistedActiveRouteSession = options.activeRouteSession ?? null;
      const serverActiveRouteSession = persistedActiveRouteSession === null
        ? loadedSessionsWithPendingEnds.find((session) => (
            session.companyGuidance.executionStatus === 'IN_PROGRESS' && session.pendingRouteEnd === undefined
          )) ?? null
        : null;
      const serverActiveProgress = serverActiveRouteSession === null
        ? null
        : getAssignedRouteServerProgress(serverActiveRouteSession.route);
      const serverRestoreTimestamp = new Date().toISOString();
      const activeRouteSession: PersistedActiveRouteSession | null = persistedActiveRouteSession ?? (
        serverActiveRouteSession === null || serverActiveProgress === null
          ? null
          : {
              navigationStepIndex: serverActiveProgress.navigationStepIndex,
              routePlanId: serverActiveRouteSession.route.id,
              startedAt: serverRestoreTimestamp,
              status: 'active',
              updatedAt: serverRestoreTimestamp,
            }
      );
      const restoredFromServer = persistedActiveRouteSession === null && serverActiveRouteSession !== null;
      const restoredActiveSession = activeRouteSession === null
        ? null
        : loadedSessionsWithPendingEnds.find((session) => (
            session.route.id === activeRouteSession.routePlanId
            && session.pendingRouteEnd === undefined
          )) ?? null;
      const activeRouteLoadIsUnresolved = persistedActiveRouteSession !== null
        && restoredActiveSession === null
        && routeLoadFailed;
      if (activeRouteLoadIsUnresolved) {
        setRouteSyncState('error');
        setScreen('mainTabs');
        setMessage('The active route could not be refreshed. Its server state was kept; retry when the connection is stable.');
        return;
      }
      const currentSelectedRouteId = selectedRouteIdRef.current;
      const selectedRouteWasRemoved = currentSelectedRouteId !== null &&
        !loadedSessionsWithPendingEnds.some((session) => session.route.id === currentSelectedRouteId);
      const activeRouteWasRemoved = persistedActiveRouteSession !== null && restoredActiveSession === null;
      if (activeRouteWasRemoved) {
        await clearAndStopActiveLocationSession(persistedActiveRouteSession.routePlanId);
        resetRouteProgress();
      } else if (selectedRouteWasRemoved && restoredActiveSession === null) {
        resetRouteProgress();
      }
      setRouteSessions(loadedSessionsWithPendingEnds);
      setRouteSyncState('ready');
      setLastRoutesUpdatedAt(new Date());
      const nextSelectedRouteId = restoredActiveSession !== null
        ? restoredActiveSession.route.id
        : currentSelectedRouteId !== null && loadedSessionsWithPendingEnds.some((session) => session.route.id === currentSelectedRouteId)
          ? currentSelectedRouteId
          : loadedSessionsWithPendingEnds[0].route.id;
      setSelectedRouteId(nextSelectedRouteId);
      const selectedSession = loadedSessionsWithPendingEnds.find((session) => session.route.id === nextSelectedRouteId)
        ?? loadedSessionsWithPendingEnds[0];
      const firstSubmission = toCompanyGuidanceSubmission(selectedSession);
      setSubmission(firstSubmission);
      await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(firstSubmission)).catch(() => {
        runAfterUiInteractions(() => {
          setMessage('Route loaded, but session persistence failed. Sign in again if the app does not restore this route next launch.');
        });
      });
      void retryOfflineSubmissionsForSessions(loadedSessionsWithPendingEnds);
      if (restoredActiveSession !== null) {
        const restoredServerProgress = getAssignedRouteServerProgress(restoredActiveSession.route);
        setServerConfirmedStopIds(restoredServerProgress.completedStopIds);
        const pickupIsUnconfirmed = restoredServerProgress.navigationStepIndex === COMPANY_STEP_INDEX
          && (restoredActiveSession.route.etaSnapshot?.status === undefined
            || restoredActiveSession.route.etaSnapshot?.status === 'PRE_PICKUP')
          && activeRouteSession?.pickupCompletedAt === undefined;
        const restoredStepIndex = clampRouteNavigationStepIndex(
          pickupIsUnconfirmed
            ? COMPANY_STEP_INDEX
            : Math.max(activeRouteSession?.navigationStepIndex ?? COMPANY_STEP_INDEX, restoredServerProgress.navigationStepIndex),
          restoredActiveSession.route,
        );
        setCompletedStopIds((current) => [
          ...new Set([
            ...current,
            ...(activeRouteSession?.completedStopIds ?? []),
            ...restoredServerProgress.completedStopIds,
          ]),
        ]);
        if (restoredFromServer && activeRouteSession !== null) {
          const activeRouteSaved = await driverAccessTokenStore.saveActiveRouteSession({
            completedStopIds: restoredServerProgress.completedStopIds,
            navigationStepIndex: restoredStepIndex,
            routePlanId: restoredActiveSession.route.id,
            startedAt: activeRouteSession.startedAt,
          });
          if (!activeRouteSaved) {
            setScreen('mainTabs');
            setMessage('The in-progress route could not be restored locally. Refresh routes and try again.');
            return;
          }
          await driverAccessTokenStore.markActiveRouteStarted(
            restoredActiveSession.route.id,
            activeRouteSession.startedAt ?? activeRouteSession.updatedAt,
          );
        }
        const restoredDeliveryStart = getRestoredActiveDeliveryStartResult();
        setDeliveryStartResult(restoredDeliveryStart);
        setDeliveryFinishResult(null);
        setActiveRoutePlanId(restoredActiveSession.route.id);
        setNavigationStepIndex(restoredStepIndex);
        if (shouldNavigateOnSuccess) {
          setScreen('mainTabs');
        }
        if (AppState.currentState !== 'active') {
          setContinuousLocationResult(null);
          setMessage('Active route restored. Tracking will resume when the app is open; the server route remains active.');
          return;
        }
        try {
          const continuousResult = await startContinuousLocationUpdatesAfterDeliveryStart({
            deliveryStart: restoredDeliveryStart,
            notification: buildActiveRouteForegroundNotification({
              currentStepIndex: restoredStepIndex,
              route: restoredActiveSession.route,
            }),
            routePlanId: restoredActiveSession.route.id,
            streamService: continuousLocationStreamService,
          });
          setContinuousLocationResult(continuousResult);
          if (continuousResult.kind === 'blocked') {
            setMessage(`${continuousResult.message} The server route remains active and tracking will retry after permission is available.`);
            return;
          }
        } catch (error) {
          setContinuousLocationResult(null);
          const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
          setMessage(`Tracking could not resume (${errorMessage}); the server route remains active and tracking will retry when routes refresh.`);
          return;
        }
        return;
      }

      if (shouldNavigateOnSuccess) {
        setScreen('mainTabs');
      }
      setMessage(null);
    } catch (error) {
      const failure = buildAuthFailureMessage({
        runtimeConfig,
        phase: 'route_access',
        error,
      });
      if (failure.kind === 'server_401') {
        await clearAndStopActiveLocationSession();
        await driverAccessTokenStore.clear();
        resetRouteProgress();
        setVerifiedDriverPhoneE164(null);
        setScreen('loginPhone');
        setRouteSyncState('idle');
        setMessage('Your login expired. Sign in again with your phone number and PIN.');
      } else {
        setRouteSyncState('error');
        setScreen('mainTabs');
        setMessage(failure.message);
      }
    } finally {
      setIsLoggingIn(false);
      setIsInitialRouteRestoreComplete(true);
    }
  }, [
    buildDriverAccessRefresh,
    clearAndStopActiveLocationSession,
    continuousLocationStreamService,
    driverAccessTokenStore,
    installedDriverAppVersion?.versionName,
    mockAssignedRouteService,
    mockDriverConsentService,
    offlineSubmissionQueue,
    openVerifiedNoAssignedRoute,
    retryOfflineSubmissionsForSessions,
    routeAccessService,
    runtimeConfig,
    setScreen,
    submitAccountRouteAccess,
  ]);

  const handleRefreshRoutes = useCallback(async () => {
    if (verifiedDriverPhoneE164 === null) {
      setMessage('Saved driver phone is unavailable. Sign in again to refresh routes.');
      return;
    }
    if (isRefreshingRoutes || isLoggingIn) {
      return;
    }

    setMessage(null);
    setIsRefreshingRoutes(true);
    try {
      const restoredAccess = await driverAccessTokenStore.loadActiveDriverAccess();
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
        await clearAndStopActiveLocationSession();
        setMessage('Your saved login expired. Sign in with your phone number and PIN.');
        resetRouteProgress();
        setVerifiedDriverPhoneE164(null);
        setScreen('loginPhone');
        return;
      }
      await handleLoginAndLoadRoutes(
        accountAccess,
        verifiedDriverPhoneE164,
        {
          activeRouteSession: restoredAccess.kind === 'active' || restoredAccess.kind === 'refresh_required'
            ? restoredAccess.activeRouteSession ?? null
            : null,
          allowVerifiedDriverNoRoute: true,
          navigateOnSuccess: false,
          resetProgress: false,
        },
      );
    } catch (error) {
      if (shouldDiscardSavedLoginAfterRefreshFailure(error)) {
        await clearAndStopActiveLocationSession();
        await driverAccessTokenStore.clear();
        resetRouteProgress();
        setVerifiedDriverPhoneE164(null);
        setRouteSyncState('idle');
        setScreen('loginPhone');
        setMessage('Your saved login expired. Sign in with your phone number and PIN.');
      } else {
        setRouteSyncState('error');
        setMessage('Routes could not be refreshed. Your login is still active.');
      }
    } finally {
      setIsRefreshingRoutes(false);
    }
  }, [
    clearAndStopActiveLocationSession,
    driverAccessTokenStore,
    getActiveAccountAccess,
    handleLoginAndLoadRoutes,
    isLoggingIn,
    isRefreshingRoutes,
    setScreen,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    if (!isDriverRestoreComplete || verifiedDriverPhoneE164 === null) {
      return undefined;
    }
    const task = requestIdleCallback(() => {
      void registerCurrentPushInstallation();
    });
    return () => cancelIdleCallback(task);
  }, [
    isDriverRestoreComplete,
    registerCurrentPushInstallation,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    const receiveRouteNotification = (data: DriverRouteNotificationData, openRequested: boolean) => {
      setPendingDriverRouteNotification({ data, openRequested, refreshRequired: true });
      if (verifiedDriverPhoneE164 !== null) {
        setMessage(isNavigationInterruptionProtected
          ? 'Route update received. Finish the current delivery action before routes refresh.'
          : 'Route update received. Refreshing assigned routes...');
      }
    };
    const removeReceivedListener = stopArrivalNotificationService.addDriverRouteNotificationReceivedListener(
      (data) => receiveRouteNotification(data, false),
    );
    const removeResponseListener = stopArrivalNotificationService.addDriverRouteNotificationResponseListener(
      (data) => receiveRouteNotification(data, true),
    );

    if (!hasCheckedInitialDriverRouteNotificationRef.current) {
      hasCheckedInitialDriverRouteNotificationRef.current = true;
      void Promise.all([
        stopArrivalNotificationService.consumePendingDriverRouteNotification(),
        stopArrivalNotificationService.getLastDriverRouteNotificationResponse(),
      ]).then(([backgroundData, responseData]) => {
        if (responseData !== null) {
          receiveRouteNotification(responseData, true);
        } else if (backgroundData !== null) {
          receiveRouteNotification(backgroundData, false);
        }
      });
    }

    return () => {
      removeReceivedListener();
      removeResponseListener();
    };
  }, [
    isNavigationInterruptionProtected,
    stopArrivalNotificationService,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    if (
      pendingDriverRouteNotification === null
      || verifiedDriverPhoneE164 === null
      || isRefreshingRoutes
      || isLoggingIn
      || isNavigationInterruptionProtected
    ) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (routeSyncState === 'idle') {
        void handleRefreshRoutes();
        return;
      }
      if (routeSyncState === 'error') {
        setPendingDriverRouteNotification(null);
        setMessage('A route update arrived, but the server refresh failed. Your current route was not replaced.');
        return;
      }
      if (routeSyncState !== 'ready') {
        return;
      }

      if (pendingDriverRouteNotification.refreshRequired) {
        setPendingDriverRouteNotification((current) => (
          current === pendingDriverRouteNotification
            ? { ...current, refreshRequired: false }
            : current
        ));
        void handleRefreshRoutes();
        return;
      }

      const { data, openRequested } = pendingDriverRouteNotification;
      const navigation = getDriverRouteNotificationNavigation({
        action: data.action,
        activeRoutePlanId,
        availableRoutePlanIds: routeSessions.map((session) => session.route.id),
        openRequested,
        routePlanId: data.routePlanId,
      });
      setPendingDriverRouteNotification(null);
      if (navigation === 'open_route') {
        const routeSession = getRouteSessionForAction(routeSessions, data.routePlanId);
        if (routeSession !== null) {
          setSelectedRouteId(routeSession.route.id);
          setSubmission(toCompanyGuidanceSubmission(routeSession));
          setScreen('routeSession');
        }
        setMessage(data.action === 'assigned' ? 'Assigned route loaded.' : 'Updated route loaded.');
        return;
      }
      if (navigation === 'active_route_protected') {
        setMessage('Routes refreshed. Your active route remains open; review the new assignment from My Routes.');
        return;
      }
      if (navigation === 'target_unavailable') {
        setMessage('Routes refreshed, but that assignment is no longer available.');
        return;
      }
      setMessage(
        data.action === 'cancelled' || data.action === 'released'
          ? 'Routes refreshed. The removed assignment is no longer shown.'
          : 'Assigned routes are up to date.',
      );
    }, 0);
    return () => clearTimeout(timeout);
  }, [
    activeRoutePlanId,
    handleRefreshRoutes,
    isLoggingIn,
    isRefreshingRoutes,
    isNavigationInterruptionProtected,
    pendingDriverRouteNotification,
    routeSessions,
    routeSyncState,
    setScreen,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    if (
      routeRecoveryRefreshReason === null
      || verifiedDriverPhoneE164 === null
      || isLoggingIn
      || isRefreshingRoutes
    ) {
      return;
    }

    const recoveryReason = routeRecoveryRefreshReason;
    const timeout = setTimeout(() => {
      setRouteRecoveryRefreshReason(null);
      void handleRefreshRoutes().finally(() => {
        if (recoveryReason === 'route_not_in_progress') {
          setMessage('Route ended or released on server. Unsynced delivery results were preserved for reconciliation.');
        } else if (recoveryReason === 'pickup_eta_snapshot_synced') {
          setMessage('Pickup synced. Route ETA refreshed.');
        }
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [
    handleRefreshRoutes,
    isLoggingIn,
    isRefreshingRoutes,
    routeRecoveryRefreshReason,
    verifiedDriverPhoneE164,
  ]);

  const retryPendingSubmissionsAfterNetworkRecovery = useCallback(async () => {
    return retryOfflineSubmissionsForSessions(routeSessions);
  }, [retryOfflineSubmissionsForSessions, routeSessions]);

  useEffect(() => {
    const previous = previousRouteSyncNetworkRef.current;
    previousRouteSyncNetworkRef.current = networkReachability;
    if (
      isDriverRestoreComplete
      && routeSyncState === 'error'
      && verifiedDriverPhoneE164 !== null
      && previous !== 'online'
      && networkReachability === 'online'
    ) {
      void handleRefreshRoutes();
    }
  }, [
    handleRefreshRoutes,
    isDriverRestoreComplete,
    networkReachability,
    routeSyncState,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    const previousNetworkReachability = previousNetworkReachabilityRef.current;
    previousNetworkReachabilityRef.current = networkReachability;
    if (
      !isDriverRestoreComplete
      || routeSessions.length === 0
      || !shouldRetryOfflineSubmissionsAfterNetworkChange({
        current: networkReachability,
        hasPendingSubmissions: offlineQueueCount > 0,
        previous: previousNetworkReachability,
      })
    ) {
      return;
    }

    void retryPendingSubmissionsAfterNetworkRecovery();
  }, [
    isDriverRestoreComplete,
    networkReachability,
    offlineQueueCount,
    retryPendingSubmissionsAfterNetworkRecovery,
    routeSessions.length,
  ]);

  useEffect(() => {
    if (!isDriverRestoreComplete || routeSessions.length === 0) return;

    const scheduler = createOfflineRetryScheduler({
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      hasPendingSubmissions: () => offlineSubmissionQueue?.listPending().some(
        (item) => item.reconciliation === undefined,
      ) === true,
      isForeground: () => AppState.currentState === 'active',
      isOnline: () => networkReachability === 'online',
      policy: { initialDelayMs: 15_000, jitterRatio: 0.2, maxDelayMs: 60_000 },
      retry: retryPendingSubmissionsAfterNetworkRecovery,
      schedule: (run, delayMs) => setTimeout(run, delayMs),
    });
    const subscription = AppState.addEventListener('change', () => scheduler.notifyConditionsChanged());
    scheduler.start();
    return () => {
      subscription.remove();
      scheduler.stop();
    };
  }, [
    isDriverRestoreComplete,
    networkReachability,
    offlineQueueCount,
    offlineSubmissionQueue,
    retryPendingSubmissionsAfterNetworkRecovery,
    routeSessions.length,
  ]);

  const handlePullRefresh = useCallback(async () => {
    if (isPullRefreshingRef.current) {
      return;
    }

    isPullRefreshingRef.current = true;
    pullRefreshOffset.value = withSpring(PULL_REFRESH_REVEAL_HEIGHT, PULL_REFRESH_SPRING_CONFIG);
    try {
      await Promise.all([
        handleRefreshRoutes(),
        checkForDriverAppUpdate(true, true),
      ]);
    } finally {
      pullRefreshOffset.value = withSpring(0, PULL_REFRESH_SPRING_CONFIG);
      isPullRefreshingRef.current = false;
    }
  }, [checkForDriverAppUpdate, handleRefreshRoutes, pullRefreshOffset]);

  const retryDriverRestore = useCallback(() => {
    if (isDriverRestoreComplete) {
      return;
    }
    setDriverRestoreProblem(null);
    setDriverRestoreAttempt((attempt) => attempt + 1);
  }, [isDriverRestoreComplete]);

  useEffect(() => {
    if (isDriverRestoreComplete) {
      return undefined;
    }

    let isMounted = true;
    const restoreWatchdog = setTimeout(() => {
      if (isMounted) {
        setDriverRestoreProblem('Session check is taking longer than expected. Try again.');
      }
    }, DRIVER_RESTORE_LOADING_TIMEOUT_MS);

    void (async () => {
      try {
        const result = await driverAccessTokenStore.loadActiveDriverAccess();
        if (!isMounted) {
          return;
        }
        if (result.kind === 'expired') {
          clearTimeout(restoreWatchdog);
          if (result.driverProfile !== undefined) {
            setNationalPhoneInput(result.driverProfile.phoneE164);
            setMessage('Your saved login expired. Enter your PIN to continue.');
          }
          setScreen('loginPhone');
          setIsDriverRestoreComplete(true);
          void clearAndStopActiveLocationSession();
          return;
        }
        if (result.kind !== 'active' && result.kind !== 'refresh_required') {
          clearTimeout(restoreWatchdog);
          setScreen('loginPhone');
          setIsDriverRestoreComplete(true);
          void clearAndStopActiveLocationSession();
          return;
        }

        let accountAccess = result.accountAccess;
        if (result.kind === 'refresh_required') {
          try {
            accountAccess = (await driverAuthService.refreshSession({
              refreshToken: result.accountAccess.refreshToken,
            })).accountAccess;
            await driverAccessTokenStore.saveRefreshedAccountAccess(accountAccess);
          } catch (error) {
            clearTimeout(restoreWatchdog);
            if (shouldDiscardSavedLoginAfterRefreshFailure(error)) {
              void driverAccessTokenStore.clear().catch(() => undefined);
              if (isMounted) {
                setNationalPhoneInput(result.driverProfile.phoneE164);
                setMessage('Your saved login expired. Enter your PIN to continue.');
                setScreen('loginPhone');
                setIsDriverRestoreComplete(true);
              }
              void clearAndStopActiveLocationSession();
              return;
            }

            if (isMounted) {
              setNationalPhoneInput(result.driverProfile.phoneE164);
              setDriverRestoreProblem('Your saved login is safe. Check your connection and try again.');
            }
            return;
          }
        }

        if (!isMounted) {
          return;
        }
        clearTimeout(restoreWatchdog);
        setNationalPhoneInput(result.driverProfile.phoneE164);
        setVerifiedDriverPhoneE164(result.driverProfile.phoneE164);
        setAcceptedPrivacy(true);
        setAcceptedLocation(true);
        setScreen('mainTabs');
        setIsDriverRestoreComplete(true);
        await handleLoginAndLoadRoutes(
          accountAccess,
          result.driverProfile.phoneE164,
          {
            activeRouteSession: result.activeRouteSession ?? null,
            allowVerifiedDriverNoRoute: true,
          },
        );
      } catch {
        clearTimeout(restoreWatchdog);
        if (isMounted) {
          setDriverRestoreProblem('Your saved login is safe. Check your connection and try again.');
        }
      }
    })();

    return () => {
      isMounted = false;
      clearTimeout(restoreWatchdog);
    };
  }, [
    clearAndStopActiveLocationSession,
    driverAccessTokenStore,
    driverAuthService,
    driverRestoreAttempt,
    handleLoginAndLoadRoutes,
    isDriverRestoreComplete,
    setScreen,
  ]);

  useEffect(() => {
    const previous = previousDriverRestoreNetworkRef.current;
    previousDriverRestoreNetworkRef.current = networkReachability;
    if (
      !isDriverRestoreComplete
      && driverRestoreProblem !== null
      && previous !== 'online'
      && networkReachability === 'online'
    ) {
      retryDriverRestore();
    }
  }, [driverRestoreProblem, isDriverRestoreComplete, networkReachability, retryDriverRestore]);

  useEffect(() => {
    const task = requestIdleCallback(() => {
      void checkForDriverAppUpdate(true);
    });
    return () => cancelIdleCallback(task);
  }, [checkForDriverAppUpdate]);

  useEffect(() => {
    const didReleaseActiveRoute = previousActiveRoutePlanIdRef.current !== null
      && activeRoutePlanId === null;
    previousActiveRoutePlanIdRef.current = activeRoutePlanId;
    if (didReleaseActiveRoute) {
      void checkForDriverAppUpdate(true);
    }
  }, [activeRoutePlanId, checkForDriverAppUpdate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkForDriverAppUpdate();
      }
      if (state === 'active' && verifiedDriverPhoneE164 !== null) {
        void refreshBackgroundLocationPermission();
        void registerCurrentPushInstallation();
      }
      if (state === 'active' && !isDriverRestoreComplete && driverRestoreProblem !== null) {
        retryDriverRestore();
        return;
      }
      if (
        state === 'active' &&
        isInitialRouteRestoreComplete &&
        !isStartingRoute &&
        screen === 'mainTabs' &&
        pendingActiveRouteNotificationTargetRef.current === null &&
        verifiedDriverPhoneE164 !== null
      ) {
        void handleRefreshRoutes();
      }
    });

    return () => subscription.remove();
  }, [
    checkForDriverAppUpdate,
    driverRestoreProblem,
    handleRefreshRoutes,
    isDriverRestoreComplete,
    isInitialRouteRestoreComplete,
    isStartingRoute,
    refreshBackgroundLocationPermission,
    registerCurrentPushInstallation,
    retryDriverRestore,
    screen,
    verifiedDriverPhoneE164,
  ]);

  useEffect(() => {
    if (isDriverRestoreComplete && screen === 'mainTabs' && verifiedDriverPhoneE164 !== null) {
      const task = requestIdleCallback(() => {
        void refreshBackgroundLocationPermission();
      });
      return () => cancelIdleCallback(task);
    }

    return undefined;
  }, [isDriverRestoreComplete, refreshBackgroundLocationPermission, screen, verifiedDriverPhoneE164]);

  function handleStartRoute(routeId?: string) {
    if (isStartingRoute || isFinishingRoute || pendingRoutePlanId !== null) {
      return;
    }
    if (backgroundLocationPermission !== 'granted') {
      setMessage('Choose Allow all the time before starting a route.');
      return;
    }
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to start.');
      return;
    }
    if (activeRoutePlanId !== null && activeRoutePlanId !== routeSession.route.id) {
      const targetRoutePlanId = routeSession.route.id;
      requestActiveRouteSwitchConfirmation({
        alertApi: {
          alert: showOperationalDialog,
        },
        onCancelCurrentDelivery: () => {
          setPendingRoutePlanId(targetRoutePlanId);
          if (currentStop === null) {
            if (selectedRoute === null) {
              setPendingRoutePlanId(null);
              setMessage('The active route is no longer available. Refresh routes and try again.');
              return;
            }
            void finishActiveRouteForSwitch(selectedRoute, targetRoutePlanId, true);
            return;
          }
          void handleTerminalStop(currentStop, 'failed', {
            failureNote: 'Driver cancelled the current delivery before switching routes.',
            failureReason: 'OTHER',
            switchToRoutePlanId: targetRoutePlanId,
          });
        },
        onCompleteCurrentDelivery: () => {
          if (currentStop === null) {
            setSelectedRouteId(activeRoutePlanId);
            setMessage('Complete Store Pickup before completing the current delivery.');
            return;
          }
          setPendingRoutePlanId(targetRoutePlanId);
          void (async () => {
            const arrivalOpened = await recordStopArrival(currentStop, 'mainTabs');
            if (!arrivalOpened) {
              setPendingRoutePlanId(null);
            }
          })();
        },
      });
      return;
    }
    if (routeSession.pendingRouteEnd !== undefined) {
      setMessage('This route is waiting for its final status to sync. Refresh routes before starting it again.');
      return;
    }

    requestRouteStartSessionConfirmation({
      alertApi: {
        alert: showOperationalDialog,
      },
      route: {
        deliveryDate: routeSession.route.deliveryDate,
        timezone: routeSession.route.timezone,
      },
      onConfirm: () => {
        void startRouteSessionAfterConfirmed(routeSession.route.id);
      },
    });
  }

  async function startRouteSessionAfterConfirmed(routeId?: string) {
    if (isStartingRoute || isFinishingRoute) {
      return;
    }
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to start.');
      return;
    }
    if (routeSession.pendingRouteEnd !== undefined) {
      setMessage('This route is waiting for its final status to sync. Refresh routes before starting it again.');
      return;
    }

    const requestScreen = screenRef.current;
    const activeSubmission = toCompanyGuidanceSubmission(routeSession);
    const routeAccessSaved = await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(activeSubmission));
    if (!routeAccessSaved) {
      setMessage('Another route is already active. Finish it before starting this route.');
      return;
    }
    resetActiveRouteProgress();
    setSelectedRouteId(routeSession.route.id);
    setSubmission(activeSubmission);
    setIsStartingRoute(true);
    setMessage(null);

    try {
      const deliveryStart = await startDeliveryWithForegroundPermission({
        flowState: 'route_ready',
        permissionService: foregroundLocationPermissionService,
      });
      setDeliveryStartResult(deliveryStart);

      if (deliveryStart.kind !== 'delivery_active') {
        setMessage(deliveryStart.message);
        return;
      }

      const notificationRegistration = await stopArrivalNotificationService.registerForStopArrivalNotifications();
      const backgroundPermission = await requestContinuousLocationBackgroundPermission({
        streamService: continuousLocationStreamService,
      });
      if (backgroundPermission.kind === 'blocked') {
        setContinuousLocationResult(backgroundPermission);
        setDeliveryStartResult(null);
        setMessage(backgroundPermission.message);
        return;
      }

      const routeStartedAt = new Date();
      const initialStepIndex = COMPANY_STEP_INDEX;
      const activeRouteSaved = await driverAccessTokenStore.saveActiveRouteSession({
        completedStopIds: [],
        navigationStepIndex: initialStepIndex,
        routePlanId: routeSession.route.id,
        startedAt: routeStartedAt.toISOString(),
      });
      if (!activeRouteSaved) {
        setDeliveryStartResult(null);
        setMessage('Route access changed before tracking could start. Refresh routes and try again.');
        return;
      }
      setActiveRoutePlanId(routeSession.route.id);
      const continuousResult = await startContinuousLocationUpdatesAfterDeliveryStart({
        deliveryStart,
        notification: buildActiveRouteForegroundNotification({
          currentStepIndex: initialStepIndex,
          route: routeSession.route,
        }),
        routePlanId: routeSession.route.id,
        streamService: continuousLocationStreamService,
      });
      setContinuousLocationResult(continuousResult);
      if (continuousResult.kind === 'blocked') {
        await clearAndStopActiveLocationSession(routeSession.route.id);
        setDeliveryStartResult(null);
        setMessage(continuousResult.message);
        return;
      }

      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const eventService = createRouteOrderedDriverEventService({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          refreshDriverAccess: buildDriverAccessRefresh(activeSubmission),
          runtimeConfig,
          submission: activeSubmission,
        }),
        queue,
        routePlanId: routeSession.route.id,
      });
      const routeStartedResult = await recordRouteStartedAfterDeliveryStart({
        deliveryStart,
        driverEventService: eventService,
        occurredAt: routeStartedAt,
        offlineQueue: queue,
        routePlanId: routeSession.route.id,
      });
      setRouteStartedEventResult(routeStartedResult);
      if (routeStartedResult.kind === 'recorded') {
        const marked = await driverAccessTokenStore.markActiveRouteStarted(
          routeSession.route.id,
          routeStartedAt.toISOString(),
        ).catch((error) => {
          const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
          console.warn(`[location] Route start acknowledgement could not be saved: ${errorMessage}`);
          return null;
        });
        if (marked === false) {
          throw new Error('Active route changed before route start acknowledgement was saved.');
        }
      } else if (routeStartedResult.kind === 'queued') {
        await queue.whenPersisted();
      }

      setNavigationStepIndex(initialStepIndex);
      if (screenRef.current === requestScreen) {
        setScreen('routeSession');
      } else if (notificationRegistration.kind === 'registered') {
        setMessage('Route started. Open it from My Routes to continue.');
      }
      if (notificationRegistration.kind !== 'registered') {
        setMessage(notificationRegistration.message);
      }
    } catch (error) {
      await clearAndStopActiveLocationSession(routeSession.route.id);
      setDeliveryStartResult(null);
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      setMessage(`Route session could not start: ${errorMessage}`);
    } finally {
      setIsStartingRoute(false);
      refreshOfflineQueueCount();
    }
  }

  function handleOpenRouteSession(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route session is available to continue.');
      return;
    }
    if (activeRoutePlanId !== null && activeRoutePlanId !== routeSession.route.id) {
      setSelectedRouteId(activeRoutePlanId);
      setMessage('Continue the active route before opening another route session.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setScreen('routeSession');
  }

  function handleDeleteActiveRoute(routeId: string) {
    if (activeRoutePlanId !== routeId) {
      setMessage('Only the active route can be deleted.');
      return;
    }

    requestActiveRouteDeletionConfirmation({
      alertApi: {
        alert: showOperationalDialog,
      },
      onConfirm: () => {
        void deleteActiveRouteAfterConfirmed(routeId);
      },
    });
  }

  async function deleteActiveRouteAfterConfirmed(routeId: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId);
    if (routeSession === null || activeRoutePlanId !== routeId) {
      setMessage('The active route changed before it could be deleted. Refresh routes and try again.');
      return;
    }

    const occurredAt = new Date();
    const routeSubmission = toCompanyGuidanceSubmission(routeSession);
    setSelectedRouteId(routeId);
    setSubmission(routeSubmission);
    setIsDeletingRoute(true);
    try {
      await finishRoute(routeSession.route, {
        eventPayload: createDriverReleasedRoutePayload({
          deliveryDate: routeSession.route.deliveryDate,
          occurredAt,
          routeName: routeSession.route.name,
          routePlanId: routeId,
          shopDomain: routeSession.companyGuidance.shopDomain,
        }),
        now: occurredAt,
        returnToRoutes: true,
        routeEnd: 'released',
        routeSubmission,
      });
    } finally {
      setIsDeletingRoute(false);
    }
  }

  async function handleCallStop(stop: AssignedRouteStop | null) {
    const phone = stop?.phone?.trim();
    if (phone === undefined || phone.length === 0) {
      setMessage('No contact number is available for this stop.');
      return;
    }

    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      setMessage('The phone app could not be opened.');
    }
  }

  async function handleMessageStop(stop: AssignedRouteStop | null) {
    const phone = stop?.phone?.trim();
    if (phone === undefined || phone.length === 0) {
      setMessage('No contact number is available for this stop.');
      return;
    }

    try {
      await Linking.openURL(`sms:${phone}`);
    } catch {
      setMessage('The messaging app could not be opened.');
    }
  }

  async function handleCopyAddress(address: string) {
    try {
      await Clipboard.setStringAsync(address);
      setMessage('Address copied.');
    } catch {
      setMessage('Address could not be copied.');
    }
  }

  function handleAnnounceCurrentTip() {
    handleAnnounceNavigationTip({ isCompanyStep, stop: currentStop });
  }

  function handleAnnounceNavigationTip(input: { isCompanyStep: boolean; stop: AssignedRouteStop | null }) {
    const text = getNavigationTip({ company: currentCompany, isCompanyStep: input.isCompanyStep, stop: input.stop });
    Speech.stop();
    Speech.speak(text, { language: 'en-CA', rate: 0.94 });
    setMessage(`Voice tip: ${text}`);
  }

  async function handleArrivedAtStep() {
    if (selectedRoute === null) {
      return;
    }

    if (isCompanyStep) {
      if (deliveryStartResult === null) {
        setMessage('Start the route before confirming pickup.');
        return;
      }
      const requestScreen = screenRef.current;
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }

      if (selectedRouteSession === null) {
        setMessage('Route context was not available for pickup completion. Refresh routes and try again.');
        return;
      }
      const routeSubmission = toCompanyGuidanceSubmission(selectedRouteSession);
      const result = await recordPickupCompletedAfterDeliveryStart({
        deliveryStart: deliveryStartResult,
        driverEventService: createRouteOrderedDriverEventService({
          driverEventService: getDriverEventServiceForCurrentSubmission({
            fallback: mockDriverEventService,
            refreshDriverAccess: buildDriverAccessRefresh(routeSubmission),
            runtimeConfig,
            submission: routeSubmission,
          }),
          queue,
          routePlanId: selectedRoute.id,
        }),
        offlineQueue: queue,
        routePlanId: selectedRoute.id,
      });
      if (result.kind === 'recorded' && result.etaSnapshot !== undefined) {
        applyEtaSnapshotToRoute(selectedRoute.id, result.etaSnapshot);
      }
      if (result.kind === 'recorded' && result.etaUpdate !== undefined) {
        applyEtaUpdateToRoute(selectedRoute.id, result.etaUpdate);
      }

      const pickupProgress = getAssignedRouteProgressAfterPickup(selectedRoute);
      const pickupStop = selectedRoute.stops[pickupProgress.navigationStepIndex - 1];
      const pickupStopLabel = pickupStop === undefined ? 'the next stop' : `Stop ${pickupStop.sequence}`;
      let pickupMessage = `Store Pickup completed. Continue to ${pickupStopLabel}.`;
      if (result.kind === 'queued') {
        await queue.whenPersisted();
        pickupMessage = `Store Pickup saved offline. Continue to ${pickupStopLabel} while syncing.`;
        if (result.requiresRouteLookup === true) {
          setRouteRecoveryRefreshReason('driver_access_expired');
          pickupMessage = 'Store Pickup saved offline. Driver access expired, so route assignments are refreshing.';
        }
      } else if (result.kind === 'blocked') {
        setMessage(result.message);
        return;
      }

      const pickupCompleted = await driverAccessTokenStore.saveActiveRouteSession({
        completedStopIds: pickupProgress.completedStopIds,
        navigationStepIndex: pickupProgress.navigationStepIndex,
        pickupCompleted: true,
        routePlanId: selectedRoute.id,
      });
      if (!pickupCompleted) {
        setMessage('Store Pickup could not be confirmed. Refresh the route and try again.');
        return;
      }
      setCompletedStopIds(pickupProgress.completedStopIds);
      setNavigationStepIndex(pickupProgress.navigationStepIndex);
      if (screenRef.current === requestScreen) {
        setScreen('routeSession');
      }
      setMessage(pickupMessage);
      return;
    }

    if (currentStop === null) {
      setMessage('The active delivery stop could not be confirmed. Refresh the route and try again.');
      return;
    }

    await recordStopArrival(currentStop, 'routeSession');
  }

  async function activateAndRecordStopArrival(selectedStop: AssignedRouteStop) {
    const requestScreen = screenRef.current;
    if (
      selectedRoute === null
      || activeRoutePlanId !== selectedRoute.id
      || deliveryStartResult?.kind !== 'delivery_active'
    ) {
      setMessage('Start the route and complete Store Pickup before changing the stop order.');
      return;
    }
    const selectedStopIndex = selectedRoute.stops.findIndex(
      (candidate) => candidate.deliveryStopId === selectedStop.deliveryStopId,
    );
    if (selectedStopIndex < 0 || isStopCompleted(selectedStop, completedStopIds)) {
      setMessage('This stop is no longer available as an active delivery task.');
      return;
    }

    const activeRouteSaved = await driverAccessTokenStore.saveActiveRouteSession({
      completedStopIds,
      navigationStepIndex: selectedStopIndex + 1,
      routePlanId: selectedRoute.id,
    });
    if (!activeRouteSaved) {
      setMessage('The selected stop could not be saved. Refresh the route and try again.');
      return;
    }

    setNavigationStepIndex(selectedStopIndex + 1);
    setSelectedStopDetailsId(selectedStop.deliveryStopId);
    setStopDetailsReturnScreen('routeSession');
    await recordStopArrival(selectedStop, 'stopDetails', requestScreen);
  }

  function handleOpenStopFromRouteSession(stop: AssignedRouteStop) {
    if (selectedRoute === null) {
      setMessage('No route is available to review.');
      return;
    }

    const selectedStop = selectedRoute.stops.find((candidate) => candidate.deliveryStopId === stop.deliveryStopId);
    if (selectedStop === undefined) {
      setMessage('This stop is no longer available on the selected route.');
      return;
    }

    setSelectedStopDetailsId(selectedStop.deliveryStopId);
    setStopDetailsReturnScreen('routeSession');
    setScreen('stopDetails');
  }

  function handleArriveFromStopDetails() {
    if (selectedRoute === null || stopDetailsStop === null) {
      setMessage('This stop is no longer available on the selected route.');
      return;
    }
    if (!canArriveFromStopDetails) {
      setMessage('Complete Store Pickup and start an active delivery before recording arrival.');
      return;
    }

    const selectedStop = stopDetailsStop;
    const warning = buildOutOfOrderStopArrivalWarning({
      completedStopIds,
      navigationStepIndex,
      route: selectedRoute,
      selectedStopId: selectedStop.deliveryStopId,
    });
    if (warning !== null) {
      showOperationalDialog(warning.title, warning.message, [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => { void activateAndRecordStopArrival(selectedStop); },
          text: 'Arrive',
        },
      ], { cancelable: true });
      return;
    }

    if (currentStop?.deliveryStopId === selectedStop.deliveryStopId) {
      void recordStopArrival(selectedStop, 'stopDetails');
      return;
    }
    void activateAndRecordStopArrival(selectedStop);
  }

  function handleSkipStopFromDetails() {
    if (selectedRoute === null || stopDetailsStop === null) {
      setMessage('This stop is no longer available on the selected route.');
      return;
    }
    if (!canSkipFromStopDetails) {
      setMessage('Start an active delivery before skipping a stop.');
      return;
    }

    const selectedStop = stopDetailsStop;
    showOperationalDialog(
      'Skip this stop?',
      'This stop will be marked as skipped and the administrator will be notified.',
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => { void handleTerminalStop(selectedStop, 'failed'); },
          style: 'destructive',
          text: 'Skip Stop',
        },
      ],
      { cancelable: true },
    );
  }

  async function handleOpenRouteNavigation(route: AssignedRoute | null) {
    if (route === null) {
      setMessage('No route is available to open in map.');
      return;
    }

    const result = await openRouteNavigation({
      linking: Linking,
      route,
    });
    setMessage(result.message);
  }

  async function handleOpenNavigationForStop(stop: AssignedRouteStop | null) {
    if (stop === null || selectedRoute === null) {
      setMessage('No stop is available to open in map.');
      return;
    }

    const result = await openStopNavigation({
      linking: Linking,
      platform: Platform.OS,
      stop,
    });
    setMessage(result.message);
  }

  async function handleProofPhotoResult(input: {
    captureResult: ProofPhotoCaptureResult;
    route: AssignedRoute;
    stop: AssignedRouteStop;
  }) {
    const { captureResult, route, stop } = input;
    if (captureResult.kind !== 'captured') {
      if (captureResult.kind === 'permission_denied') {
        setMessage(captureResult.message);
      }
      return;
    }

    setProofPhotoResults((current) => ({ ...current, [stop.deliveryStopId]: captureResult }));

    const uploadRequest = {
      deliveryStopId: stop.deliveryStopId,
      fileName: getFileNameFromUri(captureResult.kind === 'captured' ? captureResult.uri : '', stop.deliveryStopId),
      routePlanId: route.id,
    };

    const uploadResult = await uploadCapturedProofPhoto({
      captureResult,
      uploadRequest,
      uploadService: getProofMediaUploadServiceForCurrentSubmission({
        fallback: mockProofMediaUploadService,
        refreshDriverAccess: buildDriverAccessRefresh(submission),
        runtimeConfig,
        submission,
      }),
    });
    setProofMediaResults((current) => ({ ...current, [stop.deliveryStopId]: uploadResult }));

    if (uploadResult.kind === 'upload_failed') {
      console.warn(`[proof-media] ${uploadResult.message}`);
    }

    const requiresRouteReconciliation = uploadResult.kind === 'upload_failed'
      && uploadResult.reason === 'route_not_in_progress';
    if (shouldQueueFailedProofMediaUpload(uploadResult) && captureResult.kind === 'captured') {
      try {
        const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
        if (offlineSubmissionQueue === null) {
          setOfflineSubmissionQueue(queue);
        }
        queue.enqueueProofMediaUpload({
          deliveryStopId: stop.deliveryStopId,
          fileName: getFileNameFromUri(captureResult.uri, stop.deliveryStopId),
          routePlanId: route.id,
          source: captureResult.source,
          uri: captureResult.uri,
        });
        if (requiresRouteReconciliation) {
          queue.blockRouteSubmissionsForReconciliation(route.id);
        }
        await queue.whenPersisted();
        syncOfflineQueueState(queue);
        if (requiresRouteReconciliation) {
          await clearAndStopActiveLocationSession(route.id);
          setActiveRoutePlanId(null);
          setDeliveryStartResult(null);
          setContinuousLocationResult({
            kind: 'stopped',
            taskName: CONTINUOUS_LOCATION_TASK_NAME,
          });
          setScreen('mainTabs');
          setRouteRecoveryRefreshReason('route_not_in_progress');
          setMessage('Route ended or released on server. The unsynced proof was preserved for reconciliation.');
          return;
        }
      } catch {
        setMessage('Photo upload failed and offline retry storage is unavailable. Keep the app open and try the photo again.');
        return;
      }
    }

    const photoMessage = formatPhotoResult(captureResult, uploadResult);
    if (photoMessage !== null) {
      setMessage(photoMessage);
    }
  }

  async function handleCapturePhoto(source: ProofPhotoCaptureSource) {
    if (currentStop === null || selectedRoute === null) {
      return;
    }

    const stop = currentStop;
    const route = selectedRoute;
    setIsCapturingPhoto(true);
    setMessage(null);

    try {
      const captureResult = await captureProofPhoto({ captureService: proofPhotoCaptureService, source });
      await handleProofPhotoResult({ captureResult, route, stop });
    } finally {
      setIsCapturingPhoto(false);
      refreshOfflineQueueCount();
    }
  }

  async function handleCapturedCameraPhoto(uri: string) {
    if (currentStop === null || selectedRoute === null) {
      setScreen('arrivalCheck');
      return;
    }

    const stop = currentStop;
    const route = selectedRoute;
    setScreen('arrivalCheck');
    setIsCapturingPhoto(true);
    setMessage(null);

    try {
      await handleProofPhotoResult({
        captureResult: { kind: 'captured', source: 'camera', uri },
        route,
        stop,
      });
    } finally {
      setIsCapturingPhoto(false);
      refreshOfflineQueueCount();
    }
  }

  function handleAddDeliveryPhoto() {
    setIsPhotoActionSheetVisible(true);
  }

  function handleDismissPhotoActionSheet() {
    setIsPhotoActionSheetVisible(false);
  }

  function handleSelectPhotoSource(source: ProofPhotoCaptureSource) {
    setIsPhotoActionSheetVisible(false);
    if (source === 'camera') {
      setScreen('proofCamera');
      return;
    }

    void handleCapturePhoto(source);
  }

  async function handleCompleteCurrentStop() {
    if (currentStop === null) {
      return;
    }
    await handleTerminalStop(currentStop, 'delivered');
  }

  async function handleTerminalStop(
    stop: AssignedRouteStop,
    action: 'delivered' | 'failed',
    options?: {
      failureNote?: string;
      failureReason?: StopProofFailureReason;
      openNextNavigation?: boolean;
      switchToRoutePlanId?: string;
    },
  ) {
    const routeSwitchPlanId = options?.switchToRoutePlanId ?? pendingRoutePlanId;
    if (selectedRoute === null || deliveryStartResult === null) {
      if (routeSwitchPlanId !== null) {
        setPendingRoutePlanId(null);
      }
      return;
    }

    const isRouteSwitch = routeSwitchPlanId !== null;
    const isSkipped = action === 'failed' && !isRouteSwitch;
    const photoResult = proofPhotoResults[stop.deliveryStopId];
    const mediaResult = proofMediaResults[stop.deliveryStopId];
    const requestScreen = screenRef.current;

    setIsCompletingStop(true);
    setMessage(null);

    try {
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const draft = getProofDraft(proofDrafts[stop.deliveryStopId]);
      const result = await recordStopProofEventAfterDeliveryStart({
        deliveryStart: deliveryStartResult,
        driverEventService: createRouteOrderedDriverEventService({
          driverEventService: getDriverEventServiceForCurrentSubmission({
            fallback: mockDriverEventService,
            refreshDriverAccess: buildDriverAccessRefresh(submission),
            runtimeConfig,
            submission,
          }),
          queue,
          routePlanId: selectedRoute.id,
        }),
        input: {
          action,
          deliveryStopId: stop.deliveryStopId,
          media: mediaResult?.kind === 'uploaded' ? [mediaResult.media] : [],
          note: options?.failureNote ?? (isSkipped
            ? 'Pickup order was incorrectly included in the delivery route.'
            : formatStopProofNote(draft)),
          photoUris: photoResult?.kind === 'captured' ? [photoResult.uri] : [],
          ...(action !== 'failed'
            ? {}
            : isRouteSwitch
              ? { reason: options?.failureReason ?? ('OTHER' as const) }
              : { reason: 'ADMIN_ROUTE_ASSIGNMENT_ERROR' as const }),
          routePlanId: selectedRoute.id,
        },
        offlineQueue: queue,
      });
      setStopProofResults((current) => ({ ...current, [stop.deliveryStopId]: result }));

      if (result.kind === 'blocked') {
        if (isRouteSwitch) {
          setPendingRoutePlanId(null);
        }
        setMessage(result.message);
        return;
      }
      if (result.kind === 'queued' && result.requiresRouteReconciliation === true) {
        setPendingRoutePlanId(null);
        await clearAndStopActiveLocationSession(selectedRoute.id);
        syncOfflineQueueState(queue);
        setActiveRoutePlanId(null);
        setDeliveryStartResult(null);
        setContinuousLocationResult({
          kind: 'stopped',
          taskName: CONTINUOUS_LOCATION_TASK_NAME,
        });
        setScreen('mainTabs');
        setRouteRecoveryRefreshReason('route_not_in_progress');
        setMessage('Route ended or released on server. Unsynced delivery results were preserved for reconciliation.');
        return;
      }
      if (result.kind === 'queued' && result.requiresRouteLookup === true) {
        setPendingRoutePlanId(null);
        setRouteRecoveryRefreshReason('driver_access_expired');
        setMessage('Driver access expired. Refreshing route assignments while this stop remains queued.');
        return;
      }

      const nextCompletedStopIds = [...new Set([...completedStopIds, stop.deliveryStopId])];
      setCompletedStopIds(nextCompletedStopIds);
      if (result.kind === 'recorded') {
        setServerConfirmedStopIds((current) => [...new Set([...current, stop.deliveryStopId])]);
      }
      setCompletedStopTimes((current) => ({
        ...current,
        [stop.deliveryStopId]: formatLocalCompletedTime(new Date()),
      }));

      if (routeSwitchPlanId !== null) {
        const remainingStops = selectedRoute.stops.some(
          (routeStop) => !nextCompletedStopIds.includes(routeStop.deliveryStopId),
        );
        await finishActiveRouteForSwitch(selectedRoute, routeSwitchPlanId, remainingStops);
        return;
      }

      const isLastStop = selectedRoute.stops.every((stop) => nextCompletedStopIds.includes(stop.deliveryStopId));
      if (isLastStop) {
        await finishRoute(selectedRoute);
        return;
      }

      const nextNavigationStepIndex = getNextIncompleteRouteStepIndex({
        completedStopIds: nextCompletedStopIds,
        currentStopId: stop.deliveryStopId,
        route: selectedRoute,
      });
      if (nextNavigationStepIndex === null) {
        if (screenRef.current === requestScreen) {
          setScreen('routeSession');
        }
        setMessage(
          isSkipped
            ? 'Stop skipped and reported. Select the next incomplete stop from the list.'
            : 'Stop completed. Select the next incomplete stop from the list.',
        );
        return;
      }
      const activeRouteSaved = await driverAccessTokenStore.saveActiveRouteSession({
        completedStopIds: nextCompletedStopIds,
        navigationStepIndex: nextNavigationStepIndex,
        routePlanId: selectedRoute.id,
      });
      if (!activeRouteSaved) {
        setScreen('mainTabs');
        setMessage('The active route changed before the next stop could be saved. Refresh routes before continuing.');
        return;
      }
      setNavigationStepIndex(nextNavigationStepIndex);
      if (screenRef.current === requestScreen) {
        setScreen('routeSession');
      }
      const nextStop = selectedRoute.stops[nextNavigationStepIndex - 1] ?? null;
      if (options?.openNextNavigation === true && nextStop !== null) {
        if (continuousLocationStreamService.updateLocationNotification !== undefined) {
          try {
            await continuousLocationStreamService.updateLocationNotification({
              notification: buildActiveRouteForegroundNotification({
                currentStepIndex: nextNavigationStepIndex,
                route: selectedRoute,
              }),
              taskName: CONTINUOUS_LOCATION_TASK_NAME,
            });
          } catch (error) {
            const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
            console.warn(`[location] Route notification could not be updated before navigation: ${errorMessage}`);
          }
        }
        await handleOpenNavigationForStop(nextStop);
        return;
      }
      setMessage(
        isSkipped
          ? 'Stop skipped and reported to the administrator. Next stop is ready.'
          : 'Stop completed. Next stop is ready.',
      );
    } catch (error) {
      if (isRouteSwitch) {
        setPendingRoutePlanId(null);
      }
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      setMessage(`${isSkipped ? 'Stop skip' : 'Stop completion'} could not be saved: ${errorMessage}`);
    } finally {
      setIsCompletingStop(false);
      refreshOfflineQueueCount();
    }
  }

  completeStopFromNotificationRef.current = async (data) => {
    if (
      selectedRoute?.id !== data.routePlanId
      || currentStop?.deliveryStopId !== data.deliveryStopId
      || completedStopIds.includes(data.deliveryStopId)
    ) {
      setMessage('The arrival alert is no longer for the current stop. No stop was completed.');
      return;
    }
    await handleTerminalStop(currentStop, 'delivered', { openNextNavigation: true });
  };

  async function finishActiveRouteForSwitch(
    activeRoute: AssignedRoute,
    targetRoutePlanId: string,
    hasRemainingStops: boolean,
  ): Promise<void> {
    const targetRouteSession = getRouteSessionForAction(routeSessions, targetRoutePlanId);
    const activeRouteSession = getRouteSessionForAction(routeSessions, activeRoute.id);
    if (targetRouteSession === null || activeRouteSession === null) {
      setPendingRoutePlanId(null);
      setMessage('The selected route is no longer available. Refresh routes and try again.');
      return;
    }

    const occurredAt = new Date();
    const routeSubmission = toCompanyGuidanceSubmission(activeRouteSession);
    const routeEnded = await finishRoute(activeRoute, hasRemainingStops
      ? {
          eventPayload: createDriverReleasedRoutePayload({
            deliveryDate: activeRoute.deliveryDate,
            occurredAt,
            routeName: activeRoute.name,
            routePlanId: activeRoute.id,
            shopDomain: activeRouteSession.companyGuidance.shopDomain,
          }),
          now: occurredAt,
          returnToRoutes: true,
          routeEnd: 'released',
          routeSubmission,
        }
      : undefined);
    if (!routeEnded) {
      setPendingRoutePlanId(null);
      return;
    }

    setPendingRoutePlanId(null);
    await startRouteSessionAfterConfirmed(targetRoutePlanId);
  }

  async function finishRoute(route: AssignedRoute, options?: {
    eventPayload?: Record<string, unknown>;
    now?: Date;
    returnToRoutes?: boolean;
    routeEnd?: 'completed' | 'released';
    routeSubmission?: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }>;
  }): Promise<boolean> {
    if (deliveryStartResult?.kind !== 'delivery_active') {
      return false;
    }

    let routeSessionDeactivated = false;
    setIsFinishingRoute(true);
    try {
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      if (offlineSubmissionQueue === null) {
        setOfflineSubmissionQueue(queue);
      }
      const finishResult = await finishDeliveryAfterActive({
        deactivateActiveRouteSession: async () => {
          const cleared = await driverAccessTokenStore.clearActiveRouteSession(route.id);
          if (cleared) {
            routeSessionDeactivated = true;
            setActiveRoutePlanId(null);
          }
          return cleared;
        },
        deliveryStart: deliveryStartResult,
        driverEventService: createRouteOrderedDriverEventService({
          driverEventService: getDriverEventServiceForCurrentSubmission({
            fallback: mockDriverEventService,
            refreshDriverAccess: buildDriverAccessRefresh(options?.routeSubmission ?? submission),
            runtimeConfig,
            submission: options?.routeSubmission ?? submission,
          }),
          queue,
          routePlanId: route.id,
        }),
        ...(options?.eventPayload === undefined ? {} : { eventPayload: options.eventPayload }),
        ...(options?.now === undefined ? {} : { now: options.now }),
        offlineQueue: queue,
        routeEnd: options?.routeEnd,
        routePlanId: route.id,
        streamService: continuousLocationStreamService,
      });
      setDeliveryFinishResult(finishResult);
      if (finishResult.kind === 'blocked') {
        setMessage(finishResult.message);
        return false;
      }
      if (finishResult.kind === 'queued' && finishResult.requiresRouteReconciliation === true) {
        syncOfflineQueueState(queue);
        setDeliveryStartResult(null);
        setScreen('mainTabs');
        setRouteRecoveryRefreshReason('route_not_in_progress');
        setMessage('Route ended or released on server. Unsynced delivery results were preserved for reconciliation.');
        return false;
      }
      if (finishResult.kind === 'queued') {
        setRouteSessions((current) => current.map((session): RouteSession => session.route.id === route.id
          ? {
              ...session,
              pendingRouteEnd: options?.routeEnd === 'released' ? 'released' : 'completed',
            }
          : session));
      }
      setContinuousLocationResult({ kind: 'stopped', taskName: finishResult.stoppedTaskName });
      if (options?.returnToRoutes === true) {
        const readyRouteSessions = routeSessions.map((session): RouteSession => session.route.id === route.id
          ? {
              ...session,
              companyGuidance: {
                ...session.companyGuidance,
                executionStatus: 'READY',
              },
              ...(finishResult.kind === 'queued' ? { pendingRouteEnd: 'released' as const } : {}),
            }
          : session);
        const readyRouteSession = readyRouteSessions.find((session) => session.route.id === route.id) ?? null;
        setRouteSessions(readyRouteSessions);
        setSelectedRouteId(route.id);
        setSubmission(readyRouteSession === null ? null : toCompanyGuidanceSubmission(readyRouteSession));
        setDeliveryStartResult(null);
        setDeliveryFinishResult(null);
        setCompletedStopIds([]);
        setCompletedStopTimes({});
        setNavigationStepIndex(COMPANY_STEP_INDEX);
        setScreen('mainTabs');
        setMessage(finishResult.kind === 'recorded'
          ? 'Route session deleted. Route returned to Ready.'
          : 'Route session deleted locally. Returning the route to Ready is queued.');
      } else {
        setScreen('completedDeliveries');
        setMessage(finishResult.message);
      }
      return true;
    } catch (error) {
      if (routeSessionDeactivated) {
        try {
          await continuousLocationStreamService.stopLocationUpdates(CONTINUOUS_LOCATION_TASK_NAME);
        } catch {
          // The durable route-end event remains queued for recovery.
        }
        setDeliveryStartResult(null);
        setScreen('mainTabs');
      }
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      setMessage(`Route completion could not be finalized: ${errorMessage}`);
      return false;
    } finally {
      setIsFinishingRoute(false);
      refreshOfflineQueueCount();
    }
  }

  async function handleManualFinishRoute() {
    if (selectedRoute === null) {
      return;
    }

    await finishRoute(selectedRoute);
  }

  function updateCurrentStopDraft(patch: Partial<StopProofDraft>) {
    if (currentStop === null) {
      return;
    }

    setProofDrafts((current) => ({
      ...current,
      [currentStop.deliveryStopId]: {
        ...getProofDraft(current[currentStop.deliveryStopId]),
        ...patch,
      },
    }));
  }

  function resetRouteProgress() {
    registerContinuousLocationTaskObserver(null);
    setRouteSessions([]);
    setConsentSubmission(null);
    resetActiveRouteProgress();
    setSelectedRouteId(null);
  }

  function resetActiveRouteProgress() {
    setDeliveryStartResult(null);
    setDeliveryFinishResult(null);
    setActiveRoutePlanId(null);
    setPendingRoutePlanId(null);
    setRouteStartedEventResult(null);
    setContinuousLocationResult(null);
    notifiedStopArrivalIdsRef.current.clear();
    isRecordingArrivalRef.current = false;
    setIsRecordingArrival(false);
    setPendingStopArrivalNotification(null);
    setPendingStopArrivalCompletion(null);
    setStopArrivalProximityByStopId({});
    setStopProofResults({});
    setProofDrafts({});
    setProofPhotoResults({});
    setProofMediaResults({});
    setCompletedStopIds([]);
    setServerConfirmedStopIds([]);
    setCompletedStopTimes({});
    setNavigationStepIndex(COMPANY_STEP_INDEX);
    setSelectedStopDetailsId(null);
    setArrivalCheckReturnScreen('routeSession');
  }

  function refreshOfflineQueueCount() {
    syncOfflineQueueState(offlineSubmissionQueue);
  }

  async function handleLogout() {
    setMessage(null);
    const registeredDevicePushToken = registeredDevicePushTokenRef.current
      ?? await stopArrivalNotificationService.getDevicePushToken().catch(() => null);
    if (registeredDevicePushToken !== null && runtimeConfig.mode === 'live') {
      const accountAccess = await getActiveAccountAccess().catch(() => null);
      if (accountAccess !== null) {
        await driverAuthService.revokePushInstallation({
          accountAccessToken: accountAccess.accessToken,
          devicePushToken: registeredDevicePushToken,
        }).catch(() => undefined);
      }
    }
    registeredDevicePushTokenRef.current = null;
    await clearAndStopActiveLocationSession();
    try {
      const queue = offlineSubmissionQueue ?? await getExpoOfflineSubmissionQueue();
      const resetResult = await resetDriverSession({
        driverAccessTokenStore,
        offlineQueue: queue,
      });
      setMessage(resetResult.sealedOfflineSubmissions > 0
        ? `Signed out. Preserved ${resetResult.sealedOfflineSubmissions} unsynced evidence item${resetResult.sealedOfflineSubmissions === 1 ? '' : 's'} for account-isolated reconciliation.`
        : resetResult.clearedOfflineSubmissions > 0
          ? `Signed out. Removed ${resetResult.clearedOfflineSubmissions} transient location sample${resetResult.clearedOfflineSubmissions === 1 ? '' : 's'}; no ordered delivery evidence was pending.`
          : 'Signed out. No unsynced delivery evidence was pending.');
    } catch {
      await driverAccessTokenStore.clear();
      setMessage('Signed out. Offline evidence storage could not be sealed; contact support before signing in with another account.');
    }

    resetRouteProgress();
    setPendingDriverRouteNotification(null);
    hasCheckedInitialDriverRouteNotificationRef.current = false;
    setRouteSyncState('idle');
    setLastRoutesUpdatedAt(null);
    setVerifiedDriverPhoneE164(null);
    setAccountName(null);
    setAccountNameDraft('');
    setInviteCode('');
    setPin('');
    setPinConfirmation('');
    setIsRegistration(false);
    setAcceptedPrivacy(false);
    setAcceptedLocation(false);
    setScreen('loginPhone');
  }

  const handleAppBack = useCallback((): boolean => {
    if (isPhotoActionSheetVisible) {
      setIsPhotoActionSheetVisible(false);
      return true;
    }

    switch (screen) {
      case 'loginPhone':
      case 'mainTabs':
        return false;
      case 'countrySelect':
        setCountrySearchQuery('');
        setScreen('loginPhone');
        return true;
      case 'loginDetail':
        setInviteCode('');
        setPin('');
        setPinConfirmation('');
        setIsRegistration(false);
        setScreen('loginPhone');
        return true;
      case 'accountName':
        setAccountNameDraft(accountName ?? '');
        setScreen('settings');
        return true;
      case 'settings':
        setScreen('mainTabs');
        return true;
      case 'routeSession':
        setScreen('mainTabs');
        return true;
      case 'proofCamera':
        setScreen('arrivalCheck');
        return true;
      case 'stopDetails':
        setSelectedStopDetailsId(null);
        setScreen(stopDetailsReturnScreen);
        return true;
      case 'arrivalCheck':
        setPendingRoutePlanId(null);
        setScreen(arrivalCheckReturnScreen);
        return true;
      case 'completedDeliveries':
        setScreen('mainTabs');
        return true;
    }
  }, [accountName, arrivalCheckReturnScreen, isPhotoActionSheetVisible, screen, setScreen, stopDetailsReturnScreen]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleAppBack);
    return () => subscription.remove();
  }, [handleAppBack]);

  const pullRefreshGesture = useMemo(() => Gesture.Pan()
    .enabled(
      screen === 'mainTabs' &&
      areRoutesAtTop &&
      !isRefreshingRoutes &&
      !isLoggingIn,
    )
    .activeOffsetY(8)
    .failOffsetX([-18, 18])
    .onUpdate((event) => {
      pullRefreshOffset.value = Math.min(
        PULL_REFRESH_MAX_DISTANCE,
        Math.max(0, event.translationY * PULL_REFRESH_DRAG_RESISTANCE),
      );
    })
    .onEnd(() => {
      if (pullRefreshOffset.value >= PULL_REFRESH_TRIGGER_DISTANCE) {
        pullRefreshOffset.value = withSpring(PULL_REFRESH_REVEAL_HEIGHT, PULL_REFRESH_SPRING_CONFIG);
        scheduleOnRN(handlePullRefresh);
        return;
      }

      pullRefreshOffset.value = withSpring(0, PULL_REFRESH_SPRING_CONFIG);
    })
    .onFinalize((_event, success) => {
      if (!success) {
        pullRefreshOffset.value = withSpring(0, PULL_REFRESH_SPRING_CONFIG);
      }
    }), [areRoutesAtTop, handlePullRefresh, isLoggingIn, isRefreshingRoutes, pullRefreshOffset, screen]);
  const pullRefreshSurfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pullRefreshOffset.value }],
  }));
  const pullRefreshContentStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, (pullRefreshOffset.value - 24) / 36)),
    transform: [{
      translateY: (Math.min(pullRefreshOffset.value, PULL_REFRESH_REVEAL_HEIGHT) - PULL_REFRESH_REVEAL_HEIGHT) / 2,
    }],
  }));
  const isCountrySelectionScreen = screen === 'countrySelect';
  const isProofCameraScreen = screen === 'proofCamera';
  const pendingDriverAppRelease = driverAppUpdateState.kind === 'optional_update'
    || driverAppUpdateState.kind === 'required_update'
    || driverAppUpdateState.kind === 'required_reinstall'
    ? driverAppUpdateState.release
    : null;
  const shouldShowDriverUpdateScreen = shouldPresentDriverAppUpdate({
    dismissedVersionCode: dismissedDriverAppVersionCode,
    explicitRefreshRequested: explicitDriverAppUpdatePrompt,
    hasActiveRoute: activeRoutePlanId !== null,
    isRestoreComplete: isDriverRestoreComplete,
    isRouteSyncLoading: routeSyncState === 'loading',
    state: driverAppUpdateState,
  });

  function handleOpenDriverAppUpdate(): void {
    if (pendingDriverAppRelease === null) {
      return;
    }
    const targetUrl = driverAppUpdateState.kind === 'required_reinstall'
      ? pendingDriverAppRelease.installation.guideUrl
      : pendingDriverAppRelease.installUrl;
    void Linking.openURL(targetUrl).catch(() => {
      setMessage('The update page could not be opened.');
    });
  }

  const standardScreenHeader = screen === 'mainTabs' ? (
    <FixedScreenHeader
      onRightPress={handleOpenSettings}
      rightAccessibilityLabel="Settings"
      rightIcon="settings"
      title="My Routes"
      topInset={topInset}
    />
  ) : screen === 'settings' ? (
    <FixedScreenHeader onBack={handleAppBack} title="Settings" topInset={topInset} />
  ) : screen === 'accountName' ? (
    <FixedScreenHeader onBack={handleAppBack} title="Name" topInset={topInset} />
  ) : screen === 'routeSession' ? (
    <FixedScreenHeader onBack={handleAppBack} title={selectedRoute?.name ?? 'Route'} topInset={topInset} />
  ) : screen === 'stopDetails' ? (
    <FixedScreenHeader
      onBack={handleAppBack}
      title={stopDetailsStop === null ? 'Stop' : `Stop ${stopDetailsStop.sequence}`}
      topInset={topInset}
    />
  ) : screen === 'arrivalCheck' ? (
    <FixedScreenHeader onBack={handleAppBack} title="Complete Delivery" topInset={topInset} />
  ) : screen === 'completedDeliveries' ? (
    <FixedScreenHeader onBack={handleAppBack} title="Completed Deliveries" topInset={topInset} />
  ) : null;

  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      {!isDriverRestoreComplete ? (
        <DriverRestoreScreen
          onRetry={retryDriverRestore}
          problem={driverRestoreProblem}
        />
      ) : shouldShowDriverUpdateScreen && pendingDriverAppRelease !== null ? (
        <DriverUpdateScreen
          currentVersionName={installedDriverAppVersion?.versionName ?? 'Unknown'}
          isReinstall={driverAppUpdateState.kind === 'required_reinstall'}
          isRequired={
            driverAppUpdateState.kind === 'required_update'
            || driverAppUpdateState.kind === 'required_reinstall'
          }
          latestVersionName={pendingDriverAppRelease.latestVersionName}
          onLater={() => {
            setExplicitDriverAppUpdatePrompt(false);
            setDismissedDriverAppVersionCode(pendingDriverAppRelease.latestVersionCode);
          }}
          onUpdate={handleOpenDriverAppUpdate}
        />
      ) : (
        <>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
            style={styles.keyboardArea}
          >
        {isCountrySelectionScreen ? (
          <CountrySelectionScreen
            countries={visiblePhoneCountries}
            onBack={() => {
              handleAppBack();
            }}
            onSearchChange={setCountrySearchQuery}
            onSelectCountry={handlePhoneCountrySelect}
            searchQuery={countrySearchQuery}
            selectedCountry={selectedPhoneCountry}
            selectedLocale={selectedDriverLocale}
            topInset={topInset}
          />
        ) : isProofCameraScreen ? (
          <ProofCameraScreen
            disabled={isCapturingPhoto}
            onCancel={() => setScreen('arrivalCheck')}
            onCaptured={(uri) => {
              void handleCapturedCameraPhoto(uri);
            }}
            onOpenGallery={() => {
              setScreen('arrivalCheck');
              void handleCapturePhoto('library');
            }}
          />
        ) : (
          <View style={styles.standardScreenFrame}>
            {standardScreenHeader}
            <View style={styles.scrollStage}>
            {screen === 'mainTabs' ? (
              <View pointerEvents="none" style={styles.pullRefreshReveal}>
                <Reanimated.View style={[styles.pullRefreshContent, pullRefreshContentStyle]}>
                  <Text style={styles.pullRefreshUpdatedAt}>
                    {lastRoutesUpdatedAt === null ? 'Last updated —' : formatRouteListUpdatedAt(lastRoutesUpdatedAt)}
                  </Text>
                  <ActivityIndicator
                    accessibilityElementsHidden
                    color="#0b57d0"
                    importantForAccessibility="no-hide-descendants"
                    size="small"
                    style={styles.pullRefreshIcon}
                  />
                </Reanimated.View>
              </View>
            ) : null}
            <GestureDetector gesture={pullRefreshGesture}>
              <Reanimated.View
                style={[
                  styles.scrollSurface,
                  screen === 'mainTabs' && pullRefreshSurfaceStyle,
                ]}
              >
                <ScrollView
                  bounces={screen !== 'mainTabs'}
                  contentContainerStyle={[
                    styles.container,
                    standardScreenHeader !== null && styles.containerWithFixedHeader,
                    screen === 'routeSession' && styles.routeSessionContainer,
                  ]}
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                  keyboardShouldPersistTaps="handled"
                  onScroll={(event) => {
                    if (screen === 'mainTabs') {
                      const nextAreRoutesAtTop = event.nativeEvent.contentOffset.y <= 0.5;
                      if (routesAtTopRef.current !== nextAreRoutesAtTop) {
                        routesAtTopRef.current = nextAreRoutesAtTop;
                        setAreRoutesAtTop(nextAreRoutesAtTop);
                      }
                    }
                  }}
                  overScrollMode={screen === 'mainTabs' ? 'never' : 'auto'}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                  style={styles.scrollView}
                >
          {screen === 'loginPhone' ? (
            <LoginPhoneScreen
              isSendingCode={isLoggingIn}
              nationalPhoneInput={nationalPhoneInput}
              onCountrySelectorOpen={openPhoneCountrySelector}
              onPhoneChange={handlePhoneInputChange}
              onSendCode={handlePhoneSubmit}
              phoneE164Preview={phoneE164Preview}
              selectedDriverLocale={selectedDriverLocale}
              selectedPhoneCountry={selectedPhoneCountry}
            />
          ) : null}

          {screen === 'loginDetail' ? (
            <LoginDetailScreen
              acceptedLocation={acceptedLocation}
              acceptedPrivacy={acceptedPrivacy}
              inviteCode={inviteCode}
              isRegistration={isRegistration}
              isLoggingIn={isLoggingIn}
              onAcceptedLocationChange={setAcceptedLocation}
              onAcceptedPrivacyChange={setAcceptedPrivacy}
              onInviteCodeChange={setInviteCode}
              onModeChange={setIsRegistration}
              onPinChange={setPin}
              onPinConfirmationChange={setPinConfirmation}
              onSubmit={handleDetailSubmit}
              pin={pin}
              pinConfirmation={pinConfirmation}
            />
          ) : null}

          {screen === 'mainTabs' ? (
            <MyRoutesPage
              activeRoutePlanId={activeRoutePlanId}
              backgroundLocationPermission={backgroundLocationPermission}
              isDeletingRoute={isDeletingRoute}
              isFinishingRoute={isFinishingRoute}
              isRefreshingRoutes={isRefreshingRoutes}
              isRequestingBackgroundLocation={isRequestingBackgroundLocation}
              isStartingRoute={isStartingRoute}
              isSwitchingRoute={pendingRoutePlanId !== null}
              onDeleteRoute={handleDeleteActiveRoute}
              onOpenCompletedDeliveries={(routeId) => {
                const routeSession = getRouteSessionForAction(routeSessions, routeId);
                if (routeSession === null) {
                  return;
                }
                setSelectedRouteId(routeId);
                setSubmission(toCompanyGuidanceSubmission(routeSession));
                if (routeSession.pendingRouteEnd === 'completed') {
                  setCompletedStopIds(routeSession.route.stops.map((stop) => stop.deliveryStopId));
                }
                setScreen('completedDeliveries');
              }}
              onOpenBackgroundLocationSettings={() => { void handleOpenBackgroundLocationSettings(); }}
              onContinueRoute={handleOpenRouteSession}
              onClearRouteReconciliation={handleRequestRouteReconciliationClear}
              onRetryRouteSync={() => { void handleRefreshRoutes(); }}
              onStartRoute={handleStartRoute}
              routeSessions={routeSessions}
              routeReconciliationCount={routeReconciliationCount}
              routeStatus={routeStatus}
              routeSyncState={routeSyncState}
              selectedRouteId={selectedRouteId}
            />
          ) : null}

          {screen === 'settings' ? (
            <SettingsPage
              acceptedLocation={acceptedLocation}
              acceptedPrivacy={acceptedPrivacy}
              accountName={accountName}
              appVersion={installedDriverAppVersion?.versionName ?? 'Unknown'}
              isLoadingAccountProfile={isLoadingAccountProfile}
              isRequestingAccountDeletion={isRequestingAccountDeletion}
              onEditName={handleOpenAccountName}
              onOpenConsentDocument={handleOpenConsentDocument}
              onLogout={handleLogout}
              onRequestAccountDeletion={handleRequestAccountDeletion}
              phoneE164={verifiedDriverPhoneE164 ?? phoneE164Preview}
            />
          ) : null}

          {screen === 'accountName' ? (
            <AccountNamePage
              isSaving={isSavingAccountName}
              nameDraft={accountNameDraft}
              onChangeName={setAccountNameDraft}
              onSave={() => { void handleSaveAccountName(); }}
            />
          ) : null}

          {screen === 'routeSession' && selectedRoute !== null ? (
            <RouteSessionScreen
              allStopsCompleted={allStopsCompleted}
              company={currentCompany}
              completedStopIds={completedStopIds}
              currentNavigationStepIndex={navigationStepIndex}
              deliveryFinishResult={deliveryFinishResult}
              isFinishingRoute={isFinishingRoute}
              isRecordingArrival={isRecordingArrival}
              isStartingRoute={isStartingRoute}
              mapStyleUrl={driverMapStyleUrl}
              onArrived={handleArrivedAtStep}
              onCopyAddress={(address) => { void handleCopyAddress(address); }}
              onFinishRoute={handleManualFinishRoute}
              onOpenNavigation={() => handleOpenNavigationForStop(currentStop)}
              onOpenRouteNavigation={() => handleOpenRouteNavigation(selectedRoute)}
              onOpenStop={handleOpenStopFromRouteSession}
              onStartRoute={() => handleStartRoute(selectedRoute.id)}
              route={selectedRoute}
              routeStartedEventResult={routeStartedEventResult}
              routeStatus={routeStatus}
              stop={currentStop}
            />
          ) : null}

          {screen === 'stopDetails' && stopDetailsStop !== null ? (
            <StopDetailsScreen
              canArrive={canArriveFromStopDetails}
              canSkip={canSkipFromStopDetails}
              isArriving={isRecordingArrival}
              isSkipping={isCompletingStop}
              isReadOnly={stopDetailsReturnScreen === 'completedDeliveries'}
              onArrive={handleArriveFromStopDetails}
              onCall={() => handleCallStop(stopDetailsStop)}
              onCopyAddress={() => { void handleCopyAddress(formatStopStreetAddress(stopDetailsStop)); }}
              onMessage={() => handleMessageStop(stopDetailsStop)}
              onOpenNavigation={() => handleOpenNavigationForStop(stopDetailsStop)}
              onSkip={handleSkipStopFromDetails}
              stop={stopDetailsStop}
            />
          ) : null}

          {screen === 'arrivalCheck' && currentStop !== null ? (
            <ArrivalCheckScreen
              draft={getProofDraft(proofDrafts[currentStop.deliveryStopId])}
              isCapturingPhoto={isCapturingPhoto}
              isCompletingStop={isCompletingStop || isFinishingRoute}
              onAnnounceTip={handleAnnounceCurrentTip}
              onAddPhoto={handleAddDeliveryPhoto}
              onCompleteStop={handleCompleteCurrentStop}
              onDraftChange={updateCurrentStopDraft}
              photoUri={currentStopPhotoUri}
              proximity={stopArrivalProximityByStopId[currentStop.deliveryStopId]}
              proofResult={stopProofResults[currentStop.deliveryStopId]}
              stop={currentStop}
            />
          ) : null}

          {screen === 'completedDeliveries' && selectedRoute !== null ? (
            <CompletedDeliveriesScreen
              completedStopIds={completedStopIds}
              completedStopTimes={completedStopTimes}
              onOpenStop={(stop) => {
                setSelectedStopDetailsId(stop.deliveryStopId);
                setStopDetailsReturnScreen('completedDeliveries');
                setScreen('stopDetails');
              }}
              route={selectedRoute}
            />
          ) : null}
                </ScrollView>
              </Reanimated.View>
            </GestureDetector>
            </View>
          </View>
        )}
          </KeyboardAvoidingView>
          <DeliveryPhotoActionSheet
            disabled={isCapturingPhoto}
            onCancel={handleDismissPhotoActionSheet}
            onSelectSource={handleSelectPhotoSource}
            visible={isPhotoActionSheetVisible}
          />
          {message !== null ? <TransientToast text={message} /> : null}
        </>
      )}
      <OperationalDialog
        dialog={operationalDialog}
        onDismiss={dismissOperationalDialog}
        onSelect={handleOperationalDialogAction}
      />
    </View>
  );
}

function DriverRestoreScreen({
  onRetry,
  problem,
}: {
  onRetry(): void;
  problem: string | null;
}) {
  return (
    <View style={styles.driverRestoreScreen}>
      <Text style={styles.driverRestoreBrand}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Routes</Text></Text>
      {problem === null ? <ActivityIndicator color="#0b57d0" size="large" /> : null}
      <Text style={styles.driverRestoreTitle}>
        {problem === null ? 'Restoring your session' : 'Connection needed'}
      </Text>
      <Text style={styles.driverRestoreBody}>
        {problem ?? 'Checking your saved login and preparing My Routes.'}
      </Text>
      {problem !== null ? (
        <View style={styles.driverRestoreRetry}>
          <PrimaryButton label="Try Again" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}


function LoginPhoneScreen({
  isSendingCode,
  nationalPhoneInput,
  onCountrySelectorOpen,
  onPhoneChange,
  onSendCode,
  phoneE164Preview,
  selectedDriverLocale,
  selectedPhoneCountry,
}: {
  isSendingCode: boolean;
  nationalPhoneInput: string;
  onCountrySelectorOpen(): void;
  onPhoneChange(value: string): void;
  onSendCode(): void;
  phoneE164Preview: string | null;
  selectedDriverLocale: string;
  selectedPhoneCountry: DriverPhoneCountry;
}) {
  return (
    <View style={styles.screenStack}>
      <View style={styles.brandPanel}>
        <Text style={styles.brandName}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Routes</Text></Text>
        <Text style={styles.brandTagline}>Smarter routes for faster deliveries.</Text>
      </View>

      <View style={styles.formCard}>
        <CountrySelectorButton
          onPress={onCountrySelectorOpen}
          selectedCountry={selectedPhoneCountry}
          selectedLocale={selectedDriverLocale}
        />
        <PhoneNumberInput
          callingCode={selectedPhoneCountry.callingCode}
          e164Preview={phoneE164Preview}
          onChangeText={onPhoneChange}
          value={nationalPhoneInput}
        />
        <PrimaryButton disabled={isSendingCode} label="Continue" loading={isSendingCode} onPress={onSendCode} />
      </View>
    </View>
  );
}

function LoginDetailScreen({
  acceptedLocation,
  acceptedPrivacy,
  inviteCode,
  isRegistration,
  isLoggingIn,
  onAcceptedLocationChange,
  onAcceptedPrivacyChange,
  onInviteCodeChange,
  onModeChange,
  onPinChange,
  onPinConfirmationChange,
  onSubmit,
  pin,
  pinConfirmation,
}: {
  acceptedLocation: boolean;
  acceptedPrivacy: boolean;
  inviteCode: string;
  isRegistration: boolean;
  isLoggingIn: boolean;
  onAcceptedLocationChange(value: boolean): void;
  onAcceptedPrivacyChange(value: boolean): void;
  onInviteCodeChange(value: string): void;
  onModeChange(value: boolean): void;
  onPinChange(value: string): void;
  onPinConfirmationChange(value: string): void;
  onSubmit(): void;
  pin: string;
  pinConfirmation: string;
}) {
  return (
    <View style={styles.screenStack}>
      <View style={styles.brandPanel}>
        <Text style={styles.brandName}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Routes</Text></Text>
        <Text style={styles.brandTagline}>{isRegistration ? 'Create your driver account' : 'Enter your PIN'}</Text>
      </View>

      <View style={styles.formCard}>
        {isRegistration ? (
          <LabeledInput
            label="Invite Code"
            maxLength={6}
            onChangeText={(value) => onInviteCodeChange(value.replace(/[^0-9a-f]/giu, '').slice(0, 6).toUpperCase())}
            placeholder="6-character code"
            returnKeyType="next"
            value={inviteCode}
          />
        ) : null}
        <LabeledInput
          keyboardType="number-pad"
          label="6-digit PIN"
          maxLength={6}
          onChangeText={(value) => onPinChange(value.replace(/\D/gu, '').slice(0, 6))}
          onSubmitEditing={isRegistration ? undefined : onSubmit}
          placeholder="6 digits"
          returnKeyType={isRegistration ? 'next' : 'done'}
          secureTextEntry
          value={pin}
        />
        {isRegistration ? (
          <LabeledInput
            keyboardType="number-pad"
            label="Confirm PIN"
            maxLength={6}
            onChangeText={(value) => onPinConfirmationChange(value.replace(/\D/gu, '').slice(0, 6))}
            onSubmitEditing={onSubmit}
            placeholder="Enter the PIN again"
            returnKeyType="done"
            secureTextEntry
            value={pinConfirmation}
          />
        ) : null}
        <View style={styles.consentStack}>
          <ConsentRow
            label="I agree to the"
            linkLabel="Privacy Policy"
            onValueChange={onAcceptedPrivacyChange}
            value={acceptedPrivacy}
          />
          <ConsentRow
            label="I agree to"
            linkLabel="Location-Based Services"
            onValueChange={onAcceptedLocationChange}
            value={acceptedLocation}
          />
        </View>
        <PrimaryButton
          disabled={isLoggingIn}
          label={isRegistration ? 'Register and Continue' : 'Login'}
          loading={isLoggingIn}
          onPress={onSubmit}
        />
        <SecondaryButton
          disabled={isLoggingIn}
          label={isRegistration ? 'Already registered? Log in' : 'First time? Register with invite code'}
          onPress={() => onModeChange(!isRegistration)}
        />
      </View>
    </View>
  );
}

function MyRoutesPage({
  activeRoutePlanId,
  backgroundLocationPermission,
  isDeletingRoute,
  isFinishingRoute,
  isRefreshingRoutes,
  isRequestingBackgroundLocation,
  isStartingRoute,
  isSwitchingRoute,
  onDeleteRoute,
  onOpenCompletedDeliveries,
  onOpenBackgroundLocationSettings,
  onContinueRoute,
  onClearRouteReconciliation,
  onRetryRouteSync,
  onStartRoute,
  routeSessions,
  routeReconciliationCount,
  routeStatus,
  routeSyncState,
  selectedRouteId,
}: {
  activeRoutePlanId: string | null;
  backgroundLocationPermission: BackgroundLocationPermissionState;
  isDeletingRoute: boolean;
  isFinishingRoute: boolean;
  isRefreshingRoutes: boolean;
  isRequestingBackgroundLocation: boolean;
  isStartingRoute: boolean;
  isSwitchingRoute: boolean;
  onDeleteRoute(routeId: string): void;
  onOpenCompletedDeliveries(routeId: string): void;
  onOpenBackgroundLocationSettings(): void;
  onContinueRoute(routeId: string): void;
  onClearRouteReconciliation(): void;
  onRetryRouteSync(): void;
  onStartRoute(routeId: string): void;
  routeSessions: RouteSession[];
  routeReconciliationCount: number;
  routeStatus: RouteStatus;
  routeSyncState: RouteSyncState;
  selectedRouteId: string | null;
}) {
  const classificationNow = new Date();
  const visibleRouteSessions = routeSessions
    .map((session, originalIndex) => ({ originalIndex, session }))
    .sort((left, right) => {
      const leftIsActive = left.session.route.id === activeRoutePlanId
        || (left.session.companyGuidance.executionStatus === 'IN_PROGRESS' && left.session.pendingRouteEnd === undefined);
      const rightIsActive = right.session.route.id === activeRoutePlanId
        || (right.session.companyGuidance.executionStatus === 'IN_PROGRESS' && right.session.pendingRouteEnd === undefined);
      if (leftIsActive !== rightIsActive) {
        return leftIsActive ? -1 : 1;
      }

      return left.session.route.deliveryDate.localeCompare(right.session.route.deliveryDate)
        || left.originalIndex - right.originalIndex;
    })
    .map(({ session }) => session);
  const effectiveSelectedRouteId = activeRoutePlanId ?? selectedRouteId;
  const [expandedRouteKey, setExpandedRouteKey] = useState<string | null>(null);

  return (
    <View style={styles.myRoutesPage}>
      {routeReconciliationCount > 0 ? (
        <View accessibilityRole="alert" style={styles.routeReconciliationWarning}>
          <View style={styles.routeReconciliationWarningCopy}>
            <Text style={styles.routeReconciliationWarningTitle}>Unsynced delivery record</Text>
            <Text style={styles.routeReconciliationWarningBody}>
              {`${routeReconciliationCount} saved result${routeReconciliationCount === 1 ? '' : 's'} or proof item${routeReconciliationCount === 1 ? '' : 's'} must be cleared before starting again.`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Clear saved reconciliation record"
            accessibilityRole="button"
            onPress={onClearRouteReconciliation}
            style={({ pressed }) => [
              styles.routeReconciliationActionButton,
              pressed && styles.routeReconciliationActionButtonPressed,
            ]}
          >
            <Text style={styles.routeReconciliationActionButtonText}>Clear Record</Text>
          </Pressable>
        </View>
      ) : null}

      {backgroundLocationPermission === 'denied' ? (
        <View accessibilityRole="alert" style={styles.backgroundLocationWarning}>
          <View style={styles.backgroundLocationWarningCopy}>
            <Text style={styles.backgroundLocationWarningTitle}>Allow all the time required</Text>
            <Text style={styles.backgroundLocationWarningBody}>
              CLEVER Routes collects your precise location during an active route, even when the app is closed or not in use.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Review background location access"
            accessibilityRole="button"
            disabled={isRequestingBackgroundLocation}
            onPress={onOpenBackgroundLocationSettings}
            style={({ pressed }) => [
              styles.backgroundLocationSettingsButton,
              pressed && styles.backgroundLocationSettingsButtonPressed,
            ]}
          >
            {isRequestingBackgroundLocation ? (
              <ActivityIndicator color="#92400e" size="small" />
            ) : (
              <Text style={styles.backgroundLocationSettingsButtonText}>Review & Allow</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {routeSyncState === 'loading' && visibleRouteSessions.length === 0 ? (
        <View style={styles.routeSyncState}>
          <ActivityIndicator color="#0b57d0" size="small" />
          <Text style={styles.routeSyncTitle}>Loading routes</Text>
          <Text style={styles.routeSyncBody}>Your login is active. Fetching the latest assignments.</Text>
        </View>
      ) : routeSyncState === 'error' && visibleRouteSessions.length === 0 ? (
        <View style={styles.routeSyncState}>
          <Text style={styles.routeSyncTitle}>Routes temporarily unavailable</Text>
          <Text style={styles.routeSyncBody}>Your login is still active. Check your connection and retry.</Text>
          <SecondaryButton disabled={isRefreshingRoutes} label="Retry" loading={isRefreshingRoutes} onPress={onRetryRouteSync} />
        </View>
      ) : visibleRouteSessions.length > 0 ? (
        <View style={styles.routeCardList}>
          {visibleRouteSessions.map((session, routeIndex) => {
            const classifiedRouteCardStatus = classifyAssignedRouteSession({
              now: classificationNow,
              route: session.route,
              selectedRouteId: effectiveSelectedRouteId,
              selectedRouteStatus: routeStatus,
            });
            const routeCardStatus = session.pendingRouteEnd === 'completed'
              ? 'completed'
              : session.pendingRouteEnd === 'released'
                ? 'ready'
                : session.companyGuidance.executionStatus === 'IN_PROGRESS'
                  ? 'active'
                  : classifiedRouteCardStatus;
            const isRouteCardExpanded = expandedRouteKey === session.route.id;
            const isStartDisabled = isStartingRoute || isFinishingRoute || isSwitchingRoute
              || backgroundLocationPermission !== 'granted' || session.pendingRouteEnd !== undefined;
            const isContinueDisabled = isDeletingRoute || isFinishingRoute
              || backgroundLocationPermission !== 'granted' || activeRoutePlanId !== session.route.id;
            const isDeleteDisabled = isDeletingRoute || activeRoutePlanId !== session.route.id;

            return (
              <View key={session.route.id} style={styles.selectedRouteCard}>
                <View style={styles.routeCardHeader}>
                  <Text numberOfLines={1} style={[styles.cardTitle, styles.routeCardTitle]}>
                    {routeIndex + 1}. {session.route.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.routeDateText}>{session.route.deliveryDate}</Text>
                  <StatusChip
                    tone={getChipTone(routeCardStatus)}
                    label={formatRouteStatus(routeCardStatus)}
                  />
                  <Pressable
                    accessibilityLabel={`${isRouteCardExpanded ? 'Collapse' : 'Expand'} ${session.route.name} details`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      setExpandedRouteKey((value) => value === session.route.id ? null : session.route.id);
                    }}
                    style={styles.routeToggleButton}
                  >
                    <Text style={styles.routeToggleText}>{isRouteCardExpanded ? '−' : '+'}</Text>
                  </Pressable>
                </View>

                {isRouteCardExpanded ? (
                  <>
                    <DataRow label="Store" value={session.companyGuidance.companyDisplayName} />
                    <DataRow label="Region" value={getRouteRegion(session.route)} />
                    <DataRow label="Stops" value={formatStopCount(session.route.stops.length)} />
                    <DataRow label="Estimated Distance" value={formatAssignedRouteDistance(session.route.routeMetrics)} />
                    <DataRow label="Estimated Time" value={formatAssignedRouteDuration(session.route.routeMetrics)} />
                  </>
                ) : null}

                {routeCardStatus === 'completed' ? (
                  <PrimaryButton compact label="View Completed Deliveries" onPress={() => onOpenCompletedDeliveries(session.route.id)} />
                ) : routeCardStatus === 'active' ? (
                  <View style={styles.routeActionRow}>
                    <View style={styles.routeActionButton}>
                      <SecondaryButton compact disabled={isContinueDisabled} label="Continue" onPress={() => onContinueRoute(session.route.id)} />
                    </View>
                    <View style={styles.routeActionButton}>
                      <DangerButton compact disabled={isDeleteDisabled} label="Delete" loading={isDeletingRoute} onPress={() => onDeleteRoute(session.route.id)} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.routeActionRow}>
                    <View style={styles.routeActionButton}>
                      <PrimaryButton
                        compact
                        disabled={isStartDisabled}
                        label="Start"
                        loading={isStartingRoute && selectedRouteId === session.route.id}
                        onPress={() => onStartRoute(session.route.id)}
                      />
                    </View>
                    <View style={styles.routeActionButton}>
                      <SecondaryButton compact label="Detail" onPress={() => onContinueRoute(session.route.id)} />
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          body="When dispatch assigns you a route, it’ll appear here."
          minimal
          title="No routes assigned yet"
        />
      )}
    </View>
  );
}

function SettingsPage({
  acceptedLocation,
  acceptedPrivacy,
  accountName,
  appVersion,
  isLoadingAccountProfile,
  isRequestingAccountDeletion,
  onEditName,
  onOpenConsentDocument,
  onLogout,
  onRequestAccountDeletion,
  phoneE164,
}: {
  acceptedLocation: boolean;
  acceptedPrivacy: boolean;
  accountName: string | null;
  appVersion: string;
  isLoadingAccountProfile: boolean;
  isRequestingAccountDeletion: boolean;
  onEditName(): void;
  onOpenConsentDocument(): void;
  onLogout(): void;
  onRequestAccountDeletion(): void;
  phoneE164: string | null;
}) {
  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsSection}>
        <Text style={styles.settingsSectionLabel}>ACCOUNT</Text>
        <View style={styles.settingsGroup}>
          <Pressable
            accessibilityLabel="Change Name"
            accessibilityRole="button"
            disabled={isLoadingAccountProfile}
            onPress={onEditName}
            style={({ pressed }) => [
              styles.settingsRow,
              styles.settingsRowSeparated,
              pressed && styles.settingsRowPressed,
            ]}
          >
            <Text style={styles.settingsRowLabel}>Name</Text>
            <View style={styles.settingsRowValueGroup}>
              <Text numberOfLines={1} style={styles.settingsRowValue}>
                {isLoadingAccountProfile ? 'Loading…' : accountName ?? 'Not set'}
              </Text>
              <Ionicons color="#a1a7b0" name="chevron-forward" size={20} />
            </View>
          </Pressable>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowLabel}>Phone Number</Text>
            <Text numberOfLines={1} style={styles.settingsRowValue}>
              {phoneE164 ?? 'Unavailable'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.settingsSectionLabel}>CONSENT</Text>
        <View style={styles.settingsGroup}>
          <Pressable
            accessibilityLabel="Read Privacy Policy"
            accessibilityRole="button"
            onPress={onOpenConsentDocument}
            style={({ pressed }) => [
              styles.settingsRow,
              styles.settingsRowSeparated,
              pressed && styles.settingsRowPressed,
            ]}
          >
            <Text style={styles.settingsRowLabel}>Privacy</Text>
            <View style={styles.settingsRowValueGroup}>
              <Text numberOfLines={1} style={styles.settingsRowValue}>
                {acceptedPrivacy ? 'Allowed' : 'Denied'}
              </Text>
              <Ionicons color="#a1a7b0" name="chevron-forward" size={20} />
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="Read Location Policy"
            accessibilityRole="button"
            onPress={onOpenConsentDocument}
            style={({ pressed }) => [
              styles.settingsRow,
              pressed && styles.settingsRowPressed,
            ]}
          >
            <Text style={styles.settingsRowLabel}>Location</Text>
            <View style={styles.settingsRowValueGroup}>
              <Text numberOfLines={1} style={styles.settingsRowValue}>
                {acceptedLocation ? 'Allowed' : 'Denied'}
              </Text>
              <Ionicons color="#a1a7b0" name="chevron-forward" size={20} />
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.settingsSectionLabel}>ABOUT</Text>
        <View style={styles.settingsGroup}>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowLabel}>Version</Text>
            <Text style={styles.settingsRowValue}>{appVersion}</Text>
          </View>
        </View>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.settingsSectionLabel}>ACCOUNT ACTIONS</Text>
        <Pressable
          accessibilityLabel="Delete Account"
          accessibilityRole="button"
          disabled={isRequestingAccountDeletion}
          onPress={onRequestAccountDeletion}
          style={({ pressed }) => [
            styles.settingsGroup,
            styles.settingsAccountActionButton,
            pressed && styles.settingsSignOutButtonPressed,
          ]}
        >
          {isRequestingAccountDeletion ? (
            <ActivityIndicator color="#e11d48" />
          ) : (
            <Text style={styles.settingsDeleteAccountText}>Delete Account</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        accessibilityLabel="Sign Out"
        accessibilityRole="button"
        onPress={onLogout}
        style={({ pressed }) => [
          styles.settingsGroup,
          styles.settingsSignOutButton,
          pressed && styles.settingsSignOutButtonPressed,
        ]}
      >
        <Text style={styles.settingsSignOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

function AccountNamePage({
  isSaving,
  nameDraft,
  onChangeName,
  onSave,
}: {
  isSaving: boolean;
  nameDraft: string;
  onChangeName(value: string): void;
  onSave(): void;
}) {
  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsSection}>
        <Text style={styles.settingsSectionLabel}>ACCOUNT</Text>
        <View style={styles.settingsNameEditor}>
          <LabeledInput
            autoCapitalize="words"
            label="Name"
            maxLength={80}
            onChangeText={onChangeName}
            onSubmitEditing={onSave}
            placeholder="Your name"
            returnKeyType="done"
            value={nameDraft}
          />
          <Text style={styles.helperText}>This is your name in CLEVER Routes. Store display names can be different.</Text>
          <PrimaryButton
            disabled={isSaving || nameDraft.trim().length === 0}
            label="Save"
            loading={isSaving}
            onPress={onSave}
          />
        </View>
      </View>
    </View>
  );
}

function RouteSessionScreen({
  allStopsCompleted,
  company,
  completedStopIds,
  currentNavigationStepIndex,
  deliveryFinishResult,
  isFinishingRoute,
  isRecordingArrival,
  isStartingRoute,
  mapStyleUrl,
  onArrived,
  onCopyAddress,
  onFinishRoute,
  onOpenNavigation,
  onOpenRouteNavigation,
  onOpenStop,
  onStartRoute,
  route,
  routeStartedEventResult,
  routeStatus,
  stop,
}: {
  allStopsCompleted: boolean;
  company: RouteAccessCompanyGuidance | null;
  completedStopIds: string[];
  currentNavigationStepIndex: number;
  deliveryFinishResult: DeliveryFinishResult | null;
  isFinishingRoute: boolean;
  isRecordingArrival: boolean;
  isStartingRoute: boolean;
  mapStyleUrl: string;
  onArrived(): void;
  onCopyAddress(address: string): void;
  onFinishRoute(): void;
  onOpenNavigation(): void;
  onOpenRouteNavigation(): void;
  onOpenStop(stop: AssignedRouteStop): void;
  onStartRoute(): void;
  route: AssignedRoute;
  routeStartedEventResult: RouteStartedRecordResult | null;
  routeStatus: RouteStatus;
  stop: AssignedRouteStop | null;
}) {
  const isPickupTask = routeStatus === 'active' && currentNavigationStepIndex === COMPANY_STEP_INDEX;
  const [selectedRouteContent, setSelectedRouteContent] = useState<RouteSessionContentTab>('stops');
  const [pickupTimingNow, setPickupTimingNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPickupTask) {
      return undefined;
    }

    const initialTimer = setTimeout(() => setPickupTimingNow(Date.now()), 0);
    const minuteTimer = setInterval(() => setPickupTimingNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(minuteTimer);
    };
  }, [isPickupTask]);
  const pickupTiming = formatAssignedRoutePickupTiming(route, pickupTimingNow);
  const routeInventory = buildRouteInventory(route);
  const currentTaskTitle = isPickupTask ? 'Store Pickup' : stop === null ? 'Next Stop' : `Stop ${stop.sequence}`;
  const currentTaskAddress = stop === null ? null : formatStopSearchAddress(stop);
  const currentTaskGuidance = isPickupTask && company?.pickupGuidance?.trim()
    ? company.pickupGuidance
    : null;
  const currentTaskPayment = stop === null ? null : formatAssignedRoutePaymentSummary(stop);
  const currentTaskPaymentAmount = stop === null
    ? null
    : formatAssignedRouteCompactPaymentAmount(stop.totalPriceAmount, stop.currencyCode);
  const etaSnapshot = route.etaSnapshot ?? null;
  const nextStopEta = etaSnapshot?.nextStopEta ?? null;
  const remainingRouteEta = etaSnapshot?.remainingRouteEta ?? null;
  const currentTaskNextStopEta = nextStopEta === null
    ? null
    : formatAssignedRouteEta(nextStopEta.estimatedArrivalAt, route.timezone);
  const currentTaskRouteCompletionEta = remainingRouteEta === null || remainingRouteEta.estimatedCompletionAt === null
    ? null
    : formatAssignedRouteEta(remainingRouteEta.estimatedCompletionAt, route.timezone);
  const currentTaskEtaFailure = etaSnapshot?.status === 'FAILED'
    ? (etaSnapshot.failureMessage?.trim() || 'ETA unavailable')
    : null;
  const showRouteEtaRows = !isPickupTask
    && etaSnapshot !== null
    && (etaSnapshot.status === 'READY' || etaSnapshot.status === 'FAILED');
  const primaryProgressAction = routeStatus === 'active' && allStopsCompleted
    ? { disabled: isFinishingRoute, label: 'Finish Route', loading: isFinishingRoute, onPress: onFinishRoute }
    : null;

  return (
    <View style={styles.routeSessionPage}>
      <View style={styles.routeSessionHeader}>
        <View style={styles.routeSessionMetaRow}>
          <Text numberOfLines={1} style={styles.routeSessionMeta}>
            {route.stops.length} {route.stops.length === 1 ? 'Stop' : 'Stops'}
          </Text>
          <Text numberOfLines={1} style={styles.routeSessionMeta}>
            Duration {formatAssignedRouteDuration(route.routeMetrics)}
          </Text>
        </View>
      </View>

      <View style={styles.routeSessionMap}>
        <MapOverview
          route={route}
          currentStepIndex={currentNavigationStepIndex}
          mapStyleUrl={mapStyleUrl}
          showUserLocation={routeStatus === 'active'}
        />
      </View>

      {routeStatus === 'ready' ? (
        <View style={styles.routeSessionSection}>
          <Text style={styles.sectionTitle}>Store Pickup</Text>
          {company?.pickupGuidance?.trim() ? (
            <Text style={styles.bodyText}>{company.pickupGuidance}</Text>
          ) : null}
          <PrimaryButton
            disabled={isStartingRoute}
            label="Start Session"
            loading={isStartingRoute}
            onPress={onStartRoute}
          />
        </View>
      ) : null}

      {routeStatus === 'active' && !allStopsCompleted ? (
        <View style={styles.routeSessionSection}>
          <View style={styles.currentTaskTitleRow}>
            <Text style={styles.sectionTitle}>{currentTaskTitle}</Text>
            {currentTaskPayment !== null ? (
              <StatusChip compact label={currentTaskPayment.status.label} tone={currentTaskPayment.status.tone} />
            ) : null}
          </View>
          <View style={styles.currentTaskMetaRow}>
            {currentTaskAddress !== null ? (
              <Text style={styles.currentTaskAddressText}>{currentTaskAddress}</Text>
            ) : null}
            <View style={styles.currentTaskStatusColumn}>
              {currentTaskPaymentAmount !== null ? (
                <Text style={styles.currentTaskPaymentAmount}>{currentTaskPaymentAmount}</Text>
              ) : null}
            </View>
          </View>
          {currentTaskGuidance !== null ? (
            <Text style={styles.bodyText}>{currentTaskGuidance}</Text>
          ) : null}
          {isPickupTask ? (
            <>
              <View style={styles.pickupTimingGrid}>
                <MetricBlock label="Leave" value={pickupTiming.leave} />
                <MetricBlock label="Route time" value={pickupTiming.routeTime} />
                <MetricBlock label="Est. finish" value={pickupTiming.finish} />
              </View>
              <PrimaryButton label="Pickup & Start Route" onPress={onArrived} />
            </>
          ) : (
            <View style={styles.routeActionRow}>
              <View style={styles.routeActionButton}>
                <PrimaryButton compact disabled={isRecordingArrival} label="Arrive" loading={isRecordingArrival} onPress={onArrived} />
              </View>
              <View style={styles.routeActionButton}>
                <SecondaryButton compact label="Navigate" onPress={onOpenNavigation} />
              </View>
            </View>
          )}
          {showRouteEtaRows ? (
            <View style={styles.routeSessionEtaRows}>
              {currentTaskEtaFailure !== null ? (
                <Text style={styles.currentTaskEtaWarningText}>{currentTaskEtaFailure}</Text>
              ) : null}
              {currentTaskNextStopEta !== null ? (
                <Text style={styles.currentTaskEtaText}>Estimated arrival time at next stop: {currentTaskNextStopEta}</Text>
              ) : null}
              {currentTaskRouteCompletionEta !== null ? (
                <Text style={styles.currentTaskEtaText}>Estimated completion time: {currentTaskRouteCompletionEta}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {company?.driverInstructions.length ? (
        <View style={styles.routeSessionSection}>
          <Text style={styles.sectionTitle}>Driver Notes</Text>
          {company.driverInstructions.map((instruction) => (
            <Text key={instruction} style={styles.bodyText}>{instruction}</Text>
          ))}
        </View>
      ) : null}

      <View style={styles.routeSessionSection}>
        <View style={styles.routeContentTabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedRouteContent === 'stops' }}
            onPress={() => setSelectedRouteContent('stops')}
            style={[styles.routeContentTab, selectedRouteContent === 'stops' && styles.routeContentTabActive]}
          >
            <Text style={[styles.routeContentTabText, selectedRouteContent === 'stops' && styles.routeContentTabTextActive]}>Stops</Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedRouteContent === 'inventory' }}
            onPress={() => setSelectedRouteContent('inventory')}
            style={[styles.routeContentTab, selectedRouteContent === 'inventory' && styles.routeContentTabActive]}
          >
            <Text style={[styles.routeContentTabText, selectedRouteContent === 'inventory' && styles.routeContentTabTextActive]}>Inventory</Text>
          </Pressable>
        </View>
        {selectedRouteContent === 'stops' ? (
          <View style={styles.routeSequenceList}>
            {route.stops.map((stop, index) => {
              const completed = completedStopIds.includes(stop.deliveryStopId);
              const isProcessing = routeStatus === 'active' && currentNavigationStepIndex === index + 1 && !completed;
              const state = completed ? 'completed' : isProcessing ? 'current' : 'upcoming';
              const progressMeta = completed ? 'Done' : isProcessing ? 'Current' : undefined;
              const metaTone = completed ? 'neutral' : isProcessing ? 'green' : 'neutral';
              return (
                <TimelineRow
                  copyAccessibilityLabel={`Copy Stop ${stop.sequence} address`}
                  key={stop.deliveryStopId}
                  marker={String(stop.sequence).padStart(2, '0')}
                  onCopy={() => onCopyAddress(formatStopStreetAddress(stop))}
                  onPress={() => onOpenStop(stop)}
                  title={formatStopStreetAddress(stop)}
                  state={state}
                  meta={progressMeta}
                  metaTone={metaTone}
                />
              );
            })}
          </View>
        ) : (
          <View style={styles.routeInventory}>
            <View style={styles.routeInventorySummary}>
              <Text style={styles.sectionTitle}>
                {routeInventory.totalQuantity} {routeInventory.totalQuantity === 1 ? 'Item' : 'Items'}
              </Text>
              <Text style={styles.helperText}>
                {routeInventory.groups.length} {routeInventory.groups.length === 1 ? 'Order' : 'Orders'}
              </Text>
            </View>
            {routeInventory.groups.length === 0 ? (
              <EmptyState minimal title="No inventory" body="Assigned route items will appear here." />
            ) : routeInventory.groups.map((group) => (
              <View key={group.deliveryStopId} style={styles.routeInventoryGroup}>
                <View style={styles.routeInventoryGroupHeader}>
                  <Text style={styles.routeInventoryStop}>Stop {String(group.stopSequence).padStart(2, '0')}</Text>
                  <Text numberOfLines={1} style={styles.routeInventoryOrder}>{group.orderName}</Text>
                </View>
                {group.items.map((item, itemIndex) => {
                  const itemName = splitStopItemName(item.name);
                  return (
                    <View
                      key={`${item.productId}:${item.variationId}:${item.name}:${itemIndex}`}
                      style={styles.routeInventoryItemRow}
                    >
                      <Text style={styles.routeInventoryItemQuantity}>{item.quantity} EA</Text>
                      <View style={styles.stopDetailsItemContent}>
                        <Text style={styles.stopDetailsItemNamePrimary}>{itemName.primary}</Text>
                        {itemName.secondary === null ? null : (
                          <Text style={styles.stopDetailsItemNameSecondary}>{itemName.secondary}</Text>
                        )}
                        {item.options.length === 0 ? null : (
                          <Text style={styles.stopDetailsItemOptions}>
                            {item.options.map((option) => `${option.key}: ${option.value}`).join(', ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>

      {routeStartedEventResult?.kind === 'recorded' ? <StatusBanner tone="green" text="Route start event recorded." /> : null}
      {deliveryFinishResult?.flowState === 'delivery_finished' ? <StatusBanner tone="green" text={deliveryFinishResult.message} /> : null}

      <View style={styles.routeSessionActions}>
        {primaryProgressAction !== null ? (
          <PrimaryButton
            disabled={primaryProgressAction.disabled}
            label={primaryProgressAction.label}
            loading={primaryProgressAction.loading}
            onPress={primaryProgressAction.onPress}
          />
        ) : null}
        {routeStatus !== 'active' ? <SecondaryButton label="Open Route" onPress={onOpenRouteNavigation} /> : null}
      </View>
    </View>
  );
}

function StopDetailsScreen({
  canArrive,
  canSkip,
  isArriving,
  isReadOnly = false,
  isSkipping,
  onArrive,
  onCall,
  onCopyAddress,
  onMessage,
  onOpenNavigation,
  onSkip,
  stop,
}: {
  canArrive: boolean;
  canSkip: boolean;
  isArriving: boolean;
  isReadOnly?: boolean;
  isSkipping: boolean;
  onArrive(): void;
  onCall(): void;
  onCopyAddress(): void;
  onMessage(): void;
  onOpenNavigation(): void;
  onSkip(): void;
  stop: AssignedRouteStop;
}) {
  const payment = formatAssignedRoutePaymentSummary(stop);
  const paymentAmount = formatAssignedRouteCompactPaymentAmount(stop.totalPriceAmount, stop.currencyCode);
  const paymentMethodLabel = payment.methodLabel === 'Payment' ? null : payment.methodLabel;
  const isPickupStop = isAssignedRoutePickupStop(stop);
  const customerName = stop.recipientName?.trim() || null;
  const customerPhone = stop.phone?.trim() || null;
  const stopAddress = formatStopStreetAddress(stop);
  return (
    <View style={styles.stopDetailsPage}>
      <View style={styles.stopDetailsAddressRow}>
        <Text style={styles.stopDetailsAddress}>{stopAddress}</Text>
        <StopContactIconButton
          accessibilityLabel="Copy address"
          icon="copy-outline"
          onPress={onCopyAddress}
        />
      </View>

      <View style={styles.stopDetailsSection}>
        <Text style={styles.stopDetailsSectionTitle}>Order</Text>
        <DataRow label="Order" value={stop.orderName} />
      </View>

      <View style={styles.stopDetailsSection}>
        <Text style={styles.stopDetailsSectionTitle}>Customer</Text>
        <View style={styles.stopDetailsCustomerRow}>
          <View style={styles.stopDetailsCustomerIdentity}>
            <Text style={styles.stopDetailsCustomerName}>{customerName ?? 'Not available'}</Text>
            <Text style={styles.stopDetailsCustomerPhone}>{customerPhone ?? 'Phone unavailable'}</Text>
          </View>
          {customerPhone !== null ? (
            <View style={styles.stopDetailsCustomerActions}>
              <StopContactIconButton
                accessibilityLabel={`Call ${customerName ?? 'customer'}`}
                icon="call-outline"
                onPress={onCall}
              />
              <StopContactIconButton
                accessibilityLabel={`Message ${customerName ?? 'customer'}`}
                icon="chatbubble-outline"
                onPress={onMessage}
              />
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.stopDetailsSection, styles.stopDetailsPaymentSection]}>
        <Text style={styles.stopDetailsSectionTitle}>{isPickupStop ? 'Order Type' : 'Payment'}</Text>
        {isPickupStop ? (
          <View style={styles.stopDetailsPaymentRow}>
            <StatusChip compact label="Pickup" tone="warning" />
          </View>
        ) : (
          <View style={styles.stopDetailsPaymentRow}>
            <View style={styles.stopDetailsPaymentContext}>
              {paymentMethodLabel === null ? null : (
                <Text style={styles.stopDetailsPaymentMethod}>{paymentMethodLabel}</Text>
              )}
              <StatusChip compact label={payment.status.label} tone={payment.status.tone} />
            </View>
            <StatusChip large label={paymentAmount} tone={payment.status.tone} />
          </View>
        )}
      </View>

      <View style={styles.stopDetailsSection}>
        <View style={styles.stopDetailsItemHeader}>
          <Text style={styles.stopDetailsItemQuantityHeader}>Qty</Text>
          <Text style={styles.stopDetailsItemContentHeader}>Item</Text>
        </View>
        {stop.items.map((item, itemIndex) => {
          const itemName = splitStopItemName(item.name);
          return (
            <View
              key={`${item.productId}:${item.variationId}:${item.name}:${itemIndex}`}
              style={[styles.stopDetailsItemRow, itemIndex < stop.items.length - 1 && styles.stopDetailsItemRowSeparated]}
            >
              <Text style={styles.stopDetailsItemQuantity}>{item.quantity} EA</Text>
              <View style={styles.stopDetailsItemContent}>
                <Text style={styles.stopDetailsItemNamePrimary}>{itemName.primary}</Text>
                {itemName.secondary === null ? null : (
                  <Text style={styles.stopDetailsItemNameSecondary}>{itemName.secondary}</Text>
                )}
                {item.options.length === 0 ? null : (
                  <Text style={styles.stopDetailsItemOptions}>
                    {item.options.map((option) => `${option.key}: ${option.value}`).join(', ')}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.stopDetailsSection}>
        <Text style={styles.stopDetailsSectionTitle}>Customer Note</Text>
        <Text style={styles.stopDetailsNote}>{stop.customerNote?.trim() || 'No delivery instructions provided.'}</Text>
      </View>
      {isReadOnly ? null : (
        <View style={styles.stopDetailsActionStack}>
          <View style={[styles.buttonRow, styles.stopDetailsActions]}>
            <StopDetailsActionButton
              disabled={!canArrive || isArriving}
              label="Arrive"
              loading={isArriving}
              onPress={onArrive}
              tone="arrive"
            />
            <StopDetailsActionButton label="Navigate" onPress={onOpenNavigation} tone="navigate" />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!canSkip || isSkipping}
            onPress={onSkip}
            style={[
              styles.stopDetailsSkipAction,
              (!canSkip || isSkipping) && styles.buttonDisabled,
            ]}
          >
            {isSkipping ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.stopDetailsSkipActionText}>Skip Stop</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function StopContactIconButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: 'call-outline' | 'chatbubble-outline' | 'copy-outline';
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.stopDetailsContactIconButton,
        pressed && styles.stopDetailsContactIconButtonPressed,
      ]}
    >
      <Ionicons color="#0b57d0" name={icon} size={23} />
    </Pressable>
  );
}

function StopDetailsActionButton({
  disabled,
  label,
  loading,
  onPress,
  tone,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress(): void;
  tone: 'arrive' | 'navigate';
}) {
  const isSecondary = tone !== 'arrive';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.stopDetailsAction,
        tone === 'arrive' && styles.stopDetailsActionArrive,
        isSecondary && styles.stopDetailsActionSecondary,
        disabled === true && styles.buttonDisabled,
      ]}
    >
      {loading === true ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={[styles.stopDetailsActionText, isSecondary && styles.stopDetailsActionSecondaryText]}>{label}</Text>
      )}
    </Pressable>
  );
}

function ArrivalCheckScreen({
  draft,
  isCapturingPhoto,
  isCompletingStop,
  onAnnounceTip,
  onAddPhoto,
  onCompleteStop,
  onDraftChange,
  photoUri,
  proximity,
  proofResult,
  stop,
}: {
  draft: StopProofDraft;
  isCapturingPhoto: boolean;
  isCompletingStop: boolean;
  onAnnounceTip(): void;
  onAddPhoto(): void;
  onCompleteStop(): void;
  onDraftChange(patch: Partial<StopProofDraft>): void;
  photoUri?: string;
  proximity?: StopArrivalProximityEvidence | null;
  proofResult?: StopProofEventResult;
  stop: AssignedRouteStop;
}) {
  const proximityTitle = proximity === null || proximity === undefined
    ? 'Arrival distance unavailable'
    : proximity.isWithinRadius
      ? 'You’re near the destination'
      : 'You’re far from the destination';
  const proximityDetail = proximity === null || proximity === undefined
    ? 'A fresh GPS position was unavailable. Voice tip is still available.'
    : `${formatAssignedRouteDistance({ distanceMeters: proximity.distanceMeters, durationSeconds: null })} from the planned stop. Voice tip available.`;
  const isFar = proximity?.isWithinRadius === false;
  const isUnavailable = proximity === null || proximity === undefined;

  return (
    <View style={styles.screenStack}>
      <Pressable
        accessibilityRole="button"
        onPress={onAnnounceTip}
        style={[
          styles.nearbyBanner,
          isFar && styles.nearbyBannerFar,
          isUnavailable && styles.nearbyBannerUnavailable,
        ]}
      >
        <View style={[
          styles.statusDot,
          isFar && styles.statusDotFar,
          isUnavailable && styles.statusDotUnavailable,
        ]} />
        <View style={styles.routeHeaderText}>
          <Text style={styles.nearbyTitle}>{proximityTitle}</Text>
          <Text style={styles.helperText}>{proximityDetail}</Text>
        </View>
      </Pressable>

      <Text style={styles.sectionTitle}>Delivery Photo (Optional)</Text>
      {photoUri === undefined ? null : (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Selected delivery photo"
          resizeMode="cover"
          source={{ uri: photoUri }}
          style={styles.proofPhotoPreview}
        />
      )}
      <SecondaryButton
        compact
        disabled={isCapturingPhoto}
        label={photoUri === undefined ? 'Add Photo' : 'Change Photo'}
        loading={isCapturingPhoto}
        onPress={onAddPhoto}
      />

      <LabeledInput
        label="Delivery Result"
        onChangeText={(value) => onDraftChange({ todayNote: value })}
        placeholder="e.g. Left at front door"
        value={draft.todayNote}
      />
      <LabeledInput
        label="Location Tip"
        onChangeText={(value) => onDraftChange({ locationTip: value })}
        placeholder="e.g. Side entrance, gate code, parking note"
        value={draft.locationTip}
      />
      <LabeledInput
        label="Other Notes"
        multiline
        onChangeText={(value) => onDraftChange({ additionalNotes: value })}
        placeholder="Anything else for this stop"
        value={draft.additionalNotes}
      />
      {proofResult !== undefined ? <StatusBanner tone={proofResult.kind === 'recorded' ? 'green' : 'warning'} text={formatStopProofResult(proofResult)} /> : null}
      <PrimaryButton disabled={isCompletingStop} label="Complete Stop" loading={isCompletingStop} onPress={onCompleteStop} />
      <Text style={styles.helperText}>Current stop: Stop {stop.sequence}</Text>
    </View>
  );
}

function CompletedDeliveriesScreen({
  completedStopIds,
  completedStopTimes,
  onOpenStop,
  route,
}: {
  completedStopIds: string[];
  completedStopTimes: Record<string, string>;
  onOpenStop(stop: AssignedRouteStop): void;
  route: AssignedRoute;
}) {
  const [selectedFilter, setSelectedFilter] = useState<CompletedDeliveriesFilter>('all');
  const completedStops = route.stops.filter((stop) => isStopCompleted(stop, completedStopIds));
  const deliveredCount = completedStops.filter((stop) => getCompletedDeliveryOutcome(stop) === 'delivered').length;
  const issueCount = completedStops.length - deliveredCount;
  const filteredStops = completedStops.filter((stop) => (
    selectedFilter === 'all' || getCompletedDeliveryOutcome(stop) === selectedFilter
  ));
  const filters: { id: CompletedDeliveriesFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'issues', label: 'Issues' },
  ];

  return (
    <View style={styles.completedDeliveriesPage}>
      <View style={styles.completedRouteHeader}>
        <Text numberOfLines={1} style={styles.pageTitleSmall}>{route.name}</Text>
        <Text style={styles.helperText}>{route.deliveryDate}</Text>
      </View>
      <View style={styles.completedSummaryRow}>
        <CompletedDeliveryMetric label="Completed" value={`${completedStops.length}/${route.stops.length}`} />
        <CompletedDeliveryMetric label="Delivered" value={String(deliveredCount)} />
        <CompletedDeliveryMetric label="Issues" value={String(issueCount)} />
      </View>
      <View style={styles.filterRow}>
        {filters.map((filter) => {
          const selected = selectedFilter === filter.id;
          return (
            <Pressable
              key={filter.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setSelectedFilter(filter.id)}
              style={[styles.completedFilterTab, selected && styles.completedFilterTabActive]}
            >
              <Text style={[styles.completedFilterText, selected && styles.completedFilterTextActive]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.completedList}>
        {filteredStops.length > 0 ? filteredStops.map((stop, index) => {
          const status = formatCompletedDeliveryStatus(stop);
          const completedTime = completedStopTimes[stop.deliveryStopId];
          return (
            <Pressable
              key={stop.deliveryStopId}
              accessibilityLabel={`Open completed Stop ${stop.sequence} details`}
              accessibilityRole="button"
              onPress={() => onOpenStop(stop)}
              style={({ pressed }) => [
                styles.completedRow,
                index === filteredStops.length - 1 && styles.completedRowLast,
                pressed && styles.completedRowPressed,
              ]}
            >
              <View style={styles.completedRowPrimary}>
                <Text style={styles.completedRowTitle}>Stop {stop.sequence}</Text>
                <Text numberOfLines={1} style={styles.helperText}>{formatStopAddress(stop)}</Text>
              </View>
              <View style={styles.completedMetaColumn}>
                <StatusChip compact label={status.label} tone={status.tone} />
                {completedTime === undefined ? null : <Text style={styles.completedTimeText}>{completedTime}</Text>}
              </View>
              <Text style={styles.completedRowDetail}>Detail</Text>
            </Pressable>
          );
        }) : (
          <EmptyState
            minimal
            title={completedStops.length === 0 ? 'No completed deliveries' : 'No deliveries in this filter'}
            body={completedStops.length === 0 ? 'Completed stops will appear here.' : 'Choose another filter to review completed stops.'}
          />
        )}
      </View>
    </View>
  );
}

function CompletedDeliveryMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.completedMetric}>
      <Text style={styles.completedMetricValue}>{value}</Text>
      <Text style={styles.completedMetricLabel}>{label}</Text>
    </View>
  );
}

function CountrySelectorButton({
  onPress,
  selectedCountry,
  selectedLocale,
}: {
  onPress(): void;
  selectedCountry: DriverPhoneCountry;
  selectedLocale: string;
}) {
  const selectedText = getSelectedCountryCardText(selectedCountry, { locale: selectedLocale });

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Country</Text>
      <Pressable
        accessibilityHint="Opens the full country selection list."
        accessibilityLabel={`Country ${selectedText.title} ${selectedText.callingCode}`}
        accessibilityRole="button"
        onPress={onPress}
        style={styles.countrySelectorButton}
      >
        <View style={styles.routeHeaderText}>
          <Text numberOfLines={1} style={styles.countrySelectorText}>{selectedText.title}</Text>
        </View>
        <Text style={styles.countryCallingCodeText}>{selectedText.callingCode}</Text>
      </Pressable>
    </View>
  );
}

function CountrySelectionScreen({
  countries,
  onBack,
  onSearchChange,
  onSelectCountry,
  searchQuery,
  selectedCountry,
  selectedLocale,
  topInset,
}: {
  countries: DriverPhoneCountry[];
  onBack(): void;
  onSearchChange(value: string): void;
  onSelectCountry(country: DriverPhoneCountry): void;
  searchQuery: string;
  selectedCountry: DriverPhoneCountry;
  selectedLocale: string;
  topInset: number;
}) {
  return (
    <View style={styles.countrySelectionFrame}>
      <FixedScreenHeader onBack={onBack} title="Select Country" topInset={topInset} />
      <View style={styles.countrySelectionScreen}>
        <LabeledInput
          label="Search Country"
          onChangeText={onSearchChange}
          placeholder="Country, ISO, + code, locale, or language"
          value={searchQuery}
        />
        <ScrollView
          contentContainerStyle={styles.countrySelectionListContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.countrySelectionList}
        >
          {countries.length > 0 ? countries.map((country) => {
            const rowText = getCountrySelectorRowText(country, { locale: selectedLocale });

            return (
              <Pressable
                accessibilityRole="button"
                key={country.iso2}
                onPress={() => onSelectCountry(country)}
                style={[styles.countryRow, country.iso2 === selectedCountry.iso2 && styles.countryRowSelected]}
              >
                <Text numberOfLines={1} style={styles.countrySelectorText}>{rowText.title}</Text>
                <Text numberOfLines={1} style={styles.helperText}>{rowText.subtitle}</Text>
              </Pressable>
            );
          }) : <Text style={styles.helperText}>No supported countries matched this search.</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

function PhoneNumberInput({
  callingCode,
  e164Preview,
  onChangeText,
  value,
}: {
  callingCode: string;
  e164Preview: string | null;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Phone Number</Text>
      <View style={styles.phoneInputShell}>
        <View style={styles.callingCodePill}>
          <Text style={styles.callingCodeText}>{callingCode}</Text>
        </View>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="phone-pad"
          onChangeText={onChangeText}
          placeholder="Phone number"
          placeholderTextColor="#8a94a6"
          style={styles.input}
          value={value}
        />
      </View>
      <Text style={styles.helperText}>
        {e164Preview === null ? 'Enter the phone number registered with dispatch.' : `Will submit as ${e164Preview}.`}
      </Text>
    </View>
  );
}

function LabeledInput({
  autoCapitalize,
  blurOnSubmit,
  inputAccessoryViewID,
  inputRef,
  keyboardType,
  label,
  maxLength,
  multiline,
  onChangeText,
  onFocus,
  onRightAction,
  onSubmitEditing,
  placeholder,
  rightActionLabel,
  returnKeyType,
  secureTextEntry,
  value,
}: {
  autoCapitalize?: 'none' | 'sentences' | 'words';
  blurOnSubmit?: boolean;
  inputAccessoryViewID?: string;
  inputRef?: (input: TextInput | null) => void;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
  label: string;
  maxLength?: number;
  multiline?: boolean;
  onChangeText(value: string): void;
  onFocus?(): void;
  onRightAction?(): void;
  onSubmitEditing?(): void;
  placeholder: string;
  rightActionLabel?: string;
  returnKeyType?: 'done' | 'next';
  secureTextEntry?: boolean;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.inputShell, multiline === true && styles.multilineInput]}>
        <TextInput
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          blurOnSubmit={blurOnSubmit}
          inputAccessoryViewID={inputAccessoryViewID}
          keyboardType={keyboardType ?? 'default'}
          maxLength={maxLength}
          multiline={multiline}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor="#8a94a6"
          ref={inputRef}
          returnKeyType={returnKeyType}
          secureTextEntry={secureTextEntry}
          style={[styles.input, multiline === true && styles.multilineTextInput]}
          value={value}
        />
        {rightActionLabel !== undefined && onRightAction !== undefined ? (
          <Pressable accessibilityRole="button" onPress={onRightAction}>
            <Text style={styles.inlineActionText}>{rightActionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ConsentRow({ label, linkLabel, onValueChange, value }: { label: string; linkLabel: string; onValueChange(value: boolean): void; value: boolean }) {
  const checkboxVisualState = getConsentCheckboxVisualState(value);

  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={checkboxVisualState.accessibilityState} onPress={() => onValueChange(!value)} style={styles.consentRow}>
      <View style={[styles.checkboxBox, value && styles.checkboxBoxSelected]}>
        {checkboxVisualState.checkmark !== null ? <Text style={styles.checkboxCheckmark}>{checkboxVisualState.checkmark}</Text> : null}
      </View>
      <Text style={styles.consentText}>{label} <Text style={styles.linkText}>{linkLabel}</Text></Text>
    </Pressable>
  );
}

function PrimaryButton({ compact, disabled, label, loading, onPress }: { compact?: boolean; disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, compact === true && styles.compactButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#ffffff" /> : <Text style={[styles.primaryButtonText, compact === true && styles.compactButtonText]}>{label}</Text>}
    </Pressable>
  );
}

function SecondaryButton({ compact, disabled, label, loading, onPress }: { compact?: boolean; disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.secondaryButton, compact === true && styles.compactButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#0b57d0" /> : <Text style={[styles.secondaryButtonText, compact === true && styles.compactButtonText]}>{label}</Text>}
    </Pressable>
  );
}

function DangerButton({ compact, disabled, label, loading, onPress }: { compact?: boolean; disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.dangerButton, compact === true && styles.compactButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#b42318" /> : <Text style={[styles.dangerButtonText, compact === true && styles.compactButtonText]}>{label}</Text>}
    </Pressable>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.dataValue}>{value}</Text>
    </View>
  );
}

function MetricBlock({ label, tone, value }: { label: string; tone?: 'green' | 'neutral'; value: string }) {
  return (
    <View style={styles.metricBlock}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'green' && styles.metricValueGreen]}>{value}</Text>
    </View>
  );
}

function StatusChip({
  compact,
  label,
  large,
  tone,
}: {
  compact?: boolean;
  label: string;
  large?: boolean;
  tone: 'blue' | 'green' | 'neutral' | 'warning';
}) {
  const toneStyle = tone === 'blue'
    ? styles.statusChipBlue
    : tone === 'green'
      ? styles.statusChipGreen
      : tone === 'warning'
        ? styles.statusChipWarning
        : styles.statusChipNeutral;
  return (
    <Text style={[
      styles.statusChip,
      compact === true && styles.statusChipCompact,
      large === true && styles.statusChipLarge,
      toneStyle,
    ]}>
      {label}
    </Text>
  );
}

function TimelineRow({
  copyAccessibilityLabel,
  marker,
  meta,
  metaTone = 'neutral',
  onCopy,
  onPress,
  state,
  title,
}: {
  copyAccessibilityLabel: string;
  marker: string;
  meta?: string;
  metaTone?: 'blue' | 'green' | 'neutral';
  onCopy(): void;
  onPress(): void;
  state: 'completed' | 'current' | 'upcoming';
  title: string;
}) {
  return (
    <View style={[styles.timelineRow, state === 'current' && styles.timelineRowCurrent]}>
      <Pressable
        accessibilityLabel={`${marker}. ${title}${meta === undefined ? '' : `. ${meta}`}.`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.timelineRowMain, pressed && { opacity: 0.88 }]}
      >
        <Text style={[styles.timelineIndex, state === 'completed' && styles.timelineIndexCompleted, state === 'current' && styles.timelineIndexCurrent]}>{marker}</Text>
        <View style={styles.routeHeaderText}>
          <Text style={[styles.timelineTitle, state === 'completed' && styles.timelineTitleCompleted, state === 'current' && styles.timelineTitleCurrent]}>{title}</Text>
        </View>
        {meta !== undefined ? <Text style={[styles.timelineMeta, metaTone === 'blue' && styles.timelineMetaBlue, metaTone === 'green' && styles.timelineMetaGreen]}>{meta}</Text> : null}
      </Pressable>
      <Pressable
        accessibilityLabel={copyAccessibilityLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onCopy}
        style={({ pressed }) => [styles.timelineCopyButton, pressed && styles.timelineCopyButtonPressed]}
      >
        <Ionicons color="#0b57d0" name="copy-outline" size={16} />
      </Pressable>
    </View>
  );
}

function MapOverview({
  currentStepIndex,
  mapStyleUrl,
  route,
  showUserLocation = false,
}: {
  currentStepIndex: number;
  mapStyleUrl: string;
  route: AssignedRoute;
  showUserLocation?: boolean;
}) {
  const previewKey = route.routeMapPreview?.imageUrl ?? null;
  const interactiveMapKey = `${mapStyleUrl}:${route.id}:${route.routeGeometry?.coordinates.length ?? 0}:${showUserLocation ? 'live' : 'preview'}`;
  const [previewLoadState, setPreviewLoadState] = useState<{ key: string | null; status: 'failed' } | null>(null);
  const [interactiveMapState, setInteractiveMapState] = useState<{ key: string; status: 'failed' } | null>(null);
  const previewLoadStatus = previewLoadState?.key === previewKey ? previewLoadState.status : 'idle';
  const interactiveMapStatus = interactiveMapState?.key === interactiveMapKey ? interactiveMapState.status : 'idle';
  const previewState = resolveRouteMapPreviewState({
    loadStatus: previewLoadStatus,
    now: new Date(),
    preview: route.routeMapPreview,
  });

  const handleInteractiveMapUnavailable = useCallback(() => {
    setInteractiveMapState({ key: interactiveMapKey, status: 'failed' });
  }, [interactiveMapKey]);
  const canvasStyle = [styles.mapCanvas, styles.routeSessionMapCanvas];

  if (interactiveMapStatus === 'idle' && (showUserLocation || (route.routeGeometry !== null && route.routeGeometry.coordinates.length >= 2))) {
    return (
      <View style={canvasStyle}>
        <NativeRouteMapPreview
          compactRouteFocus
          currentStepIndex={currentStepIndex}
          mapStyleUrl={mapStyleUrl}
          onUnavailable={handleInteractiveMapUnavailable}
          route={route}
          showUserLocation={showUserLocation}
        />
      </View>
    );
  }

  if (previewState.kind === 'available') {
    return (
      <View style={canvasStyle}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={previewState.accessibilityLabel}
          onError={() => setPreviewLoadState({ key: previewKey, status: 'failed' })}
          resizeMode="contain"
          source={{ uri: previewState.imageUrl }}
          style={styles.mapPreviewImage}
        />
        <View style={styles.mapPreviewBadge}>
          <Text style={styles.mapPreviewBadgeText}>Route preview</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={canvasStyle}>
      <View style={[styles.mapBlock, styles.mapBlockOne]} />
      <View style={[styles.mapBlock, styles.mapBlockTwo]} />
      <View style={[styles.mapRoad, styles.mapRoadOne]} />
      <View style={[styles.mapRoad, styles.mapRoadTwo]} />
      <View style={[styles.mapRouteLine, styles.mapRouteLineOne]} />
      <View style={[styles.mapRouteLine, styles.mapRouteLineTwo]} />
      {route.stops.slice(0, 3).map((stop, index) => {
        const isCurrentStop = currentStepIndex === index + 1;

        return (
          <View key={stop.deliveryStopId} style={[styles.mapMarker, getMapMarkerStyle(index), isCurrentStop && styles.mapMarkerCurrent]}>
            <Text style={styles.mapMarkerText}>{stop.sequence}</Text>
          </View>
        );
      })}
      <View style={styles.mapLastMarker}><Text style={styles.mapLastMarkerText}>{currentStepIndex >= route.stops.length ? 'Last' : currentStepIndex === COMPANY_STEP_INDEX ? 'Pickup' : `Stop ${currentStepIndex}`}</Text></View>
      <View style={styles.mapPreviewFallback}>
        <Text style={styles.mapPreviewFallbackTitle}>Route preview</Text>
        <Text style={styles.mapPreviewFallbackText}>{previewState.message}</Text>
      </View>
    </View>
  );
}

function DeliveryPhotoActionSheet({
  disabled,
  onCancel,
  onSelectSource,
  visible,
}: {
  disabled?: boolean;
  onCancel(): void;
  onSelectSource(source: ProofPhotoCaptureSource): void;
  visible: boolean;
}) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const bottomChromePadding = getBottomChromePadding(bottomInset);

  if (!visible) {
    return null;
  }

  return (
    <View accessibilityViewIsModal style={styles.photoActionSheetOverlay}>
      <Pressable accessibilityLabel="Close Add Photo" accessibilityRole="button" onPress={onCancel} style={styles.photoActionSheetBackdrop} />
      <View style={[styles.photoActionSheetCard, { paddingBottom: bottomChromePadding + 8 }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.photoActionSheetTitle}>Add Photo</Text>
        <View style={styles.photoActionSheetActions}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onSelectSource('camera')}
            style={[styles.photoActionSheetAction, disabled === true && styles.buttonDisabled]}
          >
            <Text style={styles.photoActionSheetActionText}>Take Photo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onSelectSource('library')}
            style={[styles.photoActionSheetAction, disabled === true && styles.buttonDisabled]}
          >
            <Text style={styles.photoActionSheetActionText}>Choose from Album</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onCancel}
          style={[styles.photoActionSheetCancel, disabled === true && styles.buttonDisabled]}
        >
          <Text style={styles.photoActionSheetCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProofCameraScreen({
  disabled,
  onCancel,
  onCaptured,
  onOpenGallery,
}: {
  disabled?: boolean;
  onCancel(): void;
  onCaptured(uri: string): void;
  onOpenGallery(): void;
}) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);

  useEffect(() => {
    if (permission !== null) {
      return;
    }

    void requestPermission();
  }, [permission, requestPermission]);

  async function handleTakePhoto() {
    if (disabled === true || isTakingPhoto || !isCameraReady) {
      return;
    }

    setIsTakingPhoto(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri !== undefined && photo.uri.trim() !== '') {
        onCaptured(photo.uri);
        return;
      }

      setCameraError('Could not save this photo. Try again.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Camera capture failed.';
      console.warn(`[proof-camera] ${message}`);
      setCameraError(message);
    } finally {
      setIsTakingPhoto(false);
    }
  }

  if (permission?.granted !== true) {
    return (
      <View style={styles.proofCameraPermissionScreen}>
        <Text style={styles.pageTitleSmall}>Camera access needed</Text>
        <Text style={styles.bodyText}>Allow camera access to take a delivery photo.</Text>
        <PrimaryButton
          label={permission === null ? 'Checking Camera' : 'Allow Camera'}
          loading={permission === null}
          onPress={() => {
            void requestPermission();
          }}
        />
        <SecondaryButton label="Cancel" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.proofCameraScreen}>
      <CameraView
        active
        facing="back"
        flash={flashMode}
        mode="picture"
        onCameraReady={() => setIsCameraReady(true)}
        onMountError={(event) => {
          const message = event.message || 'Camera could not start.';
          console.warn(`[proof-camera] ${message}`);
          setCameraError(message);
        }}
        ref={cameraRef}
        style={styles.proofCameraPreview}
      />
      <View pointerEvents="none" style={styles.proofCameraDimTop} />
      <View pointerEvents="none" style={styles.proofCameraDimBottom} />
      <View pointerEvents="none" style={styles.proofCameraDimLeft} />
      <View pointerEvents="none" style={styles.proofCameraDimRight} />
      <View style={styles.proofCameraTopBar}>
        <Pressable accessibilityLabel="Close camera" accessibilityRole="button" disabled={disabled} onPress={onCancel} style={styles.proofCameraCloseButton}>
          <Text style={styles.proofCameraCloseText}>×</Text>
        </Pressable>
        <View style={styles.proofCameraInstructionCard}>
          <Text style={styles.proofCameraInstructionText}>Please make sure the package and surrounding location are clearly visible.</Text>
        </View>
      </View>
      <View pointerEvents="none" style={styles.proofCameraGuide}>
        <View style={[styles.proofCameraGuideCorner, styles.proofCameraGuideCornerTopLeft]} />
        <View style={[styles.proofCameraGuideCorner, styles.proofCameraGuideCornerTopRight]} />
        <View style={[styles.proofCameraGuideCorner, styles.proofCameraGuideCornerBottomLeft]} />
        <View style={[styles.proofCameraGuideCorner, styles.proofCameraGuideCornerBottomRight]} />
      </View>
      {cameraError !== null ? <Text style={[styles.proofCameraErrorText, { bottom: getBottomChromeOffset(bottomInset, 138) }]}>{cameraError}</Text> : null}
      <View style={[styles.proofCameraControls, { bottom: getBottomChromeOffset(bottomInset, 58) }]}>
        <Pressable accessibilityRole="button" disabled={disabled === true || isTakingPhoto} onPress={onOpenGallery} style={styles.proofCameraSideButton}>
          <Text style={styles.proofCameraSideButtonText}>Gallery</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled === true || isTakingPhoto || !isCameraReady}
          onPress={() => {
            void handleTakePhoto();
          }}
          style={[styles.proofCameraCaptureButton, (disabled === true || isTakingPhoto || !isCameraReady) && styles.buttonDisabled]}
        >
          <View style={styles.proofCameraCaptureInner} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled === true || isTakingPhoto}
          onPress={() => setFlashMode((current) => current === 'off' ? 'on' : 'off')}
          style={[styles.proofCameraSideButton, flashMode === 'on' && styles.proofCameraSideButtonActive]}
        >
          <Text style={styles.proofCameraSideButtonText}>Flash</Text>
        </Pressable>
      </View>
      <View style={[styles.proofCameraFooter, { paddingBottom: getBottomChromeOffset(bottomInset, 8) }]}>
        <Text style={styles.proofCameraFooterText}>This photo will be used as proof of delivery.</Text>
      </View>
    </View>
  );
}

function StatusBanner({ text, tone }: { text: string; tone: 'green' | 'warning' }) {
  return <Text style={[styles.statusBanner, tone === 'green' ? styles.statusBannerGreen : styles.statusBannerWarning]}>{text}</Text>;
}

function EmptyState({ body, minimal = false, title }: { body: string; minimal?: boolean; title: string }) {
  return (
    <View style={[styles.emptyCard, minimal && styles.emptyCardMinimal]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </View>
  );
}

function getDriverConsentServiceForCurrentSubmission(input: {
  fallback: DriverConsentService;
  refreshDriverAccess?: () => Promise<DriverAccessToken | null>;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverConsentService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    refreshDriverAccess: input.refreshDriverAccess,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverConsentService;
}

function getAssignedRouteServiceForCurrentSubmission(input: {
  fallback: AssignedRouteService;
  refreshDriverAccess?: () => Promise<DriverAccessToken | null>;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): AssignedRouteService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    refreshDriverAccess: input.refreshDriverAccess,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).assignedRouteService;
}

function getDriverEventServiceForCurrentSubmission(input: {
  fallback: DriverEventService;
  refreshDriverAccess?: () => Promise<DriverAccessToken | null>;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverEventService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    refreshDriverAccess: input.refreshDriverAccess,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverEventService;
}

function getProofMediaUploadServiceForCurrentSubmission(input: {
  fallback: ProofMediaUploadService;
  refreshDriverAccess?: () => Promise<DriverAccessToken | null>;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): ProofMediaUploadService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    refreshDriverAccess: input.refreshDriverAccess,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).proofMediaUploadService;
}

function toInvitedRouteAccess(result: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }>): Extract<RouteAccessLookupResult, { status: 'INVITED' }> {
  return {
    status: 'INVITED',
    companyGuidance: result.companyGuidance,
    driverAccess: result.driverAccess,
    routeAccess: result.routeAccess,
  };
}

function getRouteChoicesFromSubmission(result: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' | 'route_choices' }>): RouteAccessRouteChoice[] {
  if (result.kind === 'route_choices') {
    return result.routes;
  }

  return [
    {
      companyGuidance: result.companyGuidance,
      driverAccess: result.driverAccess,
      routeAccess: result.routeAccess,
    },
  ];
}

function toCompanyGuidanceSubmission(choice: RouteAccessRouteChoice): Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }> {
  return {
    kind: 'company_guidance',
    flowState: 'company_context_confirmed',
    nextState: 'consent_required',
    companyGuidance: choice.companyGuidance,
    driverAccess: choice.driverAccess,
    routeAccess: choice.routeAccess,
  };
}

function getRouteSessionForAction(routeSessions: RouteSession[], routeId: string | null): RouteSession | null {
  if (routeId !== null) {
    return routeSessions.find((session) => session.route.id === routeId) ?? null;
  }

  return routeSessions[0] ?? null;
}

function formatRouteAccessProblem(result: RouteAccessSubmissionResult): string {
  if (result.kind === 'denied' || result.kind === 'multiple_matches') {
    return result.message;
  }

  return 'Route access requires review.';
}

function formatDriverPhoneEntryProblem(reason: 'country_required' | 'phone_invalid' | 'phone_required'): string {
  switch (reason) {
    case 'country_required':
      return 'Select a supported country before continuing.';
    case 'phone_invalid':
      return 'Enter a valid mobile phone number for the selected country.';
    case 'phone_required':
      return 'Enter the phone number registered with dispatch.';
  }
}

function getRestoredActiveDeliveryStartResult(): DeliveryStartResult {
  return {
    flowState: 'delivery_active',
    kind: 'delivery_active',
    locationPermission: 'foreground',
    message: 'Active route session restored on this device.',
  };
}

function clampRouteNavigationStepIndex(stepIndex: number, route: AssignedRoute): number {
  if (!Number.isInteger(stepIndex)) {
    return COMPANY_STEP_INDEX;
  }

  return Math.min(Math.max(stepIndex, COMPANY_STEP_INDEX), route.stops.length);
}

function getRouteStatus(deliveryStartResult: DeliveryStartResult | null, deliveryFinishResult: DeliveryFinishResult | null): RouteStatus {
  if (deliveryFinishResult?.flowState === 'delivery_finished') {
    return 'completed';
  }

  if (deliveryStartResult?.kind === 'delivery_active') {
    return 'active';
  }

  return 'ready';
}

function formatRouteStatus(status: RouteStatus): string {
  switch (status) {
    case 'active':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'ready':
      return 'Ready';
  }
}

function getCompletedDeliveryOutcome(stop: AssignedRouteStop): Exclude<CompletedDeliveriesFilter, 'all'> {
  return ['CANCELLED', 'FAILED', 'SKIPPED'].includes(stop.status.toUpperCase()) ? 'issues' : 'delivered';
}

function formatCompletedDeliveryStatus(stop: AssignedRouteStop): {
  label: string;
  tone: 'green' | 'warning';
} {
  switch (stop.status.toUpperCase()) {
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'warning' };
    case 'FAILED':
      return { label: 'Failed', tone: 'warning' };
    case 'SKIPPED':
      return { label: 'Skipped', tone: 'warning' };
    default:
      return { label: 'Delivered', tone: 'green' };
  }
}

function getRouteRegion(route: AssignedRoute): string {
  const cities = [...new Set(route.stops.map((stop) => stop.address.city).filter(Boolean))];
  return cities.length === 0 ? route.timezone : cities.join(', ');
}

function formatStopAddress(stop: AssignedRouteStop): string {
  return [
    stop.address.address1,
    stop.address.address2,
    stop.address.city,
    stop.address.province,
    stop.address.postalCode,
    stop.address.countryCode,
  ]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

function formatStopSearchAddress(stop: AssignedRouteStop): string {
  const street = stop.address.address1.trim();
  const city = stop.address.city.trim();
  if (street.length === 0) return city.length === 0 ? formatStopAddress(stop) : city;
  if (city.length === 0 || street.toLocaleLowerCase().includes(city.toLocaleLowerCase())) return street;
  return `${street}, ${city}`;
}

function formatStopStreetAddress(stop: AssignedRouteStop): string {
  const streetAddress = [stop.address.address1, stop.address.address2]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');

  return streetAddress.length === 0 ? formatStopAddress(stop) : streetAddress;
}

function getNavigationTip(input: {
  company: RouteAccessCompanyGuidance | null;
  isCompanyStep: boolean;
  stop: AssignedRouteStop | null;
}): string {
  if (input.isCompanyStep) {
    return input.company?.pickupGuidance ?? 'Confirm the pickup point and dispatch guidance before leaving.';
  }

  if (input.stop === null) {
    return 'Review the next stop before continuing.';
  }

  const area = input.stop.address.city || input.stop.address.province;
  return `${area} area. Check the building entrance and safe parking first, then record any stop-specific tip during completion.`;
}

function getProofDraft(draft?: StopProofDraft): StopProofDraft {
  return {
    additionalNotes: draft?.additionalNotes ?? '',
    locationTip: draft?.locationTip ?? '',
    todayNote: draft?.todayNote ?? '',
  };
}

function formatStopProofNote(draft: StopProofDraft): string {
  return [
    draft.todayNote.trim().length > 0 ? `Delivery result: ${draft.todayNote.trim()}` : null,
    draft.locationTip.trim().length > 0 ? `Location tip: ${draft.locationTip.trim()}` : null,
    draft.additionalNotes.trim().length > 0 ? `Other notes: ${draft.additionalNotes.trim()}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n') || 'Delivery completed.';
}

function formatPhotoResult(captureResult: ProofPhotoCaptureResult, uploadResult: ProofMediaUploadResult): string | null {
  if (captureResult.kind !== 'captured') {
    return captureResult.kind === 'cancelled' ? null : captureResult.message;
  }

  return uploadResult.kind === 'uploaded' ? null : uploadResult.message;
}

function formatStopProofResult(result: StopProofEventResult): string {
  if (result.kind === 'recorded') {
    return 'Stop completed.';
  }

  if (result.kind === 'queued') {
    return 'Saved offline. It will sync when connected.';
  }

  return result.message;
}

function getChipTone(status: RouteStatus): 'blue' | 'green' | 'neutral' {
  switch (status) {
    case 'active':
      return 'blue';
    case 'completed':
      return 'green';
    case 'ready':
      return 'neutral';
  }
}

function formatStopCount(count: number): string {
  return `${count} stop${count === 1 ? '' : 's'}`;
}

function formatLocalCompletedTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getMapMarkerStyle(index: number) {
  const positions = [
    { left: '18%', top: '26%' },
    { left: '47%', top: '38%' },
    { left: '64%', top: '52%' },
  ] as const;

  return positions[index] ?? positions[positions.length - 1];
}

function getFileNameFromUri(uri: string, deliveryStopId: string): string {
  const fileName = uri.split('/').pop()?.trim();
  return fileName === undefined || fileName === '' ? `${deliveryStopId}.jpg` : fileName;
}

const shadow = Platform.select({
  ios: {
    shadowColor: '#0f172a',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  android: {
    elevation: 3,
  },
  default: {},
});

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  safeArea: {
    backgroundColor: '#f7f9fc',
    flex: 1,
    position: 'relative',
  },
  driverRestoreScreen: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  driverRestoreBrand: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 36,
    marginBottom: 14,
  },
  driverRestoreTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
    marginTop: 4,
    textAlign: 'center',
  },
  driverRestoreBody: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 320,
    textAlign: 'center',
  },
  driverRestoreRetry: {
    marginTop: 8,
    width: '100%',
  },
  keyboardArea: {
    flex: 1,
  },
  standardScreenFrame: {
    flex: 1,
  },
  scrollStage: {
    flex: 1,
    overflow: 'hidden',
  },
  scrollSurface: {
    backgroundColor: '#f7f9fc',
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  pullRefreshReveal: {
    alignItems: 'center',
    height: PULL_REFRESH_REVEAL_HEIGHT,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pullRefreshContent: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pullRefreshUpdatedAt: {
    color: '#667085',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  pullRefreshIcon: {
    position: 'absolute',
    right: -28,
  },
  container: {
    flexGrow: 1,
    gap: 22,
    padding: 22,
    paddingBottom: 28,
    paddingTop: 34,
  },
  containerWithFixedHeader: {
    paddingTop: 18,
  },
  routeSessionContainer: {
    gap: 0,
    paddingHorizontal: 0,
  },
  screenStack: {
    gap: 22,
    overflow: 'visible',
  },
  myRoutesPage: {
    gap: 8,
    overflow: 'visible',
  },
  backgroundLocationWarning: {
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  routeReconciliationWarning: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  routeReconciliationWarningCopy: {
    flex: 1,
    gap: 2,
  },
  routeReconciliationWarningTitle: {
    color: '#7c2d12',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  routeReconciliationWarningBody: {
    color: '#9a3412',
    fontSize: 12,
    lineHeight: 17,
  },
  routeReconciliationActionButton: {
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 112,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  routeReconciliationActionButtonPressed: {
    backgroundColor: '#fed7aa',
  },
  routeReconciliationActionButtonText: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '800',
  },
  backgroundLocationWarningCopy: {
    flex: 1,
    gap: 2,
  },
  backgroundLocationWarningTitle: {
    color: '#78350f',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  backgroundLocationWarningBody: {
    color: '#92400e',
    fontSize: 12,
    lineHeight: 17,
  },
  backgroundLocationSettingsButton: {
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 104,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backgroundLocationSettingsButtonPressed: {
    backgroundColor: '#fde68a',
  },
  backgroundLocationSettingsButtonText: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '800',
  },
  routeSyncState: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 72,
  },
  routeSyncTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 25,
    textAlign: 'center',
  },
  routeSyncBody: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
    textAlign: 'center',
  },
  pageHeader: {
    gap: 6,
    paddingTop: 8,
  },
  pageTitleSmall: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
  },
  helperText: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
  },
  bodyText: {
    color: '#475467',
    fontSize: 15,
    lineHeight: 23,
  },
  brandPanel: {
    alignItems: 'center',
    gap: 10,
    minHeight: 240,
    justifyContent: 'center',
    paddingTop: 28,
  },
  brandName: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  brandBlue: {
    color: '#0b57d0',
  },
  brandGreen: {
    color: '#079455',
  },
  brandTagline: {
    color: '#111827',
    fontSize: 21,
    lineHeight: 29,
    maxWidth: 260,
    textAlign: 'center',
  },
  formCard: {
    gap: 18,
    overflow: 'visible',
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 14,
  },
  countrySelectorButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  countrySelectorText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  countryCallingCodeText: {
    backgroundColor: '#eef6ff',
    borderRadius: 999,
    color: '#0b57d0',
    fontSize: 14,
    fontWeight: '900',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countrySelectionFrame: {
    flex: 1,
  },
  countrySelectionScreen: {
    flex: 1,
    gap: 18,
    padding: 22,
    paddingBottom: 28,
    paddingTop: 18,
  },
  countrySelectionList: {
    flex: 1,
  },
  countrySelectionListContent: {
    gap: 10,
    paddingBottom: 28,
  },
  countryRow: {
    borderColor: '#eef2f6',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  countryRowSelected: {
    backgroundColor: '#eef6ff',
    borderColor: '#0b57d0',
  },
  phoneInputShell: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
  },
  callingCodePill: {
    backgroundColor: '#eef6ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  callingCodeText: {
    color: '#0b57d0',
    fontSize: 15,
    fontWeight: '900',
  },
  input: {
    color: '#111827',
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  multilineInput: {
    alignItems: 'flex-start',
    minHeight: 112,
    paddingTop: 6,
  },
  multilineTextInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inlineActionText: {
    color: '#0b57d0',
    fontSize: 14,
    fontWeight: '800',
    paddingLeft: 10,
  },
  consentStack: {
    gap: 6,
  },
  consentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
  },
  checkboxBox: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#cfd6e4',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxBoxSelected: {
    backgroundColor: '#0b57d0',
    borderColor: '#0b57d0',
  },
  checkboxCheckmark: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 17,
  },
  consentText: {
    color: '#111827',
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  linkText: {
    color: '#0b57d0',
    fontWeight: '800',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 15,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#0b57d0',
    borderRadius: 15,
    borderWidth: 1.4,
    flex: 1,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  compactButton: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  compactButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#0b57d0',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#b42318',
    borderRadius: 15,
    borderWidth: 1.4,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerButtonText: {
    color: '#b42318',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonColumn: {
    gap: 12,
  },
  routeCardList: {
    gap: 14,
  },
  routeActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  routeActionButton: {
    flex: 1,
  },
  selectedRouteCard: {
    backgroundColor: '#ffffff',
    borderColor: '#0b57d0',
    borderRadius: 20,
    borderWidth: 1.6,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    ...shadow,
  },
  routeCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  routeHeaderText: {
    flex: 1,
    gap: 4,
  },
  routeCardTitle: {
    flex: 1,
    minWidth: 0,
  },
  routeDateText: {
    color: '#667085',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 0,
  },
  routeToggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  routeToggleText: {
    color: '#475467',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 22,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cardTitleSmall: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },
  dataRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  dataLabel: {
    color: '#667085',
    flex: 0.85,
    fontSize: 14,
    fontWeight: '700',
  },
  dataValue: {
    color: '#111827',
    flex: 1.15,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'right',
  },
  statusChip: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipCompact: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipLarge: {
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  statusChipBlue: {
    backgroundColor: '#e8f1ff',
    color: '#0b57d0',
  },
  statusChipGreen: {
    backgroundColor: '#dcfce7',
    color: '#087443',
  },
  statusChipNeutral: {
    backgroundColor: '#eef2f6',
    color: '#475467',
  },
  statusChipWarning: {
    backgroundColor: '#fff7ed',
    color: '#b45309',
  },
  settingsScreen: {
    gap: 28,
    paddingBottom: 12,
  },
  settingsSection: {
    gap: 10,
  },
  settingsSectionLabel: {
    color: '#7a8089',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginLeft: 16,
  },
  settingsGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    overflow: 'hidden',
  },
  settingsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 18,
  },
  settingsRowSeparated: {
    borderBottomColor: '#e9ecf1',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsRowPressed: {
    backgroundColor: '#f4f6f8',
  },
  settingsRowLabel: {
    color: '#24272c',
    flexShrink: 0,
    fontSize: 16,
    fontWeight: '500',
  },
  settingsRowValue: {
    color: '#7a8089',
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
  },
  settingsRowValueGroup: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
  },
  settingsNameEditor: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    gap: 14,
    padding: 18,
  },
  settingsAccountActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
  },
  settingsDeleteAccountText: {
    color: '#e11d48',
    fontSize: 16,
    fontWeight: '700',
  },
  settingsSignOutButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
  },
  settingsSignOutButtonPressed: {
    backgroundColor: '#fef2f2',
  },
  settingsSignOutText: {
    color: '#e11d48',
    fontSize: 16,
    fontWeight: '700',
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 18,
    ...shadow,
  },
  summaryGrid: {
    borderTopColor: '#eef2f6',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  metricBlock: {
    flex: 1,
    gap: 5,
  },
  metricLabel: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
  },
  metricValue: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  metricValueGreen: {
    color: '#087443',
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  proofPhotoPreview: {
    aspectRatio: 16 / 9,
    backgroundColor: '#f2f4f7',
    borderRadius: 14,
    width: '100%',
  },
  timelineCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  currentTaskCard: {
    backgroundColor: '#ffffff',
    borderColor: '#bfdbfe',
    borderRadius: 18,
    borderWidth: 1.4,
    gap: 14,
    padding: 16,
  },
  currentTaskAddressText: {
    color: '#374151',
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  currentTaskTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  currentTaskMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  routeSessionEtaRows: {
    gap: 4,
  },
  currentTaskStatusColumn: {
    alignItems: 'flex-end',
    gap: 5,
    marginLeft: 'auto',
  },
  currentTaskEtaText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
  },
  currentTaskEtaWarningText: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '800',
  },
  currentTaskPaymentAmount: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  timelineRow: {
    alignItems: 'center',
    borderBottomColor: '#e9ecf1',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  timelineRowCurrent: {
    backgroundColor: ROUTE_VISUAL_STATE_SURFACES.current,
    marginHorizontal: -18,
    paddingHorizontal: 22,
  },
  timelineRowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 32,
  },
  timelineCopyButton: {
    alignItems: 'center',
    borderColor: '#c7d7f5',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  timelineCopyButtonPressed: {
    backgroundColor: '#eef4ff',
  },
  timelineIndex: {
    backgroundColor: ROUTE_VISUAL_STATE_COLORS.upcoming,
    borderRadius: 6,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    height: 26,
    lineHeight: 26,
    overflow: 'hidden',
    textAlign: 'center',
    width: 30,
  },
  timelineIndexCompleted: {
    backgroundColor: ROUTE_VISUAL_STATE_COLORS.completed,
  },
  timelineIndexCurrent: {
    backgroundColor: ROUTE_VISUAL_STATE_COLORS.current,
  },
  timelineTitle: {
    color: '#344054',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  timelineTitleCurrent: {
    color: '#111827',
    fontWeight: '700',
  },
  timelineTitleCompleted: {
    color: ROUTE_VISUAL_STATE_COLORS.completed,
  },
  timelineMeta: {
    color: ROUTE_VISUAL_STATE_COLORS.completed,
    fontSize: 11,
    fontWeight: '700',
  },
  timelineMetaBlue: {
    color: '#0b57d0',
  },
  timelineMetaGreen: {
    color: '#087443',
  },
  routeSequenceList: {
    borderTopColor: '#e9ecf1',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  routeContentTabs: {
    backgroundColor: '#eef0f3',
    borderRadius: 14,
    flexDirection: 'row',
    minHeight: 54,
    padding: 3,
  },
  routeContentTab: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  routeContentTabActive: {
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
  },
  routeContentTabText: {
    color: '#667085',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  routeContentTabTextActive: {
    color: '#111827',
    fontWeight: '800',
  },
  routeInventory: {
    borderTopColor: '#e9ecf1',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  routeInventorySummary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: 10,
  },
  routeInventoryGroup: {
    borderTopColor: '#e9ecf1',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  routeInventoryGroupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
  },
  routeInventoryStop: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  routeInventoryOrder: {
    color: '#667085',
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  routeInventoryItemRow: {
    alignItems: 'flex-start',
    borderTopColor: '#eef2f6',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 48,
    paddingVertical: 10,
  },
  routeInventoryItemQuantity: {
    color: '#087443',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    width: 58,
  },
  statusDot: {
    backgroundColor: '#12b76a',
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  statusDotFar: {
    backgroundColor: '#d97706',
  },
  statusDotUnavailable: {
    backgroundColor: '#6b7280',
  },
  mapCanvas: {
    backgroundColor: '#f3f8fb',
    height: 430,
    overflow: 'hidden',
    position: 'relative',
  },
  routeSessionActions: {
    gap: 12,
    padding: 18,
  },
  routeSessionHeader: {
    gap: 4,
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  routeSessionMap: {
    backgroundColor: '#f3f8fb',
    height: 430,
    overflow: 'hidden',
  },
  routeSessionMapCanvas: {
    height: 430,
  },
  routeSessionMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'center',
  },
  routeSessionMeta: {
    color: '#344054',
    fontSize: 15,
    fontWeight: '700',
  },
  pickupTimingGrid: {
    flexDirection: 'row',
    gap: 18,
    paddingVertical: 2,
  },
  routeSessionPage: {
    overflow: 'visible',
  },
  routeSessionSection: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  proofCameraScreen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  proofCameraPreview: {
    flex: 1,
  },
  proofCameraPermissionScreen: {
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 22,
  },
  proofCameraTopBar: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 22,
    zIndex: 3,
  },
  proofCameraCloseButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    left: 14,
    position: 'absolute',
    top: 0,
    width: 40,
  },
  proofCameraCloseText: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 36,
  },
  proofCameraInstructionCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.66)',
    borderRadius: 10,
    flexDirection: 'row',
    left: 34,
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: 'absolute',
    right: 34,
    top: 46,
  },
  proofCameraInstructionText: {
    color: '#ffffff',
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'left',
  },
  proofCameraDimTop: {
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    height: '21%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  proofCameraDimBottom: {
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    bottom: 0,
    height: '27%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  proofCameraDimLeft: {
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    bottom: '27%',
    left: 0,
    position: 'absolute',
    top: '21%',
    width: 34,
  },
  proofCameraDimRight: {
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    bottom: '27%',
    position: 'absolute',
    right: 0,
    top: '21%',
    width: 34,
  },
  proofCameraGuide: {
    borderColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    bottom: '27%',
    left: 34,
    position: 'absolute',
    right: 34,
    top: '21%',
    zIndex: 2,
  },
  proofCameraGuideCorner: {
    borderColor: '#ffffff',
    height: 42,
    position: 'absolute',
    width: 42,
  },
  proofCameraGuideCornerTopLeft: {
    borderLeftWidth: 4,
    borderTopWidth: 4,
    left: -2,
    top: -2,
  },
  proofCameraGuideCornerTopRight: {
    borderRightWidth: 4,
    borderTopWidth: 4,
    right: -2,
    top: -2,
  },
  proofCameraGuideCornerBottomLeft: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: -2,
    left: -2,
  },
  proofCameraGuideCornerBottomRight: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: -2,
    right: -2,
  },
  proofCameraControls: {
    alignItems: 'center',
    bottom: 66,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 36,
    position: 'absolute',
    right: 36,
    zIndex: 3,
  },
  proofCameraSideButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 12, 12, 0.62)',
    borderRadius: 999,
    minWidth: 68,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  proofCameraSideButtonActive: {
    opacity: 0.82,
  },
  proofCameraSideButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  proofCameraCaptureButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 4,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  proofCameraCaptureInner: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    height: 52,
    width: 52,
  },
  proofCameraErrorText: {
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 29, 29, 0.82)',
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    bottom: 146,
    textAlign: 'center',
    zIndex: 4,
  },
  proofCameraFooter: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    left: 0,
    paddingBottom: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    position: 'absolute',
    right: 0,
    zIndex: 2,
  },
  proofCameraFooterText: {
    color: '#ffffff',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  mapPreviewImage: {
    height: '100%',
    width: '100%',
  },
  mapPreviewBadge: {
    backgroundColor: 'rgba(12, 18, 32, 0.76)',
    borderRadius: 999,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
    top: 16,
  },
  mapPreviewBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  mapPreviewFallback: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderColor: '#d0d5dd',
    borderRadius: 18,
    borderWidth: 1,
    bottom: 24,
    left: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    position: 'absolute',
    right: 18,
  },
  mapPreviewFallbackTitle: {
    color: '#101828',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },
  mapPreviewFallbackText: {
    color: '#475467',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  mapBlock: {
    backgroundColor: '#dff3e8',
    borderRadius: 10,
    opacity: 0.78,
    position: 'absolute',
  },
  mapBlockOne: {
    height: 90,
    left: 18,
    top: 86,
    transform: [{ rotate: '-8deg' }],
    width: 86,
  },
  mapBlockTwo: {
    height: 120,
    right: 30,
    top: 140,
    transform: [{ rotate: '10deg' }],
    width: 78,
  },
  mapRoad: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    height: 8,
    opacity: 0.95,
    position: 'absolute',
    width: 380,
  },
  mapRoadOne: {
    left: -30,
    top: 130,
    transform: [{ rotate: '24deg' }],
  },
  mapRoadTwo: {
    left: -10,
    top: 250,
    transform: [{ rotate: '-18deg' }],
  },
  mapRouteLine: {
    backgroundColor: '#0b57d0',
    borderRadius: 999,
    height: 7,
    position: 'absolute',
  },
  mapRouteLineOne: {
    left: 76,
    top: 144,
    transform: [{ rotate: '28deg' }],
    width: 154,
  },
  mapRouteLineTwo: {
    left: 186,
    top: 212,
    transform: [{ rotate: '72deg' }],
    width: 140,
  },
  currentLocationPulse: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 87, 208, 0.16)',
    borderColor: 'rgba(11, 87, 208, 0.18)',
    borderRadius: 54,
    borderWidth: 14,
    height: 108,
    justifyContent: 'center',
    left: '40%',
    position: 'absolute',
    top: '42%',
    width: 108,
  },
  currentLocationDot: {
    backgroundColor: '#0b57d0',
    borderColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 4,
    height: 28,
    width: 28,
  },
  mapMarker: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    width: 30,
  },
  mapMarkerCurrent: {
    backgroundColor: ROUTE_VISUAL_STATE_COLORS.current,
    borderColor: '#ffffff',
    borderRadius: 19,
    borderWidth: 3,
    height: 38,
    width: 38,
  },
  mapMarkerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  mapLastMarker: {
    backgroundColor: '#475467',
    borderRadius: 16,
    bottom: 110,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    right: 22,
  },
  mapLastMarkerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  photoActionSheetOverlay: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  photoActionSheetBackdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  photoActionSheetCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 22,
    paddingTop: 10,
    ...shadow,
  },
  photoActionSheetTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  photoActionSheetActions: {
    gap: 8,
  },
  photoActionSheetAction: {
    alignItems: 'center',
    borderColor: '#0b57d0',
    borderRadius: 14,
    borderWidth: 1.2,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  photoActionSheetActionText: {
    color: '#0b57d0',
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 18,
  },
  photoActionSheetCancel: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dc2626',
    borderRadius: 14,
    borderWidth: 1.2,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  photoActionSheetCancelText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 18,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#c7cdd8',
    borderRadius: 999,
    height: 4,
    width: 48,
  },
  labelText: {
    color: '#667085',
    fontSize: 13,
    fontWeight: '700',
  },
  sheetTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  stopDetailsPage: {
    gap: 0,
    paddingBottom: 96,
  },
  stopDetailsAddressRow: {
    alignItems: 'center',
    borderBottomColor: '#d9dee8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  stopDetailsAddress: {
    color: '#111827',
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
  stopDetailsSection: {
    borderBottomColor: '#e4e7ec',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingVertical: 16,
  },
  stopDetailsSectionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  stopDetailsPaymentSection: {
    alignItems: 'stretch',
  },
  stopDetailsCustomerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  stopDetailsCustomerIdentity: {
    flex: 1,
    gap: 3,
  },
  stopDetailsCustomerName: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  stopDetailsCustomerPhone: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
  },
  stopDetailsCustomerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  stopDetailsContactIconButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#c7d7f5',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  stopDetailsContactIconButtonPressed: {
    backgroundColor: '#eef4ff',
  },
  stopDetailsPaymentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  stopDetailsPaymentContext: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  stopDetailsPaymentMethod: {
    color: '#111827',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  stopDetailsItemHeader: {
    flexDirection: 'row',
    paddingBottom: 2,
  },
  stopDetailsItemQuantityHeader: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
    width: 58,
  },
  stopDetailsItemContentHeader: {
    color: '#667085',
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  stopDetailsItemRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    minHeight: 44,
    paddingVertical: 9,
  },
  stopDetailsItemRowSeparated: {
    borderBottomColor: '#eef2f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stopDetailsItemQuantity: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    width: 58,
  },
  stopDetailsItemContent: {
    flex: 1,
    gap: 3,
  },
  stopDetailsItemNamePrimary: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  stopDetailsItemNameSecondary: {
    color: '#344054',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  stopDetailsItemOptions: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 17,
  },
  stopDetailsNote: {
    color: '#475467',
    fontSize: 15,
    lineHeight: 22,
  },
  stopDetailsActions: {
    gap: 10,
  },
  stopDetailsActionStack: {
    gap: 10,
    paddingTop: 18,
  },
  stopDetailsAction: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.4,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  stopDetailsActionArrive: {
    backgroundColor: '#0b57d0',
    borderColor: '#0b57d0',
  },
  stopDetailsActionSecondary: {
    backgroundColor: '#ffffff',
    borderColor: '#0b57d0',
  },
  stopDetailsActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  stopDetailsActionSecondaryText: {
    color: '#0b57d0',
  },
  stopDetailsSkipAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#b42318',
    borderColor: '#b42318',
    borderRadius: 12,
    borderWidth: 1.4,
    height: 44,
    justifyContent: 'center',
  },
  stopDetailsSkipActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  nearbyBanner: {
    alignItems: 'center',
    backgroundColor: '#ecfdf3',
    borderColor: '#bbf7d0',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  nearbyBannerFar: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  nearbyBannerUnavailable: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  nearbyTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  statusBanner: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    padding: 12,
  },
  statusBannerGreen: {
    backgroundColor: '#ecfdf3',
    borderColor: '#bbf7d0',
    color: '#087443',
  },
  statusBannerWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    color: '#92400e',
  },
  completedDeliveriesPage: {
    gap: 18,
    paddingBottom: 28,
  },
  completedRouteHeader: {
    gap: 3,
  },
  completedSummaryRow: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  completedMetric: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
  },
  completedMetricValue: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  completedMetricLabel: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  filterRow: {
    borderBottomColor: '#d9dee8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  completedFilterTab: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  completedFilterTabActive: {
    borderBottomColor: '#0b57d0',
  },
  completedFilterText: {
    color: '#667085',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  completedFilterTextActive: {
    color: '#0b57d0',
    fontWeight: '800',
  },
  completedList: {
    minHeight: 80,
  },
  completedRow: {
    alignItems: 'center',
    borderBottomColor: '#eef2f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingVertical: 13,
  },
  completedRowLast: {
    borderBottomWidth: 0,
  },
  completedRowPressed: {
    backgroundColor: '#f2f6fc',
  },
  completedRowPrimary: {
    flex: 1,
    gap: 3,
  },
  completedRowTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  completedMetaColumn: {
    alignItems: 'flex-end',
    gap: 4,
  },
  completedTimeText: {
    color: '#667085',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 17,
  },
  completedRowDetail: {
    color: '#0b57d0',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  emptyCardMinimal: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    elevation: 0,
    paddingHorizontal: 0,
    paddingVertical: 20,
    shadowOpacity: 0,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
});
