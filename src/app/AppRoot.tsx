import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Speech from 'expo-speech';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  PanResponder,
  InteractionManager,
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
  createMockAssignedRouteService,
  formatAssignedRouteItemLine,
  formatAssignedRouteDistance,
  formatAssignedRouteDuration,
  formatAssignedRoutePaymentStatus,
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
  getCurrentRouteStop,
  getStopDetailsProgressState,
  ROUTE_COMPANY_STEP_INDEX,
} from '../domain/route/routeStepProgress';
import {
  recordContinuousLocationUpdateBatch,
  startContinuousLocationUpdatesAfterDeliveryStart,
  type ContinuousLocationStopResult,
  type ContinuousLocationStreamStartResult,
} from '../domain/location/continuousLocationStream';
import { finishDeliveryAfterActive, type DeliveryFinishResult } from '../domain/delivery/deliveryFinish';
import { startDeliveryWithForegroundPermission, type DeliveryStartResult } from '../domain/delivery/deliveryStart';
import { createDriverApiClientsFromRouteAccess } from '../api/deliveryServer/driverApiClients';
import { createMockDriverEventService, recordRouteStartedAfterDeliveryStart, type DriverEventService, type RouteStartedRecordResult } from '../domain/events/driverEvents';
import { createExpoContinuousLocationStreamService, registerContinuousLocationTaskHandler } from '../platform/expo/location/expoContinuousLocationStreamService';
import { createExpoForegroundLocationPermissionService } from '../platform/expo/location/expoLocationPermissionService';
import { createExpoOfflineSubmissionQueueStorage } from '../platform/expo/storage/expoOfflineSubmissionQueueStorage';
import { createExpoProofPhotoCaptureService } from '../platform/expo/camera/expoProofPhotoCaptureService';
import { createExpoSecureDriverAccessTokenStore } from '../platform/expo/secureStore/expoSecureDriverAccessTokenStore';
import { createPersistentOfflineSubmissionQueue, type OfflineSubmissionQueue } from '../domain/offline/offlineSubmissionQueue';
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
import { recordStopProofEventAfterDeliveryStart, type StopProofEventResult } from '../domain/stop/stopProofEvents';
import { openRouteNavigation, openStopNavigation } from '../domain/stop/stopNavigation';
import {
  getCountrySelectorRowText,
  getSelectedCountryCardText,
} from '../ui/components/countrySelectorBehavior';
import {
  getConsentCheckboxVisualState,
} from '../ui/components/authFormUxBehavior';
import { TransientToast } from '../ui/components/TransientToast';
import { scheduleTransientToastDismiss } from '../ui/components/transientToastBehavior';
import {
  buildAuthFailureMessage,
  buildAuthSuccessMessage,
  getRuntimeHostLabel,
} from './authDiagnostics';
import { NativeRouteMapPreview } from './NativeRouteMapPreview';
import { getBottomChromeOffset, getBottomChromePadding } from './appLayoutMetrics';
import { formatRouteListUpdatedAt } from './routeListBehavior';
import { readDriverMapStyleUrl } from './routeMapGeoJson';
import {
  getStopArrivalNotificationCandidate,
  type StopArrivalNotificationData,
} from '../domain/notifications/stopArrivalNotifications';
import { createExpoStopArrivalNotificationService } from '../platform/expo/notifications/expoStopArrivalNotificationService';
import { requestRouteStartSessionConfirmation } from './routeStartConfirmation';
import {
  buildRoutePreviewSequence,
  buildRoutePreviewRegionItems,
  ROUTE_PREVIEW_COPY,
  ROUTE_PREVIEW_LABELS,
} from './routePreviewBehavior';

type AppScreen =
  | 'accountName'
  | 'arrivalCheck'
  | 'completedDeliveries'
  | 'countrySelect'
  | 'liveTracking'
  | 'liveMapPreview'
  | 'loginPhone'
  | 'loginDetail'
  | 'mainTabs'
  | 'proofCamera'
  | 'routePreview'
  | 'routeSession'
  | 'settings'
  | 'stopCompleted'
  | 'stopDetails';
type RouteStatus = RouteSessionStatus;
type StopDetailsBackTarget = 'liveTracking' | 'routeSession';
type MapPreviewBackTarget = 'liveTracking' | 'routePreview' | 'routeSession';

type StopProofDraft = {
  additionalNotes: string;
  locationTip: string;
  todayNote: string;
};

type RouteSession = RouteAccessRouteChoice & {
  route: AssignedRoute;
};

type RouteLoadOptions = {
  allowVerifiedDriverNoRoute?: boolean;
  activeRouteSession?: PersistedActiveRouteSession | null;
  navigateOnSuccess?: boolean;
  resetProgress?: boolean;
  successMessagePrefix?: string;
};

const COMPANY_STEP_INDEX = ROUTE_COMPANY_STEP_INDEX;
const DRIVER_APP_VERSION = '1.0.0';
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
const SWIPE_BACK_DISTANCE = 90;
const SWIPE_BACK_EDGE_WIDTH = 36;
const SWIPE_BACK_MAX_VERTICAL_DELTA = 90;
const SWIPE_BACK_DIRECTIONALITY_RATIO = 1.45;

function runAfterUiInteractions(callback: () => void): void {
  InteractionManager.runAfterInteractions(callback);
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
  const [screen, setScreen] = useState<AppScreen>('loginPhone');
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
  const [stopDetailsBackTarget, setStopDetailsBackTarget] = useState<StopDetailsBackTarget>('liveTracking');
  const [mapPreviewBackTarget, setMapPreviewBackTarget] = useState<MapPreviewBackTarget>('routeSession');
  const [routeSessions, setRouteSessions] = useState<RouteSession[]>([]);
  const [pendingStopArrivalNotification, setPendingStopArrivalNotification] = useState<StopArrivalNotificationData | null>(null);

  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [, setConsentSubmission] = useState<DriverConsentSubmissionResult | null>(null);
  const [deliveryStartResult, setDeliveryStartResult] = useState<DeliveryStartResult | null>(null);
  const [deliveryFinishResult, setDeliveryFinishResult] = useState<DeliveryFinishResult | null>(null);
  const [routeStartedEventResult, setRouteStartedEventResult] = useState<RouteStartedRecordResult | null>(null);
  const [continuousLocationResult, setContinuousLocationResult] = useState<ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null>(null);
  const [stopProofResults, setStopProofResults] = useState<Record<string, StopProofEventResult>>({});
  const [proofDrafts, setProofDrafts] = useState<Record<string, StopProofDraft>>({});
  const [proofPhotoResults, setProofPhotoResults] = useState<Record<string, ProofPhotoCaptureResult>>({});
  const [proofMediaResults, setProofMediaResults] = useState<Record<string, ProofMediaUploadResult>>({});
  const [completedStopIds, setCompletedStopIds] = useState<string[]>([]);
  const [completedStopTimes, setCompletedStopTimes] = useState<Record<string, string>>({});
  const [recentlyCompletedStopId, setRecentlyCompletedStopId] = useState<string | null>(null);
  const [offlineSubmissionQueue, setOfflineSubmissionQueue] = useState<OfflineSubmissionQueue | null>(null);
  const [, setOfflineQueueCount] = useState(0);
  const [lastRoutesUpdatedAt, setLastRoutesUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingAccountProfile, setIsLoadingAccountProfile] = useState(false);
  const [isSavingAccountName, setIsSavingAccountName] = useState(false);
  const [isRefreshingRoutes, setIsRefreshingRoutes] = useState(false);
  const [isStartingRoute, setIsStartingRoute] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isPhotoActionSheetVisible, setIsPhotoActionSheetVisible] = useState(false);
  const [isCompletingStop, setIsCompletingStop] = useState(false);
  const [isFinishingRoute, setIsFinishingRoute] = useState(false);
  const selectedRouteIdRef = useRef<string | null>(null);
  const routesAtTopRef = useRef(true);
  const [areRoutesAtTop, setAreRoutesAtTop] = useState(true);
  const isPullRefreshingRef = useRef(false);
  const pullRefreshOffset = useSharedValue(0);
  const notifiedStopArrivalIdsRef = useRef<Set<string>>(new Set());
  const hasCheckedInitialStopArrivalNotificationRef = useRef(false);
  const hasAttemptedDriverRestoreRef = useRef(false);

  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);

  const driverAccessTokenStore = useMemo(() => createExpoSecureDriverAccessTokenStore(), []);
  const foregroundLocationPermissionService = useMemo(() => createExpoForegroundLocationPermissionService(), []);
  const continuousLocationStreamService = useMemo(() => createExpoContinuousLocationStreamService(), []);
  const stopArrivalNotificationService = useMemo(() => createExpoStopArrivalNotificationService(), []);
  const proofPhotoCaptureService = useMemo(() => createExpoProofPhotoCaptureService(), []);
  const offlineSubmissionQueueStorage = useMemo(() => createExpoOfflineSubmissionQueueStorage(), []);
  const mockDriverEventService = useMemo(() => createMockDriverEventService(), []);
  const mockDriverConsentService = useMemo(() => createMockDriverConsentService(), []);
  const mockAssignedRouteService = useMemo(() => createMockAssignedRouteService({ status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute }), []);
  const mockProofMediaUploadService = useMemo(() => createMockProofMediaUploadService({ mode: 'success' }), []);
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
    }),
    [],
  );
  const driverMapStyleUrl = useMemo(() => readDriverMapStyleUrl(process.env.EXPO_PUBLIC_DRIVER_MAP_STYLE_URL), []);

  const runtimeServices = useMemo(() => createDriverRuntimeServices({ config: runtimeConfig }), [runtimeConfig]);
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

  function handleOpenAccountName(): void {
    setAccountNameDraft(accountName ?? '');
    setScreen('accountName');
  }

  function handleCloseAccountName(): void {
    setAccountNameDraft(accountName ?? '');
    setScreen('settings');
  }

  async function handleSaveAccountName(): Promise<void> {
    const name = accountNameDraft.trim();
    if (name.length === 0 || name.length > 80 || isSavingAccountName) {
      return;
    }

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
      setScreen('settings');
    } catch {
      setMessage('Name could not be updated. Check your connection and try again.');
    } finally {
      setIsSavingAccountName(false);
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
        await driverAccessTokenStore.clearCachedRouteAccess();
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
      void driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(refreshedSubmission)).catch((error) => {
        const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
        console.warn(`[driver-api] Refreshed route access could not be saved: ${errorMessage}`);
      });
      console.info('[driver-api] Refreshed route access after expired token.');
      return refreshedSubmission.driverAccess;
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
      console.warn(`[driver-api] Route access refresh failed: ${errorMessage}`);
      return null;
    }
  }, [driverAccessTokenStore, getActiveAccountAccess, routeAccessService, runtimeConfig.mode]);

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

  const selectedRouteSession = routeSessions.find((session) => session.route.id === selectedRouteId) ?? routeSessions[0] ?? null;
  const selectedRoute = selectedRouteSession?.route ?? null;
  const routeStatus = getRouteStatus(deliveryStartResult, deliveryFinishResult);
  const currentStop = selectedRoute === null ? null : getCurrentRouteStop({ navigationStepIndex, route: selectedRoute });
  const stopDetailsProgressState = selectedRoute === null
    ? null
    : getStopDetailsProgressState({
      navigationStepIndex,
      route: selectedRoute,
      selectedStopDetailsId,
    });
  const stopDetailsStop = stopDetailsProgressState?.stop ?? null;
  const isCompanyStep = navigationStepIndex === COMPANY_STEP_INDEX;
  const allStopsCompleted = selectedRoute !== null && selectedRoute.stops.every((stop) => completedStopIds.includes(stop.deliveryStopId));
  const currentCompany = selectedRouteSession?.companyGuidance ?? null;
  const recentlyCompletedStop = selectedRoute?.stops.find((stop) => stop.deliveryStopId === recentlyCompletedStopId) ?? null;

  const handleStopArrivalNotificationPress = useCallback((data: StopArrivalNotificationData) => {
    const routeSession = routeSessions.find((session) => session.route.id === data.routePlanId) ?? null;
    if (routeSession === null) {
      setPendingStopArrivalNotification(data);
      setMessage('Arrival alert opened. Loading assigned route before opening proof.');
      return;
    }

    const stopIndex = routeSession.route.stops.findIndex((candidate) => candidate.deliveryStopId === data.deliveryStopId);
    setPendingStopArrivalNotification(null);

    if (stopIndex < 0) {
      setMessage('Arrival alert opened, but the stop is no longer available on this route.');
      return;
    }

    if (completedStopIds.includes(data.deliveryStopId)) {
      setSelectedRouteId(routeSession.route.id);
      setSubmission(toCompanyGuidanceSubmission(routeSession));
      setNavigationStepIndex(stopIndex + 1);
      setScreen('routeSession');
      setMessage('This stop is already completed.');
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

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setSelectedStopDetailsId(null);
    setNavigationStepIndex(stopIndex + 1);
    setScreen('arrivalCheck');
    setMessage('Arrival alert opened. Add proof photo and delivery notes.');
  }, [completedStopIds, deliveryStartResult?.kind, routeSessions]);

  useEffect(() => {
    let isMounted = true;
    createPersistentOfflineSubmissionQueue({ storage: offlineSubmissionQueueStorage })
      .then((queue) => {
        if (!isMounted) {
          return;
        }

        setOfflineSubmissionQueue(queue);
        setOfflineQueueCount(queue.listPending().length);
      })
      .catch(() => {
        if (isMounted) {
          setMessage('Offline retry storage is unavailable. This session will retry in memory only.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [offlineSubmissionQueueStorage]);

  useEffect(() => scheduleTransientToastDismiss({
    dismiss: () => setMessage(null),
    message,
  }), [message]);

  useEffect(() => {
    const removeStopArrivalListener = stopArrivalNotificationService.addStopArrivalResponseListener(handleStopArrivalNotificationPress);
    if (!hasCheckedInitialStopArrivalNotificationRef.current) {
      hasCheckedInitialStopArrivalNotificationRef.current = true;
      void stopArrivalNotificationService.getLastStopArrivalResponse().then((data) => {
        if (data !== null) {
          handleStopArrivalNotificationPress(data);
        }
      });
    }

    return removeStopArrivalListener;
  }, [stopArrivalNotificationService, handleStopArrivalNotificationPress]);

  useEffect(() => {
    if (pendingStopArrivalNotification !== null && routeSessions.length > 0) {
      const timeout = setTimeout(() => {
        handleStopArrivalNotificationPress(pendingStopArrivalNotification);
      }, 0);

      return () => clearTimeout(timeout);
    }

    return undefined;
  }, [handleStopArrivalNotificationPress, pendingStopArrivalNotification, routeSessions.length]);

  useEffect(() => {
    if (deliveryStartResult?.kind !== 'delivery_active' || deliveryFinishResult?.flowState === 'delivery_finished') {
      return;
    }

    void stopArrivalNotificationService.registerForStopArrivalNotifications().then((result) => {
      if (result.kind !== 'registered') {
        setMessage(result.message);
      }
    });
  }, [deliveryFinishResult?.flowState, deliveryStartResult?.kind, stopArrivalNotificationService]);

  useEffect(() => {
    if (deliveryStartResult?.kind !== 'delivery_active' || deliveryFinishResult?.flowState === 'delivery_finished') {
      registerContinuousLocationTaskHandler(null);
      return;
    }

    registerContinuousLocationTaskHandler(async (locations) => {
      const queue = offlineSubmissionQueue;
      const routePlanId = selectedRoute?.id ?? null;
      if (queue === null || routePlanId === null) {
        return;
      }

      await recordContinuousLocationUpdateBatch({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          refreshDriverAccess: buildDriverAccessRefresh(submission),
          runtimeConfig,
          submission,
        }),
        locations,
        offlineQueue: queue,
        routePlanId,
      });
      setOfflineQueueCount(queue.listPending().length);

      const lastLocation = locations[locations.length - 1] ?? null;
      const candidate = getStopArrivalNotificationCandidate({
        completedStopIds,
        currentStepIndex: navigationStepIndex,
        isActiveRoute: routeStatus === 'active',
        lastLocation,
        notifiedStopIds: [...notifiedStopArrivalIdsRef.current],
        route: selectedRoute,
      });

      if (candidate !== null) {
        notifiedStopArrivalIdsRef.current.add(candidate.stop.deliveryStopId);
        await stopArrivalNotificationService.scheduleStopArrivalNotification(candidate);
      }
    });

    return () => registerContinuousLocationTaskHandler(null);
  }, [
    buildDriverAccessRefresh,
    completedStopIds,
    deliveryFinishResult,
    deliveryStartResult,
    mockDriverEventService,
    navigationStepIndex,
    offlineSubmissionQueue,
    routeStatus,
    runtimeConfig,
    selectedRoute,
    selectedRoute?.id,
    stopArrivalNotificationService,
    submission,
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
    setMessage(`Enter your 6-digit PIN. ${getRuntimeHostLabel(runtimeConfig)}.`);
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
    setMessage(`${isRegistration ? 'Creating account' : 'Signing in'}... ${getRuntimeHostLabel(runtimeConfig)}.`);
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
      setMessage(buildAuthSuccessMessage({
        runtimeConfig,
        phase: isRegistration ? 'invite_verify' : 'pin_login',
      }));
      setIsLoggingIn(false);
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

  function openHomeRoot() {
    setScreen('mainTabs');
  }

  const openVerifiedNoAssignedRoute = useCallback(() => {
    resetRouteProgress();
    setSubmission(null);
    setLastRoutesUpdatedAt(new Date());
    setScreen('mainTabs');
    void driverAccessTokenStore.clearCachedRouteAccess().catch(() => undefined);
  }, [driverAccessTokenStore]);

  const handleLoginAndLoadRoutes = useCallback(async (
    accountAccess: DriverAccountAccessToken,
    phoneE164: string,
    options: RouteLoadOptions = {},
  ) => {
    const allowVerifiedDriverNoRoute = options.allowVerifiedDriverNoRoute ?? false;
    const shouldResetProgress = options.resetProgress ?? true;
    const shouldNavigateOnSuccess = options.navigateOnSuccess ?? true;
    const successMessagePrefix = options.successMessagePrefix ?? 'assigned';
    setIsLoggingIn(true);
    setMessage(null);
    setVerifiedDriverPhoneE164(phoneE164);
    if (shouldResetProgress) {
      resetRouteProgress();
    }

    try {
      const lookupResult = await submitRouteAccess({
        accountAccessToken: accountAccess.accessToken,
      }, routeAccessService);
      setSubmission(lookupResult);

      if (lookupResult.kind !== 'company_guidance' && lookupResult.kind !== 'route_choices') {
        if (lookupResult.kind === 'denied' && lookupResult.status === 'NOT_FOUND') {
          await driverAccessTokenStore.clearCachedRouteAccess();
        }
        if (allowVerifiedDriverNoRoute && lookupResult.kind === 'denied' && lookupResult.status === 'NOT_FOUND') {
          openVerifiedNoAssignedRoute();
          return;
        }

        setMessage(formatRouteAccessProblem(lookupResult));
        return;
      }

      const choices = getRouteChoicesFromSubmission(lookupResult);
      if (choices.length === 0) {
        openVerifiedNoAssignedRoute();
        return;
      }

      const loadedSessions: RouteSession[] = [];

      for (const choice of choices) {
        const choiceSubmission = toCompanyGuidanceSubmission(choice);
        const consentResult = await submitDriverConsent(
          {
            appContext: { appVersion: DRIVER_APP_VERSION },
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
          setMessage(assignedRouteResult.message);
        }
      }

      if (loadedSessions.length === 0) {
        openVerifiedNoAssignedRoute();
        return;
      }

      const activeRouteSession = options.activeRouteSession ?? null;
      const restoredActiveSession = activeRouteSession === null
        ? null
        : loadedSessions.find((session) => session.route.id === activeRouteSession.routePlanId) ?? null;
      const currentSelectedRouteId = selectedRouteIdRef.current;
      const selectedRouteWasRemoved = currentSelectedRouteId !== null &&
        !loadedSessions.some((session) => session.route.id === currentSelectedRouteId);
      const activeRouteWasRemoved = activeRouteSession !== null && restoredActiveSession === null;
      if (selectedRouteWasRemoved || activeRouteWasRemoved) {
        resetRouteProgress();
        await driverAccessTokenStore.clearActiveRouteSession();
      }
      setRouteSessions(loadedSessions);
      setLastRoutesUpdatedAt(new Date());
      const nextSelectedRouteId = restoredActiveSession !== null
        ? restoredActiveSession.route.id
        : currentSelectedRouteId !== null && loadedSessions.some((session) => session.route.id === currentSelectedRouteId)
          ? currentSelectedRouteId
          : loadedSessions[0].route.id;
      setSelectedRouteId(nextSelectedRouteId);
      const selectedSession = loadedSessions.find((session) => session.route.id === nextSelectedRouteId) ?? loadedSessions[0];
      const firstSubmission = toCompanyGuidanceSubmission(selectedSession);
      setSubmission(firstSubmission);
      void driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(firstSubmission)).catch(() => {
        runAfterUiInteractions(() => {
          setMessage('Route loaded, but session persistence failed. Sign in again if the app does not restore this route next launch.');
        });
      });
      if (restoredActiveSession !== null) {
        const restoredStepIndex = clampRouteNavigationStepIndex(activeRouteSession?.navigationStepIndex ?? COMPANY_STEP_INDEX, restoredActiveSession.route);
        setDeliveryStartResult(getRestoredActiveDeliveryStartResult());
        setDeliveryFinishResult(null);
        setNavigationStepIndex(restoredStepIndex);
        setScreen('routeSession');
        runAfterUiInteractions(() => {
          setMessage('Active route session restored. Continue from the current pickup or stop step.');
        });
        return;
      }

      if (shouldNavigateOnSuccess) {
        setScreen('mainTabs');
      }
      const routeLoadSuccessMessage = `${loadedSessions.length} ${successMessagePrefix} route${loadedSessions.length === 1 ? '' : 's'} loaded. ${buildAuthSuccessMessage({ runtimeConfig, phase: 'route_access' })}`;
      runAfterUiInteractions(() => {
        setMessage(routeLoadSuccessMessage);
      });
    } catch (error) {
      const failure = buildAuthFailureMessage({
        runtimeConfig,
        phase: 'route_access',
        error,
      });
      if (failure.kind === 'server_401') {
        await driverAccessTokenStore.clear();
        resetRouteProgress();
        setVerifiedDriverPhoneE164(null);
        setScreen('loginPhone');
        setMessage('Your login expired. Sign in again with your phone number and PIN.');
      } else {
        setMessage(failure.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  }, [
    buildDriverAccessRefresh,
    driverAccessTokenStore,
    mockAssignedRouteService,
    mockDriverConsentService,
    openVerifiedNoAssignedRoute,
    routeAccessService,
    runtimeConfig,
  ]);

  const handleRefreshRoutes = useCallback(async () => {
    if (verifiedDriverPhoneE164 === null) {
      setMessage('Saved driver phone is unavailable. Sign in again to refresh routes.');
      return;
    }
    if (isRefreshingRoutes || isLoggingIn) {
      return;
    }

    setIsRefreshingRoutes(true);
    try {
      const restoredAccess = await driverAccessTokenStore.loadActiveDriverAccess();
      const accountAccess = await getActiveAccountAccess();
      if (accountAccess === null) {
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
          successMessagePrefix: 'refreshed assigned',
        },
      );
    } finally {
      setIsRefreshingRoutes(false);
    }
  }, [
    driverAccessTokenStore,
    getActiveAccountAccess,
    handleLoginAndLoadRoutes,
    isLoggingIn,
    isRefreshingRoutes,
    verifiedDriverPhoneE164,
  ]);

  const handlePullRefresh = useCallback(async () => {
    if (isPullRefreshingRef.current) {
      return;
    }

    isPullRefreshingRef.current = true;
    pullRefreshOffset.value = withSpring(PULL_REFRESH_REVEAL_HEIGHT, PULL_REFRESH_SPRING_CONFIG);
    try {
      await handleRefreshRoutes();
    } finally {
      pullRefreshOffset.value = withSpring(0, PULL_REFRESH_SPRING_CONFIG);
      isPullRefreshingRef.current = false;
    }
  }, [handleRefreshRoutes, pullRefreshOffset]);

  useEffect(() => {
    if (hasAttemptedDriverRestoreRef.current) {
      return undefined;
    }

    hasAttemptedDriverRestoreRef.current = true;
    let isMounted = true;
    driverAccessTokenStore.loadActiveDriverAccess().then(async (result) => {
      if (!isMounted) {
        return;
      }
      if (result.kind === 'expired' && result.driverProfile !== undefined) {
        setNationalPhoneInput(result.driverProfile.phoneE164);
        setMessage('Your saved login expired. Enter your PIN to continue.');
        return;
      }
      if (result.kind === 'active' || result.kind === 'refresh_required') {
        try {
          const accountAccess = result.kind === 'refresh_required'
            ? (await driverAuthService.refreshSession({
                refreshToken: result.accountAccess.refreshToken,
              })).accountAccess
            : result.accountAccess;
          if (result.kind === 'refresh_required') {
            await driverAccessTokenStore.saveRefreshedAccountAccess(accountAccess);
          }
          setNationalPhoneInput(result.driverProfile.phoneE164);
          setVerifiedDriverPhoneE164(result.driverProfile.phoneE164);
          await handleLoginAndLoadRoutes(
            accountAccess,
            result.driverProfile.phoneE164,
            {
              activeRouteSession: result.activeRouteSession ?? null,
              allowVerifiedDriverNoRoute: true,
            },
          );
        } catch {
          await driverAccessTokenStore.clear();
          if (isMounted) {
            setMessage('Your saved login could not be refreshed. Sign in with your phone number and PIN.');
            setScreen('loginPhone');
          }
        }
      }
    });
    return () => { isMounted = false; };
  }, [driverAccessTokenStore, driverAuthService, handleLoginAndLoadRoutes]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (
        state === 'active' &&
        screen === 'mainTabs' &&
        verifiedDriverPhoneE164 !== null
      ) {
        void handleRefreshRoutes();
      }
    });

    return () => subscription.remove();
  }, [handleRefreshRoutes, screen, verifiedDriverPhoneE164]);

  function handleStartRoute(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to start.');
      return;
    }

    requestRouteStartSessionConfirmation({
      alertApi: {
        alert: (title, message, buttons, options) => Alert.alert(title, message, buttons, options),
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
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to start.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    const activeSubmission = toCompanyGuidanceSubmission(routeSession);
    setSubmission(activeSubmission);
    await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(activeSubmission));
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

      const queue = offlineSubmissionQueue ?? undefined;
      const eventService = getDriverEventServiceForCurrentSubmission({
        fallback: mockDriverEventService,
        refreshDriverAccess: buildDriverAccessRefresh(activeSubmission),
        runtimeConfig,
        submission: activeSubmission,
      });
      const routeStartedResult = await recordRouteStartedAfterDeliveryStart({
        deliveryStart,
        driverEventService: eventService,
        offlineQueue: queue,
        routePlanId: routeSession.route.id,
      });
      setRouteStartedEventResult(routeStartedResult);

      const continuousResult = await startContinuousLocationUpdatesAfterDeliveryStart({
        deliveryStart,
        routePlanId: routeSession.route.id,
        streamService: continuousLocationStreamService,
      });
      setContinuousLocationResult(continuousResult);

      setNavigationStepIndex(COMPANY_STEP_INDEX);
      await driverAccessTokenStore.saveActiveRouteSession({
        navigationStepIndex: COMPANY_STEP_INDEX,
        routePlanId: routeSession.route.id,
      });
      setScreen('routeSession');
      setMessage('Route session started. Continue the pickup and stop workflow in the session.');
    } finally {
      setIsStartingRoute(false);
      refreshOfflineQueueCount();
    }
  }

  function handleOpenRoutePreview(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to review.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setScreen('routePreview');
  }

  function handleOpenRouteSession(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route session is available to continue.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setScreen('routeSession');
  }

  function openMapPreviewFrom(backTarget: MapPreviewBackTarget) {
    setMapPreviewBackTarget(backTarget);
    setScreen('liveMapPreview');
  }

  async function handleCallStop(stop: AssignedRouteStop | null) {
    const phone = stop?.phone ?? currentCompany?.operatorSupportContact;
    if (phone === null || phone === undefined || phone.trim().length === 0) {
      setMessage('No contact number is available for this stop.');
      return;
    }

    await Linking.openURL(`tel:${phone}`);
  }

  async function handleMessageStop(stop: AssignedRouteStop | null) {
    const phone = stop?.phone ?? currentCompany?.operatorSupportContact;
    if (phone === null || phone === undefined || phone.trim().length === 0) {
      setMessage('No message contact is available for this stop.');
      return;
    }

    await Linking.openURL(`sms:${phone}`);
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

  function handleArrivedAtStep() {
    if (selectedRoute === null) {
      return;
    }

    if (isCompanyStep) {
      setNavigationStepIndex(1);
      void driverAccessTokenStore.saveActiveRouteSession({
        navigationStepIndex: 1,
        routePlanId: selectedRoute.id,
      });
      setScreen('routeSession');
      setMessage('Company pickup confirmed. Continue to the first stop.');
      return;
    }

    setScreen('arrivalCheck');
    setMessage('You are near the destination. Add proof and complete the stop.');
  }

  function handleViewCurrentStop() {
    if (currentStop === null) {
      setMessage('The current step is the company pickup. Stop details begin after pickup is confirmed.');
      return;
    }

    setSelectedStopDetailsId(currentStop.deliveryStopId);
    setStopDetailsBackTarget('routeSession');
    setScreen('stopDetails');
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
    setStopDetailsBackTarget('routeSession');
    setScreen('stopDetails');
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

  function handleContinueAfterStopCompleted() {
    if (selectedRoute === null) {
      openHomeRoot();
      return;
    }

    if (allStopsCompleted) {
      setScreen('completedDeliveries');
      return;
    }

    setScreen('routeSession');
  }

  async function handleProofPhotoResult(input: {
    captureResult: ProofPhotoCaptureResult;
    route: AssignedRoute;
    stop: AssignedRouteStop;
  }) {
    const { captureResult, route, stop } = input;
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

    if (shouldQueueFailedProofMediaUpload(uploadResult) && captureResult.kind === 'captured') {
      offlineSubmissionQueue?.enqueueProofMediaUpload({
        deliveryStopId: stop.deliveryStopId,
        fileName: getFileNameFromUri(captureResult.uri, stop.deliveryStopId),
        routePlanId: route.id,
        source: captureResult.source,
        uri: captureResult.uri,
      });
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
    if (currentStop === null || selectedRoute === null || deliveryStartResult === null) {
      return;
    }

    const photoResult = proofPhotoResults[currentStop.deliveryStopId];
    if (photoResult?.kind !== 'captured') {
      setMessage('Add a delivery photo first.');
      return;
    }

    const mediaResult = proofMediaResults[currentStop.deliveryStopId];
    if (mediaResult?.kind !== 'uploaded') {
      setMessage(mediaResult?.kind === 'upload_failed' ? mediaResult.message : 'Photo is not uploaded yet. Add the photo again.');
      return;
    }

    setIsCompletingStop(true);
    setMessage(null);

    try {
      const draft = getProofDraft(proofDrafts[currentStop.deliveryStopId]);
      const result = await recordStopProofEventAfterDeliveryStart({
        deliveryStart: deliveryStartResult,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          refreshDriverAccess: buildDriverAccessRefresh(submission),
          runtimeConfig,
          submission,
        }),
        input: {
          action: 'delivered',
          deliveryStopId: currentStop.deliveryStopId,
          media: [mediaResult.media],
          note: formatStopProofNote(draft),
          photoUris: [photoResult.uri],
          routePlanId: selectedRoute.id,
        },
        offlineQueue: offlineSubmissionQueue ?? undefined,
      });
      setStopProofResults((current) => ({ ...current, [currentStop.deliveryStopId]: result }));

      if (result.kind === 'blocked') {
        setMessage(result.message);
        return;
      }

      const nextCompletedStopIds = [...new Set([...completedStopIds, currentStop.deliveryStopId])];
      setCompletedStopIds(nextCompletedStopIds);
      setCompletedStopTimes((current) => ({
        ...current,
        [currentStop.deliveryStopId]: formatLocalCompletedTime(new Date()),
      }));
      setRecentlyCompletedStopId(currentStop.deliveryStopId);

      const isLastStop = selectedRoute.stops.every((stop) => nextCompletedStopIds.includes(stop.deliveryStopId));
      if (isLastStop) {
        await finishRoute(selectedRoute);
        return;
      }

      const nextNavigationStepIndex = navigationStepIndex + 1;
      setNavigationStepIndex(nextNavigationStepIndex);
      await driverAccessTokenStore.saveActiveRouteSession({
        navigationStepIndex: nextNavigationStepIndex,
        routePlanId: selectedRoute.id,
      });
      setScreen('stopCompleted');
      setMessage('Stop completed. Continue to the next stop when ready.');
    } finally {
      setIsCompletingStop(false);
      refreshOfflineQueueCount();
    }
  }

  async function finishRoute(route: AssignedRoute) {
    if (deliveryStartResult === null) {
      return;
    }

    setIsFinishingRoute(true);
    try {
      const finishResult = await finishDeliveryAfterActive({
        deliveryStart: deliveryStartResult,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          refreshDriverAccess: buildDriverAccessRefresh(submission),
          runtimeConfig,
          submission,
        }),
        offlineQueue: offlineSubmissionQueue ?? undefined,
        routePlanId: route.id,
        streamService: continuousLocationStreamService,
      });
      setDeliveryFinishResult(finishResult);
      if (finishResult.kind !== 'blocked') {
        setContinuousLocationResult({ kind: 'stopped', taskName: finishResult.stoppedTaskName });
        await driverAccessTokenStore.clearActiveRouteSession();
      }
      setScreen('completedDeliveries');
      setMessage(finishResult.message);
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
    registerContinuousLocationTaskHandler(null);
    setRouteSessions([]);
    setConsentSubmission(null);
    setDeliveryStartResult(null);
    setDeliveryFinishResult(null);
    setRouteStartedEventResult(null);
    setContinuousLocationResult(null);
    notifiedStopArrivalIdsRef.current.clear();
    hasCheckedInitialStopArrivalNotificationRef.current = false;
    setPendingStopArrivalNotification(null);
    setStopProofResults({});
    setProofDrafts({});
    setProofPhotoResults({});
    setProofMediaResults({});
    setCompletedStopIds([]);
    setCompletedStopTimes({});
    setRecentlyCompletedStopId(null);
    setNavigationStepIndex(COMPANY_STEP_INDEX);
    setSelectedStopDetailsId(null);
    setStopDetailsBackTarget('liveTracking');
    setSelectedRouteId(null);
  }

  function refreshOfflineQueueCount() {
    setOfflineQueueCount(offlineSubmissionQueue?.listPending().length ?? 0);
  }

  async function handleLogout() {
    setMessage(null);
    if (offlineSubmissionQueue !== null) {
      const resetResult = await resetDriverSession({
        driverAccessTokenStore,
        offlineQueue: offlineSubmissionQueue,
      });
      setMessage(`Signed out. Cleared ${resetResult.clearedOfflineSubmissions} offline retry item${resetResult.clearedOfflineSubmissions === 1 ? '' : 's'}.`);
    } else {
      await driverAccessTokenStore.clear();
      setMessage('Signed out. Offline retry storage was not ready.');
    }

    resetRouteProgress();
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
      case 'routePreview':
      case 'routeSession':
        setScreen('mainTabs');
        return true;
      case 'liveTracking':
        setScreen('routeSession');
        return true;
      case 'liveMapPreview':
        setScreen(mapPreviewBackTarget);
        return true;
      case 'proofCamera':
        setScreen('arrivalCheck');
        return true;
      case 'stopDetails':
        setSelectedStopDetailsId(null);
        setScreen(stopDetailsBackTarget);
        return true;
      case 'arrivalCheck':
        setScreen('stopDetails');
        return true;
      case 'stopCompleted':
        setScreen('routeSession');
        return true;
      case 'completedDeliveries':
        setScreen('mainTabs');
        return true;
    }
  }, [accountName, mapPreviewBackTarget, screen, stopDetailsBackTarget]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleAppBack);
    return () => subscription.remove();
  }, [handleAppBack]);

  const swipeBackResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => {
      if (screen === 'loginPhone' || screen === 'mainTabs' || screen === 'liveMapPreview' || gestureState.x0 > SWIPE_BACK_EDGE_WIDTH) {
        return false;
      }

      const horizontalDistance = Math.abs(gestureState.dx);
      const verticalDistance = Math.abs(gestureState.dy);
      return horizontalDistance > 35 && horizontalDistance > verticalDistance * SWIPE_BACK_DIRECTIONALITY_RATIO;
    },
    onPanResponderRelease: (_event, gestureState) => {
      const horizontalDistance = Math.abs(gestureState.dx);
      const verticalDistance = Math.abs(gestureState.dy);

      if (horizontalDistance >= SWIPE_BACK_DISTANCE && verticalDistance <= SWIPE_BACK_MAX_VERTICAL_DELTA) {
        handleAppBack();
      }
    },
  }), [handleAppBack, screen]);
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
  const isFullMapScreen = screen === 'liveMapPreview' && selectedRoute !== null;
  const isProofCameraScreen = screen === 'proofCamera';

  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        {...swipeBackResponder.panHandlers}
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
          />
        ) : isFullMapScreen ? (
          <LiveMapPreviewScreen
            currentStepIndex={navigationStepIndex}
            mapStyleUrl={driverMapStyleUrl}
            onBack={() => setScreen(mapPreviewBackTarget)}
            route={selectedRoute}
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
          <View style={styles.scrollStage}>
            {screen === 'mainTabs' ? (
              <View pointerEvents="none" style={[styles.pullRefreshReveal, { top: topInset }]}>
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
                  contentContainerStyle={styles.container}
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
              isStartingRoute={isStartingRoute}
              onOpenCompletedDeliveries={() => setScreen('completedDeliveries')}
              onOpenRoutePreview={handleOpenRoutePreview}
              onContinueRoute={handleOpenRouteSession}
              onOpenSettings={handleOpenSettings}
              onSelectRoute={setSelectedRouteId}
              onStartRoute={handleStartRoute}
              routeSessions={routeSessions}
              routeStatus={routeStatus}
              selectedRouteId={selectedRouteId}
            />
          ) : null}

          {screen === 'settings' ? (
            <SettingsPage
              acceptedLocation={acceptedLocation}
              acceptedPrivacy={acceptedPrivacy}
              accountName={accountName}
              appVersion={DRIVER_APP_VERSION}
              isLoadingAccountProfile={isLoadingAccountProfile}
              onBack={openHomeRoot}
              onEditName={handleOpenAccountName}
              onLogout={handleLogout}
              phoneE164={verifiedDriverPhoneE164 ?? phoneE164Preview}
            />
          ) : null}

          {screen === 'accountName' ? (
            <AccountNamePage
              isSaving={isSavingAccountName}
              nameDraft={accountNameDraft}
              onBack={handleCloseAccountName}
              onChangeName={setAccountNameDraft}
              onSave={() => { void handleSaveAccountName(); }}
            />
          ) : null}

          {screen === 'routeSession' && selectedRoute !== null ? (
            <RouteSessionScreen
              allStopsCompleted={allStopsCompleted}
              company={currentCompany}
              completedStopIds={completedStopIds}
              continuousLocationResult={continuousLocationResult}
              currentNavigationStepIndex={navigationStepIndex}
              deliveryFinishResult={deliveryFinishResult}
              isFinishingRoute={isFinishingRoute}
              isStartingRoute={isStartingRoute}
              isCompanyStep={isCompanyStep}
              mapStyleUrl={driverMapStyleUrl}
              onArrived={handleArrivedAtStep}
              onBack={openHomeRoot}
              onFinishRoute={handleManualFinishRoute}
              onOpenMapPreview={() => openMapPreviewFrom('routeSession')}
              onOpenNavigation={() => handleOpenRouteNavigation(selectedRoute)}
              onOpenStop={handleOpenStopFromRouteSession}
              onStartRoute={() => handleStartRoute(selectedRoute.id)}
              onViewCurrentStop={handleViewCurrentStop}
              route={selectedRoute}
              routeStartedEventResult={routeStartedEventResult}
              routeStatus={routeStatus}
              stop={currentStop}
            />
          ) : null}

          {screen === 'liveTracking' && selectedRoute !== null ? (
            <LiveTrackingScreen
              company={currentCompany}
              isCompanyStep={isCompanyStep}
              onArrived={handleArrivedAtStep}
              onBack={() => setScreen('routeSession')}
              onOpenMapPreview={() => openMapPreviewFrom('liveTracking')}
              onOpenNavigation={() => handleOpenRouteNavigation(selectedRoute)}
              onViewStop={handleViewCurrentStop}
              route={selectedRoute}
              routeStatus={routeStatus}
              stop={currentStop}
            />
          ) : null}

          {screen === 'routePreview' && selectedRoute !== null ? (
            <RoutePreviewScreen
              mapStyleUrl={driverMapStyleUrl}
              onBack={openHomeRoot}
              onOpenMapPreview={() => openMapPreviewFrom('routePreview')}
              route={selectedRoute}
            />
          ) : null}

          {screen === 'stopDetails' && stopDetailsStop !== null ? (
            <StopDetailsScreen
              onBack={() => {
                handleAppBack();
              }}
              onCall={() => handleCallStop(stopDetailsStop)}
              onMessage={() => handleMessageStop(stopDetailsStop)}
              onOpenNavigation={() => handleOpenNavigationForStop(stopDetailsStop)}
              stop={stopDetailsStop}
            />
          ) : null}

          {screen === 'arrivalCheck' && currentStop !== null ? (
            <ArrivalCheckScreen
              draft={getProofDraft(proofDrafts[currentStop.deliveryStopId])}
              isCapturingPhoto={isCapturingPhoto}
              isCompletingStop={isCompletingStop || isFinishingRoute}
              onAnnounceTip={handleAnnounceCurrentTip}
              onBack={() => setScreen('stopDetails')}
              onAddPhoto={handleAddDeliveryPhoto}
              onCompleteStop={handleCompleteCurrentStop}
              onDraftChange={updateCurrentStopDraft}
              proofResult={stopProofResults[currentStop.deliveryStopId]}
              stop={currentStop}
            />
          ) : null}

          {screen === 'stopCompleted' && selectedRoute !== null ? (
            <StopCompletedScreen
              completedStop={recentlyCompletedStop}
              completedStopIds={completedStopIds}
              completedStopTimes={completedStopTimes}
              onBackToRoute={() => setScreen('routeSession')}
              onContinue={handleContinueAfterStopCompleted}
              route={selectedRoute}
            />
          ) : null}

          {screen === 'completedDeliveries' && selectedRoute !== null ? (
            <CompletedDeliveriesScreen
              completedStopIds={completedStopIds}
              completedStopTimes={completedStopTimes}
              onBack={openHomeRoot}
              proofMediaResults={proofMediaResults}
              route={selectedRoute}
            />
          ) : null}
                </ScrollView>
              </Reanimated.View>
            </GestureDetector>
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
        <Text style={styles.brandName}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Driver</Text></Text>
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
        <Text style={styles.brandName}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Driver</Text></Text>
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
  isStartingRoute,
  onOpenCompletedDeliveries,
  onOpenRoutePreview,
  onContinueRoute,
  onOpenSettings,
  onSelectRoute,
  onStartRoute,
  routeSessions,
  routeStatus,
  selectedRouteId,
}: {
  isStartingRoute: boolean;
  onOpenCompletedDeliveries(): void;
  onOpenRoutePreview(routeId: string): void;
  onContinueRoute(routeId: string): void;
  onOpenSettings(): void;
  onSelectRoute(routeId: string): void;
  onStartRoute(routeId: string): void;
  routeSessions: RouteSession[];
  routeStatus: RouteStatus;
  selectedRouteId: string | null;
}) {
  const classificationNow = new Date();
  const visibleRouteSessions = routeSessions;
  const activeSession = visibleRouteSessions.find((session) => session.route.id === selectedRouteId) ?? visibleRouteSessions[0] ?? null;
  const activeIndex = activeSession === null ? -1 : visibleRouteSessions.findIndex((session) => session.route.id === activeSession.route.id);
  const activeRouteStatus = activeSession === null
    ? null
    : classifyAssignedRouteSession({
      now: classificationNow,
      route: activeSession.route,
      selectedRouteId,
      selectedRouteStatus: routeStatus,
    });
  const [collapsedRouteKey, setCollapsedRouteKey] = useState<string | null>(null);
  const activeRouteCollapseKey = activeSession?.route.id ?? null;
  const isRouteCardExpanded = activeRouteCollapseKey === null || collapsedRouteKey !== activeRouteCollapseKey;

  function selectRelativeRoute(offset: number) {
    if (visibleRouteSessions.length === 0 || activeIndex < 0) {
      return;
    }

    const nextIndex = (activeIndex + offset + visibleRouteSessions.length) % visibleRouteSessions.length;
    onSelectRoute(visibleRouteSessions[nextIndex].route.id);
  }

  return (
    <View style={styles.myRoutesPage}>
      <View style={styles.myRoutesHeader}>
        <Text style={styles.pageTitle}>My Routes</Text>
        <Pressable
          accessibilityLabel="Settings"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenSettings}
          style={styles.settingsIconButton}
        >
          <Ionicons
            accessibilityElementsHidden
            color="#111827"
            importantForAccessibility="no-hide-descendants"
            name="settings"
            size={30}
          />
        </Pressable>
      </View>

      {activeSession !== null ? (
        <View style={styles.selectedRouteCard}>
          <Pressable
            accessibilityLabel={isRouteCardExpanded ? 'Collapse route details' : 'Expand route details'}
            accessibilityRole="button"
            onPress={() => {
              setCollapsedRouteKey((value) => value === activeRouteCollapseKey ? null : activeRouteCollapseKey);
            }}
            style={styles.routeCardHeader}
          >
            <View style={styles.routeInitialBadge}>
              <Text style={styles.routeInitialText}>{getInitials(activeSession.route.name)}</Text>
            </View>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={styles.cardTitle}>{activeSession.route.name}</Text>
              <Text numberOfLines={1} style={styles.helperText}>{activeSession.route.deliveryDate}</Text>
            </View>
            <View style={styles.routeCardStatusGroup}>
              <StatusChip
                tone={getChipTone(activeRouteStatus ?? 'upcoming')}
                label={formatRouteStatus(activeRouteStatus ?? 'upcoming')}
              />
              <Text style={styles.routeToggleText}>{isRouteCardExpanded ? '−' : '+'}</Text>
            </View>
          </Pressable>

          {isRouteCardExpanded ? (
            <>
              <DataRow label="Date" value={activeSession.route.deliveryDate} />
              <DataRow label="Region" value={getRouteRegion(activeSession.route)} />
              <DataRow label="Stops" value={formatStopCount(activeSession.route.stops.length)} />
              <DataRow label="Estimated Distance" value={formatAssignedRouteDistance(activeSession.route.routeMetrics)} />
              <DataRow label="Estimated Time" value={formatAssignedRouteDuration(activeSession.route.routeMetrics)} />

              {visibleRouteSessions.length > 1 ? (
                <View style={styles.routePagerRow}>
                  <SecondaryButton compact label="Previous Route" onPress={() => selectRelativeRoute(-1)} />
                  <Text style={styles.routePagerText}>Route {activeIndex + 1} of {visibleRouteSessions.length}</Text>
                  <SecondaryButton compact label="Next Route" onPress={() => selectRelativeRoute(1)} />
                </View>
              ) : null}

              {activeRouteStatus === 'completed' ? (
                <PrimaryButton label="View Completed Deliveries" onPress={onOpenCompletedDeliveries} />
              ) : activeRouteStatus === 'active' ? (
                <PrimaryButton label="Continue Session" onPress={() => onContinueRoute(activeSession.route.id)} />
              ) : (
                <View style={styles.buttonColumn}>
                  <PrimaryButton disabled={isStartingRoute} label="Start Session" loading={isStartingRoute} onPress={() => onStartRoute(activeSession.route.id)} />
                  <SecondaryButton label="Route Details" onPress={() => onOpenRoutePreview(activeSession.route.id)} />
                </View>
              )}
            </>
          ) : null}
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
  onBack,
  onEditName,
  onLogout,
  phoneE164,
}: {
  acceptedLocation: boolean;
  acceptedPrivacy: boolean;
  accountName: string | null;
  appVersion: string;
  isLoadingAccountProfile: boolean;
  onBack(): void;
  onEditName(): void;
  onLogout(): void;
  phoneE164: string | null;
}) {
  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsHeader}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.settingsBackButton,
            pressed && styles.settingsBackButtonPressed,
          ]}
        >
          <Ionicons color="#111827" name="chevron-back" size={30} />
        </Pressable>
        <Text style={styles.settingsHeaderTitle}>Settings</Text>
      </View>

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
          <View style={[styles.settingsRow, styles.settingsRowSeparated]}>
            <Text style={styles.settingsRowLabel}>Privacy</Text>
            <Text numberOfLines={1} style={styles.settingsRowValue}>
              {acceptedPrivacy ? 'Accepted' : 'Needs Review'}
            </Text>
          </View>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsRowLabel}>Location</Text>
            <Text numberOfLines={1} style={styles.settingsRowValue}>
              {acceptedLocation ? 'Accepted' : 'Needs Review'}
            </Text>
          </View>
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
  onBack,
  onChangeName,
  onSave,
}: {
  isSaving: boolean;
  nameDraft: string;
  onBack(): void;
  onChangeName(value: string): void;
  onSave(): void;
}) {
  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsHeader}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.settingsBackButton,
            pressed && styles.settingsBackButtonPressed,
          ]}
        >
          <Ionicons color="#111827" name="chevron-back" size={30} />
        </Pressable>
        <Text style={styles.settingsHeaderTitle}>Name</Text>
      </View>

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
          <Text style={styles.helperText}>This is your name in Clever Driver. Store display names can be different.</Text>
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



function RoutePreviewRegionBlock({ items }: { items: string[] }) {
  return (
    <View style={styles.routePreviewRegionBlock}>
      <Text style={styles.routePreviewRegionLabel}>{ROUTE_PREVIEW_LABELS.region}</Text>
      <View style={styles.routePreviewRegionList}>
        {items.map((item) => (
          <Text key={item} style={styles.routePreviewRegionItem}>{item}</Text>
        ))}
      </View>
    </View>
  );
}

function RoutePreviewScreen({
  mapStyleUrl,
  onBack,
  onOpenMapPreview,
  route,
}: {
  mapStyleUrl: string;
  onBack(): void;
  onOpenMapPreview(): void;
  route: AssignedRoute;
}) {
  const previewSequence = buildRoutePreviewSequence(route);

  return (
    <View style={styles.screenStack}>
      <ScreenHeader hideRightAction onBack={onBack} title={ROUTE_PREVIEW_COPY.title} />

      <View style={styles.summaryCard}>
        <DataRow label={ROUTE_PREVIEW_LABELS.date} value={route.deliveryDate} />
        <RoutePreviewRegionBlock items={buildRoutePreviewRegionItems(route)} />
        <View style={styles.summaryGrid}>
          <MetricBlock label={ROUTE_PREVIEW_LABELS.stops} value={formatStopCount(route.stops.length)} />
          <MetricBlock label={ROUTE_PREVIEW_LABELS.distance} value={formatAssignedRouteDistance(route.routeMetrics)} />
          <MetricBlock label={ROUTE_PREVIEW_LABELS.time} value={formatAssignedRouteDuration(route.routeMetrics)} />
        </View>
      </View>

      <View style={styles.routePreviewCard}>
        <Text style={styles.sectionTitle}>{ROUTE_PREVIEW_LABELS.map}</Text>
        <Pressable
          accessibilityLabel={ROUTE_PREVIEW_COPY.mapAccessibilityLabel}
          accessibilityRole="button"
          onPress={onOpenMapPreview}
          style={styles.routePreviewCanvas}
        >
          <View pointerEvents="none">
            <MapOverview route={route} currentStepIndex={COMPANY_STEP_INDEX} mapStyleUrl={mapStyleUrl} />
          </View>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>{ROUTE_PREVIEW_LABELS.sequence}</Text>
        {previewSequence.items.length > 0 ? previewSequence.items.map((item) => (
          <View key={item.deliveryStopId} style={styles.routePreviewSequenceRow}>
            <Text style={styles.routePreviewSequenceMarker}>{item.marker}</Text>
            <Text numberOfLines={2} style={styles.routePreviewSequenceAddress}>{item.address}</Text>
          </View>
        )) : <Text style={styles.helperText}>No stops assigned.</Text>}
        {previewSequence.overflowCount > 0 ? (
          <Text style={styles.helperText}>+ {previewSequence.overflowCount} more stops</Text>
        ) : null}
      </View>
    </View>
  );
}

function RouteSessionScreen({
  allStopsCompleted,
  company,
  completedStopIds,
  continuousLocationResult,
  currentNavigationStepIndex,
  deliveryFinishResult,
  isFinishingRoute,
  isStartingRoute,
  isCompanyStep,
  mapStyleUrl,
  onArrived,
  onBack,
  onFinishRoute,
  onOpenMapPreview,
  onOpenNavigation,
  onOpenStop,
  onStartRoute,
  onViewCurrentStop,
  route,
  routeStartedEventResult,
  routeStatus,
  stop,
}: {
  allStopsCompleted: boolean;
  company: RouteAccessCompanyGuidance | null;
  completedStopIds: string[];
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  currentNavigationStepIndex: number;
  deliveryFinishResult: DeliveryFinishResult | null;
  isFinishingRoute: boolean;
  isStartingRoute: boolean;
  isCompanyStep: boolean;
  mapStyleUrl: string;
  onArrived(): void;
  onBack(): void;
  onFinishRoute(): void;
  onOpenMapPreview(): void;
  onOpenNavigation(): void;
  onOpenStop(stop: AssignedRouteStop): void;
  onStartRoute(): void;
  onViewCurrentStop(): void;
  route: AssignedRoute;
  routeStartedEventResult: RouteStartedRecordResult | null;
  routeStatus: RouteStatus;
  stop: AssignedRouteStop | null;
}) {
  const depotIsProcessing = routeStatus === 'active' && currentNavigationStepIndex === COMPANY_STEP_INDEX;
  const depotMeta = depotIsProcessing ? 'Pickup' : routeStatus === 'completed' || currentNavigationStepIndex > COMPANY_STEP_INDEX ? 'Done' : undefined;
  const depotMetaTone = depotIsProcessing ? 'blue' : 'green';
  const depotState = routeStatus === 'upcoming' || depotIsProcessing ? 'current' : 'completed';
  const currentTaskTitle = isCompanyStep ? 'Company Pickup' : stop === null ? 'Next Stop' : `Stop ${stop.sequence}`;
  const currentTaskAddress = isCompanyStep ? company?.pickupGuidance ?? 'Pickup point' : stop === null ? 'Stop address' : formatStopAddress(stop);
  const currentTaskPayment = stop === null ? null : formatAssignedRoutePaymentStatus(stop.normalizedPaymentStatus);
  const primaryProgressAction = routeStatus === 'upcoming'
    ? { disabled: isStartingRoute, label: 'Start Session', loading: isStartingRoute, onPress: onStartRoute }
    : routeStatus === 'active' && allStopsCompleted
      ? { disabled: isFinishingRoute, label: 'Finish Route', loading: isFinishingRoute, onPress: onFinishRoute }
      : routeStatus === 'active' && isCompanyStep
        ? { disabled: false, label: 'Complete Pickup', loading: false, onPress: onArrived }
        : routeStatus === 'active'
          ? { disabled: false, label: 'Mark as Arrived', loading: false, onPress: onArrived }
          : null;
  const showPrimaryActionInCurrentTask = routeStatus === 'active' && !allStopsCompleted && primaryProgressAction !== null;

  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Route Session" />
      <View style={styles.summaryCard}>
        <Text numberOfLines={1} style={styles.cardTitle}>{route.name}</Text>
        <DataRow label="Date" value={route.deliveryDate} />
        <View style={styles.summaryGrid}>
          <MetricBlock label="Stops" value={formatStopCount(route.stops.length)} />
          <MetricBlock label="Distance" value={formatAssignedRouteDistance(route.routeMetrics)} />
          <MetricBlock label="Duration" value={formatAssignedRouteDuration(route.routeMetrics)} />
        </View>
      </View>

      {company?.pickupGuidance !== null && company?.pickupGuidance !== undefined ? (
        <InfoPanel tone="green" title="Company pickup guidance" body={company.pickupGuidance} />
      ) : null}
      {company?.driverInstructions.length ? (
        <View style={styles.listPanel}>
          <Text style={styles.sectionTitle}>Driver Notes</Text>
          {company.driverInstructions.map((instruction) => (
            <Text key={instruction} style={styles.bodyText}>{instruction}</Text>
          ))}
        </View>
      ) : null}

      {routeStatus === 'active' && !allStopsCompleted ? (
        <View style={styles.currentTaskCard}>
          <Text style={styles.sectionTitle}>Current Task</Text>
          <View style={styles.trackingCardHeader}>
            <View style={styles.routeHeaderText}>
              <Text style={styles.labelText}>{currentTaskTitle}</Text>
              <Text style={styles.currentTaskAddressText}>{currentTaskAddress}</Text>
            </View>
            {currentTaskPayment !== null && currentTaskPayment.tone !== 'green' ? (
              <StatusChip compact label={currentTaskPayment.label} tone={currentTaskPayment.tone} />
            ) : null}
          </View>
          <View style={styles.currentTaskActions}>
            {showPrimaryActionInCurrentTask ? (
              <PrimaryButton
                compact
                disabled={primaryProgressAction.disabled}
                label={primaryProgressAction.label}
                loading={primaryProgressAction.loading}
                onPress={primaryProgressAction.onPress}
              />
            ) : null}
            {routeStatus === 'active' && !isCompanyStep && stop !== null ? (
              <SecondaryButton compact label="View Stop Details" onPress={onViewCurrentStop} />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.routePreviewCard}>
        <View style={styles.routePreviewHeader}>
          <Text style={styles.sectionTitle}>Route Preview</Text>
          <Text style={styles.routePreviewHint}>Tap for full map</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onOpenMapPreview} style={styles.routePreviewCanvas}>
          <View pointerEvents="none">
            <MapOverview route={route} currentStepIndex={currentNavigationStepIndex} mapStyleUrl={mapStyleUrl} />
          </View>
        </Pressable>
      </View>

      <View style={styles.timelineCard}>
        <Text style={styles.sectionTitle}>Route Sequence</Text>
        <TimelineRow marker="D" title="Depot" subtitle="Pickup point" state={depotState} meta={depotMeta} metaTone={depotMetaTone} />
        {route.stops.map((stop, index) => {
          const completed = completedStopIds.includes(stop.deliveryStopId);
          const isProcessing = routeStatus === 'active' && currentNavigationStepIndex === index + 1 && !completed;
          const state = completed ? 'completed' : isProcessing ? 'current' : 'upcoming';
          const progressMeta = completed ? 'Done' : isProcessing ? 'Current' : undefined;
          const metaTone = completed ? 'green' : isProcessing ? 'blue' : 'neutral';
          return (
            <TimelineRow
              key={stop.deliveryStopId}
              marker={String(stop.sequence)}
              title={formatStopStreetAddress(stop)}
              state={state}
              meta={progressMeta}
              metaTone={metaTone}
              onPress={() => onOpenStop(stop)}
            />
          );
        })}
      </View>

      {routeStartedEventResult?.kind === 'recorded' ? <StatusBanner tone="green" text="Route start event recorded." /> : null}
      {continuousLocationResult !== null ? <StatusBanner tone="green" text={formatContinuousLocationResult(continuousLocationResult)} /> : null}
      {deliveryFinishResult?.flowState === 'delivery_finished' ? <StatusBanner tone="green" text={deliveryFinishResult.message} /> : null}

      <View style={styles.buttonColumn}>
        {primaryProgressAction !== null && !showPrimaryActionInCurrentTask ? (
          <PrimaryButton
            disabled={primaryProgressAction.disabled}
            label={primaryProgressAction.label}
            loading={primaryProgressAction.loading}
            onPress={primaryProgressAction.onPress}
          />
        ) : null}
        {routeStatus === 'active' ? <SecondaryButton label="Map Preview" onPress={onOpenMapPreview} /> : null}
        <SecondaryButton label="Open in Map" onPress={onOpenNavigation} />
        <SecondaryButton label="Back to Routes" onPress={onBack} />
      </View>
    </View>
  );
}

function LiveTrackingScreen({
  company,
  isCompanyStep,
  onArrived,
  onBack,
  onOpenMapPreview,
  onOpenNavigation,
  onViewStop,
  route,
  routeStatus,
  stop,
}: {
  company: RouteAccessCompanyGuidance | null;
  isCompanyStep: boolean;
  onArrived(): void;
  onBack(): void;
  onOpenMapPreview(): void;
  onOpenNavigation(): void;
  onViewStop(): void;
  route: AssignedRoute;
  routeStatus: RouteStatus;
  stop: AssignedRouteStop | null;
}) {
  const stepLabel = isCompanyStep ? 'Company Pickup' : stop === null ? 'Next Stop' : `Stop ${stop.sequence}`;
  const address = isCompanyStep ? company?.pickupGuidance ?? 'Pickup guidance' : stop === null ? 'Stop address' : formatStopAddress(stop);
  const payment = stop === null ? null : formatAssignedRoutePaymentStatus(stop.normalizedPaymentStatus);

  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Live Tracking" />
      <View style={styles.trackingDetailsPage}>
        <Pressable accessibilityRole="button" onPress={onOpenMapPreview} style={styles.mapPreviewInlineButton}>
          <View style={styles.mapPreviewInlineButtonTextBlock}>
            <Text style={styles.mapPreviewInlineButtonText}>Map Preview</Text>
            <Text style={styles.mapPreviewInlineButtonSubtext}>View route on map</Text>
          </View>
          <View style={styles.mapPreviewInlineButtonAction}>
            <Text style={styles.mapPreviewInlineButtonActionText}>Open</Text>
          </View>
        </Pressable>
        <View style={styles.trackingCardHeader}>
          <View style={styles.routeHeaderText}>
            <Text style={styles.labelText}>Delivery details</Text>
            <Text style={styles.sheetTitle}>{address}</Text>
          </View>
        </View>
        <View style={styles.trackingMetrics}>
          <MetricBlock label="Distance" value={formatAssignedRouteDistance(route.routeMetrics)} />
          <MetricBlock label="ETA" value={formatAssignedRouteDuration(route.routeMetrics)} />
          <MetricBlock label="Status" value={routeStatus === 'active' ? 'In progress' : 'Pending'} tone={routeStatus === 'active' ? 'green' : 'neutral'} />
        </View>
        {payment !== null ? (
          <View style={styles.paymentInlineRow}>
            <Text style={styles.labelText}>Payment</Text>
            <StatusChip label={payment.label} tone={payment.tone} />
          </View>
        ) : null}
        <View style={styles.trackingButtonColumn}>
          <SecondaryButton label="Open in Map" onPress={onOpenNavigation} />
          <SecondaryButton disabled={isCompanyStep || stop === null} label="View Stop" onPress={onViewStop} />
          <PrimaryButton label={isCompanyStep ? 'Find Next Stop' : 'Arrived'} onPress={onArrived} />
        </View>
        <Text style={styles.helperText}>{stepLabel}</Text>
      </View>
    </View>
  );
}

function LiveMapPreviewScreen({
  currentStepIndex,
  mapStyleUrl,
  onBack,
  route,
}: {
  currentStepIndex: number;
  mapStyleUrl: string;
  onBack(): void;
  route: AssignedRoute;
}) {
  return (
    <View style={styles.fullScreenMap}>
      <MapOverview
        mapSize="full"
        route={route}
        currentStepIndex={currentStepIndex}
        mapStyleUrl={mapStyleUrl}
      />
      <View style={styles.fullScreenMapHeader}>
        <ScreenHeader hideRightAction onBack={onBack} title="Map Preview" />
      </View>
    </View>
  );
}

function StopDetailsScreen({
  onBack,
  onCall,
  onMessage,
  onOpenNavigation,
  stop,
}: {
  onBack(): void;
  onCall(): void;
  onMessage(): void;
  onOpenNavigation(): void;
  stop: AssignedRouteStop;
}) {
  const payment = formatAssignedRoutePaymentStatus(stop.normalizedPaymentStatus);
  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Stop Details" />
      <View style={styles.stopSummaryCard}>
        <View style={styles.stopBadge}><Text style={styles.stopBadgeText}>Stop {stop.sequence}</Text></View>
        <View style={styles.routeHeaderText}>
          <Text numberOfLines={2} style={styles.cardTitle}>{formatStopStreetAddress(stop)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Payment</Text>
      <View style={styles.paymentBadgeOnlyPanel}>
        <StatusChip label={payment.label} tone={payment.tone} />
      </View>

      <Text style={styles.sectionTitle}>Items to drop</Text>
      <View style={styles.stopItemsPanel}>
        {stop.items.map((item, itemIndex) => (
          <Text key={`${item.productId}:${item.variationId}:${item.name}:${itemIndex}`} style={styles.stopItemLine}>
            {formatAssignedRouteItemLine(item)}
          </Text>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Delivery Instructions</Text>
      <TextCard text="No delivery instructions provided." />
      <Text style={styles.sectionTitle}>Location Tips</Text>
      <TextCard text="No location tips provided." />
      <View style={styles.buttonRow}>
        <SecondaryButton label="Open Stop Map" onPress={onOpenNavigation} />
        <SecondaryButton label="Call" onPress={onCall} />
        <SecondaryButton label="Message" onPress={onMessage} />
      </View>
    </View>
  );
}

function ArrivalCheckScreen({
  draft,
  isCapturingPhoto,
  isCompletingStop,
  onAnnounceTip,
  onBack,
  onAddPhoto,
  onCompleteStop,
  onDraftChange,
  proofResult,
  stop,
}: {
  draft: StopProofDraft;
  isCapturingPhoto: boolean;
  isCompletingStop: boolean;
  onAnnounceTip(): void;
  onBack(): void;
  onAddPhoto(): void;
  onCompleteStop(): void;
  onDraftChange(patch: Partial<StopProofDraft>): void;
  proofResult?: StopProofEventResult;
  stop: AssignedRouteStop;
}) {
  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Complete Delivery" />
      <Pressable accessibilityRole="button" onPress={onAnnounceTip} style={styles.nearbyBanner}>
        <View style={styles.statusDot} />
        <View style={styles.routeHeaderText}>
          <Text style={styles.nearbyTitle}>You’re near the destination</Text>
          <Text style={styles.helperText}>Voice tip available for this area.</Text>
        </View>
      </Pressable>

      <Text style={styles.sectionTitle}>Delivery Photo</Text>
      <SecondaryButton compact disabled={isCapturingPhoto} label="Add Photo" loading={isCapturingPhoto} onPress={onAddPhoto} />

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

function StopCompletedScreen({
  completedStop,
  completedStopIds,
  completedStopTimes,
  onBackToRoute,
  onContinue,
  route,
}: {
  completedStop: AssignedRouteStop | null;
  completedStopIds: string[];
  completedStopTimes: Record<string, string>;
  onBackToRoute(): void;
  onContinue(): void;
  route: AssignedRoute;
}) {
  const nextStop = route.stops.find((stop) => !completedStopIds.includes(stop.deliveryStopId)) ?? null;
  const completedTime = completedStop === null ? 'Completed Time' : completedStopTimes[completedStop.deliveryStopId] ?? 'Sync pending';
  return (
    <View style={styles.screenStack}>
      <ScreenHeader title="Stop Completed" />
      <View style={styles.successHero}>
        <Text style={styles.successHeroText}>Done</Text>
      </View>
      <Text style={styles.successHeadline}>Stop completed.</Text>
      <View style={styles.summaryCard}>
        <DataRow label="Completed at" value={completedTime} />
        <DataRow label="Route Progress" value={`${completedStopIds.length} / ${route.stops.length}`} />
      </View>
      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>{nextStop === null ? 'Route Complete' : 'Next Stop'}</Text>
        <Text numberOfLines={2} style={styles.bodyText}>{nextStop === null ? 'All stops are completed for this route.' : formatStopAddress(nextStop)}</Text>
        <ProgressBar value={route.stops.length === 0 ? 0 : completedStopIds.length / route.stops.length} />
        <Text style={styles.helperText}>Route progress</Text>
      </View>
      <PrimaryButton label={nextStop === null ? 'View Completed Deliveries' : 'Find Next Stop'} onPress={onContinue} />
      <SecondaryButton label="Back to Route" onPress={onBackToRoute} />
    </View>
  );
}

function CompletedDeliveriesScreen({
  completedStopIds,
  completedStopTimes,
  onBack,
  proofMediaResults,
  route,
}: {
  completedStopIds: string[];
  completedStopTimes: Record<string, string>;
  onBack(): void;
  proofMediaResults: Record<string, ProofMediaUploadResult>;
  route: AssignedRoute;
}) {
  const completedStops = route.stops.filter((stop) => completedStopIds.includes(stop.deliveryStopId));
  const issueCount = completedStops.filter((stop) => proofMediaResults[stop.deliveryStopId]?.kind !== 'uploaded').length;
  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Completed Deliveries" rightLabel="Filter" />
      <View>
        <Text style={styles.pageTitleSmall}>Current session</Text>
        <Text style={styles.helperText}>{route.deliveryDate}</Text>
      </View>
      <View style={styles.completionSummaryCard}>
        <Text style={styles.cardTitle}>Completed stops</Text>
        <Text style={styles.bodyText}>{completedStopIds.length} / {route.stops.length}</Text>
        <Text style={styles.cardTitleSmall}>Proof records submitted</Text>
        <Text style={styles.bodyText}>{Math.max(completedStops.length - issueCount, 0)} / {completedStops.length}</Text>
      </View>
      <View style={styles.filterRow}>
        <Text style={[styles.filterPill, styles.filterPillActive]}>All</Text>
        <Text style={styles.filterPill}>With Issues</Text>
        <Text style={styles.filterPill}>Proof Missing</Text>
      </View>
      <View style={styles.completedListCard}>
        {completedStops.length > 0 ? completedStops.map((stop) => {
          const proofUploaded = proofMediaResults[stop.deliveryStopId]?.kind === 'uploaded';
          return (
            <View key={stop.deliveryStopId} style={styles.completedRow}>
              <View style={styles.routeHeaderText}>
                <Text style={styles.completedRowTitle}>Stop {stop.sequence}</Text>
                <Text numberOfLines={1} style={styles.helperText}>{formatStopAddress(stop)}</Text>
              </View>
              <View style={styles.completedMetaColumn}>
                <Text style={styles.helperText}>{completedStopTimes[stop.deliveryStopId] ?? 'Completed Time'}</Text>
                <StatusChip label={proofUploaded ? 'Proof uploaded' : 'Proof pending'} tone={proofUploaded ? 'green' : 'warning'} />
              </View>
              <Text style={styles.textButton}>View</Text>
            </View>
          );
        }) : (
          <EmptyState title="No completed deliveries" body="Completed stops will appear here after proof is submitted." />
        )}
      </View>
    </View>
  );
}

function ScreenHeader({
  hideRightAction = false,
  onBack,
  onRightPress,
  rightLabel,
  title,
}: {
  hideRightAction?: boolean;
  onBack?(): void;
  onRightPress?(): void;
  rightLabel?: string;
  title: string;
}) {
  const rightContent = rightLabel ?? 'Menu';
  const rightSlot = hideRightAction ? (
    <Text style={styles.headerSideText} />
  ) : onRightPress === undefined ? (
    <Text style={rightLabel === undefined ? styles.headerSideText : styles.headerActionText}>{rightContent}</Text>
  ) : (
    <Pressable accessibilityRole="button" onPress={onRightPress}>
      <Text style={styles.headerActionText}>{rightContent}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screenHeader}>
      {onBack === undefined ? <Text style={styles.headerSideText} /> : <Pressable accessibilityRole="button" onPress={onBack}><Text style={styles.headerActionText}>Back</Text></Pressable>}
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      {rightSlot}
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
}: {
  countries: DriverPhoneCountry[];
  onBack(): void;
  onSearchChange(value: string): void;
  onSelectCountry(country: DriverPhoneCountry): void;
  searchQuery: string;
  selectedCountry: DriverPhoneCountry;
  selectedLocale: string;
}) {
  return (
    <View style={styles.countrySelectionScreen}>
      <ScreenHeader hideRightAction onBack={onBack} title="Select Country" />
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

function StatusChip({ compact, label, tone }: { compact?: boolean; label: string; tone: 'blue' | 'green' | 'neutral' | 'warning' }) {
  const toneStyle = tone === 'blue'
    ? styles.statusChipBlue
    : tone === 'green'
      ? styles.statusChipGreen
      : tone === 'warning'
        ? styles.statusChipWarning
        : styles.statusChipNeutral;
  return <Text style={[styles.statusChip, compact === true && styles.statusChipCompact, toneStyle]}>{label}</Text>;
}

function TimelineRow({
  marker,
  meta,
  metaTone = 'neutral',
  onPress,
  state,
  subtitle,
  title,
}: {
  marker: string;
  meta?: string;
  metaTone?: 'blue' | 'green' | 'neutral';
  onPress?: () => void;
  state: 'completed' | 'current' | 'upcoming';
  subtitle?: string;
  title: string;
}) {
  const content = (
    <>
      <View style={[styles.timelineMarker, state === 'completed' && styles.timelineMarkerCompleted, state === 'current' && styles.timelineMarkerCurrent]}>
        <Text style={[styles.timelineMarkerText, (state === 'completed' || state === 'current') && styles.timelineMarkerTextActive]}>{marker}</Text>
      </View>
      <View style={styles.routeHeaderText}>
        <Text style={[styles.timelineTitle, state === 'current' && styles.timelineTitleCurrent]}>{title}</Text>
        {subtitle !== undefined ? <Text numberOfLines={2} style={styles.helperText}>{subtitle}</Text> : null}
      </View>
      {meta !== undefined ? <StatusChip compact label={meta} tone={metaTone} /> : null}
    </>
  );

  if (onPress !== undefined) {
    return (
      <Pressable
        accessibilityLabel={`${title}. ${subtitle}${meta === undefined ? '' : `. ${meta}`}.`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.timelineRow,
          state === 'current' && styles.timelineRowCurrent,
          pressed && { opacity: 0.88 },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.timelineRow, state === 'current' && styles.timelineRowCurrent]}>{content}</View>;
}

function MapOverview({
  currentStepIndex,
  mapSize = 'preview',
  mapStyleUrl,
  route,
}: {
  currentStepIndex: number;
  mapSize?: 'full' | 'live' | 'preview';
  mapStyleUrl: string;
  route: AssignedRoute;
}) {
  const previewKey = route.routeMapPreview?.imageUrl ?? null;
  const interactiveMapKey = `${mapStyleUrl}:${route.id}:${route.routeGeometry?.coordinates.length ?? 0}`;
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
  const canvasStyle = [
    styles.mapCanvas,
    mapSize === 'live' ? styles.liveMapCanvas : null,
    mapSize === 'full' ? styles.fullMapCanvas : null,
  ];

  if (interactiveMapStatus === 'idle' && route.routeGeometry !== null && route.routeGeometry.coordinates.length >= 2) {
    return (
      <View style={canvasStyle}>
        <NativeRouteMapPreview
          currentStepIndex={currentStepIndex}
          mapStyleUrl={mapStyleUrl}
          onUnavailable={handleInteractiveMapUnavailable}
          route={route}
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

function InfoPanel({ body, title, tone }: { body: string; title: string; tone: 'green' }) {
  return (
    <View style={[styles.infoPanel, tone === 'green' && styles.infoPanelGreen]}>
      <Text style={styles.infoPanelTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </View>
  );
}

function TextCard({ text }: { text: string }) {
  return <Text style={styles.textCard}>{text}</Text>;
}

function StatusBanner({ text, tone }: { text: string; tone: 'green' | 'warning' }) {
  return <Text style={[styles.statusBanner, tone === 'green' ? styles.statusBannerGreen : styles.statusBannerWarning]}>{text}</Text>;
}

function ProgressBar({ value }: { value: number }) {
  const clampedValue = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clampedValue * 100}%` }]} />
    </View>
  );
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

  return 'upcoming';
}

function formatRouteStatus(status: RouteStatus): string {
  switch (status) {
    case 'active':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'unfinished':
      return 'Unfinished';
    case 'upcoming':
      return 'Pending';
  }
}

function getRouteRegion(route: AssignedRoute): string {
  const cities = [...new Set(route.stops.map((stop) => stop.address.city).filter(Boolean))];
  return cities.length === 0 ? route.timezone : `${cities.join(', ')} · ${route.timezone}`;
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
    .join('\n') || 'Photo proof submitted.';
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

function formatContinuousLocationResult(result: ContinuousLocationStreamStartResult | ContinuousLocationStopResult): string {
  if (result.kind === 'streaming') {
    return 'GPS tracking is active.';
  }

  if (result.kind === 'stopped') {
    return 'GPS tracking stopped.';
  }

  return result.message;
}

function getChipTone(status: RouteStatus): 'blue' | 'green' | 'neutral' {
  switch (status) {
    case 'active':
      return 'blue';
    case 'completed':
      return 'green';
    case 'unfinished':
      return 'neutral';
    case 'upcoming':
      return 'neutral';
  }
}

function formatStopCount(count: number): string {
  return `${count} stop${count === 1 ? '' : 's'}`;
}

function getInitials(value: string): string {
  const initials = value
    .split(/[\s.-]+/u)
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return initials || 'CD';
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
  keyboardArea: {
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
  screenStack: {
    gap: 22,
    overflow: 'visible',
  },
  myRoutesPage: {
    gap: 8,
    overflow: 'visible',
  },
  myRoutesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 76,
    paddingHorizontal: 56,
  },
  pageHeader: {
    gap: 6,
    paddingTop: 8,
  },
  pageTitle: {
    color: '#111827',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  settingsIconButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 16,
    width: 44,
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
  countrySelectionScreen: {
    flex: 1,
    gap: 18,
    padding: 22,
    paddingBottom: 28,
    paddingTop: 34,
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
  trackingButtonColumn: {
    gap: 12,
  },
  selectedRouteCard: {
    backgroundColor: '#ffffff',
    borderColor: '#0b57d0',
    borderRadius: 20,
    borderWidth: 1.6,
    gap: 14,
    padding: 18,
    ...shadow,
  },
  routeCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  routeInitialBadge: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 22,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  routeInitialText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  routeHeaderText: {
    flex: 1,
    gap: 4,
  },
  routeCardStatusGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
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
  routePagerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  routePagerText: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  screenHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
  },
  headerActionText: {
    color: '#0b57d0',
    fontSize: 16,
    fontWeight: '700',
    minWidth: 52,
  },
  headerSideText: {
    minWidth: 52,
  },
  headerTitle: {
    color: '#111827',
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  settingsScreen: {
    gap: 28,
    paddingBottom: 12,
  },
  settingsHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
    position: 'relative',
  },
  settingsBackButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e4e7ec',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    width: 48,
  },
  settingsBackButtonPressed: {
    backgroundColor: '#eef2f6',
  },
  settingsHeaderTitle: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
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
  listPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  infoPanel: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  infoPanelGreen: {
    backgroundColor: '#ecfdf3',
    borderColor: '#bbf7d0',
  },
  infoPanelTitle: {
    color: '#087443',
    fontSize: 15,
    fontWeight: '800',
  },
  paymentInlineRow: {
    alignItems: 'center',
    borderColor: '#eef2f6',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  paymentBadgeOnlyPanel: {
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  stopItemsPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  stopItemLine: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
  timelineCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  routePreviewCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  routePreviewHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
  },
  routePreviewHint: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
  },
  routePreviewRegionBlock: {
    borderBottomColor: '#eef2f6',
    borderBottomWidth: 1,
    gap: 4,
    paddingBottom: 8,
  },
  routePreviewRegionLabel: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '400',
  },
  routePreviewRegionList: {
    gap: 2,
  },
  routePreviewRegionItem: {
    color: '#475467',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  routePreviewCanvas: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  routePreviewSequenceRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  routePreviewSequenceMarker: {
    backgroundColor: '#eef2f6',
    borderRadius: 999,
    color: '#475467',
    fontSize: 12,
    fontWeight: '800',
    minWidth: 28,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textAlign: 'center',
  },
  routePreviewSequenceAddress: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  currentTaskCard: {
    backgroundColor: '#ffffff',
    borderColor: '#bfdbfe',
    borderRadius: 18,
    borderWidth: 1.4,
    gap: 14,
    padding: 16,
  },
  currentTaskActions: {
    gap: 8,
  },
  currentTaskAddressText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  timelineRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  timelineRowCurrent: {
    backgroundColor: '#eef6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
  },
  timelineMarker: {
    alignItems: 'center',
    backgroundColor: '#eef2f6',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  timelineMarkerCompleted: {
    backgroundColor: '#16a34a',
  },
  timelineMarkerCurrent: {
    backgroundColor: '#0b57d0',
  },
  timelineMarkerText: {
    color: '#475467',
    fontSize: 14,
    fontWeight: '900',
  },
  timelineMarkerTextActive: {
    color: '#ffffff',
  },
  timelineTitle: {
    color: '#344054',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
  },
  timelineTitleCurrent: {
    color: '#111827',
    fontWeight: '700',
  },
  timelineMeta: {
    color: '#475467',
    fontSize: 12,
    fontWeight: '800',
  },
  trackingDetailsPage: {
    backgroundColor: '#ffffff',
    borderColor: '#dbeafe',
    borderRadius: 24,
    borderWidth: 1,
    gap: 16,
    padding: 20,
    ...shadow,
  },
  fullScreenMap: {
    flex: 1,
    overflow: 'hidden',
  },
  fullScreenMapHeader: {
    left: 0,
    paddingHorizontal: 22,
    paddingBottom: 12,
    paddingTop: 34,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  statusDot: {
    backgroundColor: '#12b76a',
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  mapCanvas: {
    backgroundColor: '#f3f8fb',
    height: 430,
    overflow: 'hidden',
    position: 'relative',
  },
  liveMapCanvas: {
    height: 540,
  },
  fullMapCanvas: {
    flex: 1,
    height: '100%',
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
    backgroundColor: '#f97316',
    borderColor: '#fed7aa',
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
  trackingCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  mapPreviewInlineButton: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  mapPreviewInlineButtonTextBlock: {
    flex: 1,
    gap: 2,
  },
  mapPreviewInlineButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  mapPreviewInlineButtonSubtext: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
  },
  mapPreviewInlineButtonAction: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  mapPreviewInlineButtonActionText: {
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
  trackingMetrics: {
    borderColor: '#eef2f6',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  stopSummaryCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    ...shadow,
  },
  stopBadge: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  stopBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  textCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 15,
    borderWidth: 1,
    color: '#475467',
    fontSize: 15,
    lineHeight: 23,
    minHeight: 78,
    padding: 16,
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
  successHero: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#12b76a',
    borderRadius: 58,
    height: 116,
    justifyContent: 'center',
    width: 116,
    ...shadow,
  },
  successHeroText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },
  successHeadline: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  progressTrack: {
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#12b76a',
    borderRadius: 999,
    height: '100%',
  },
  completionSummaryCard: {
    backgroundColor: '#ecfdf3',
    borderColor: '#bbf7d0',
    borderRadius: 18,
    borderWidth: 1,
    gap: 5,
    padding: 18,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  filterPill: {
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
    borderRadius: 999,
    borderWidth: 1,
    color: '#344054',
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: 'center',
  },
  filterPillActive: {
    backgroundColor: '#0b57d0',
    borderColor: '#0b57d0',
    color: '#ffffff',
  },
  completedListCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  completedRow: {
    alignItems: 'center',
    borderBottomColor: '#eef2f6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  completedRowTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  completedMetaColumn: {
    alignItems: 'flex-end',
    gap: 6,
  },
  textButton: {
    color: '#0b57d0',
    fontSize: 14,
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
