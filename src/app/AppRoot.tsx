import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createMockAssignedRouteService,
  formatAssignedRouteDistance,
  formatAssignedRouteDuration,
  loadAssignedRouteAfterConsent,
  sampleAssignedRoute,
  type AssignedRoute,
  type AssignedRouteService,
  type AssignedRouteStop,
} from '../domain/route/assignedRoute';
import {
  classifyAssignedRouteSession,
  filterVisibleAssignedRouteSessions,
  getInitialAssignedRouteTab,
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
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  retryOfflineSubmissions,
  type OfflineSubmissionQueue,
  type OfflineSubmissionRetryResult,
} from '../domain/offline/offlineSubmissionQueue';
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
import { getMvpRouteTabs } from '../domain/driverFlow/driverFlow';
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
  type RouteAccessCompanyGuidance,
  type RouteAccessLookupResult,
  type RouteAccessRouteChoice,
  type RouteAccessSubmissionResult,
} from '../domain/routeAccess/routeAccess';
import { resetDriverSession } from '../domain/driver/driverSessionReset';
import { recordStopProofEventAfterDeliveryStart, type StopProofEventResult } from '../domain/stop/stopProofEvents';
import { openRouteNavigation, openStopNavigation } from '../domain/stop/stopNavigation';
import {
  COUNTRY_SELECTOR_OVERLAY_BEHAVIOR,
  getCountrySelectorRowText,
  getSelectedCountryCardText,
} from '../ui/components/countrySelectorBehavior';
import { TransientToast } from '../ui/components/TransientToast';
import { scheduleTransientToastDismiss } from '../ui/components/transientToastBehavior';
import {
  APP_CONTENT_BOTTOM_CLEARANCE,
  BOTTOM_NAV_MIN_HEIGHT,
} from './appLayoutMetrics';

type AppScreen =
  | 'arrivalCheck'
  | 'completedDeliveries'
  | 'liveTracking'
  | 'login'
  | 'routeDetail'
  | 'routes'
  | 'stopCompleted'
  | 'stopDetails';
type RouteTabId = ReturnType<typeof getMvpRouteTabs>[number]['id'];
type RouteStatus = RouteSessionStatus;
type StopDetailsBackTarget = 'liveTracking' | 'routeDetail';

type StopProofDraft = {
  additionalNotes: string;
  locationTip: string;
  todayNote: string;
};

type RouteSession = RouteAccessRouteChoice & {
  route: AssignedRoute;
};

const DEFAULT_DRIVER_NAME = '';
const COMPANY_STEP_INDEX = ROUTE_COMPANY_STEP_INDEX;
const ADMIN_SESSION_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_ADMIN_SESSION === '1';
const SWIPE_BACK_DISTANCE = 90;
const SWIPE_BACK_MAX_VERTICAL_DELTA = 90;
const SWIPE_BACK_DIRECTIONALITY_RATIO = 1.45;

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('login');
  const [selectedPhoneCountryIso2, setSelectedPhoneCountryIso2] = useState(DEFAULT_DRIVER_PHONE_COUNTRY.iso2);
  const [selectedDriverLocale, setSelectedDriverLocale] = useState(DEFAULT_DRIVER_PHONE_COUNTRY.defaultLocale);
  const [nationalPhoneInput, setNationalPhoneInput] = useState('');
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [isCountrySelectorOpen, setIsCountrySelectorOpen] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [driverName, setDriverName] = useState(DEFAULT_DRIVER_NAME);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedLocation, setAcceptedLocation] = useState(false);
  const [selectedTab, setSelectedTab] = useState<RouteTabId>('upcoming');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = useState(COMPANY_STEP_INDEX);
  const [selectedStopDetailsId, setSelectedStopDetailsId] = useState<string | null>(null);
  const [stopDetailsBackTarget, setStopDetailsBackTarget] = useState<StopDetailsBackTarget>('liveTracking');
  const [routeSessions, setRouteSessions] = useState<RouteSession[]>([]);

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
  const [message, setMessage] = useState<string | null>(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isStartingRoute, setIsStartingRoute] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isCompletingStop, setIsCompletingStop] = useState(false);
  const [isFinishingRoute, setIsFinishingRoute] = useState(false);
  const [isSyncingOfflineQueue, setIsSyncingOfflineQueue] = useState(false);
  const [isLoadingBackdoorSession, setIsLoadingBackdoorSession] = useState(false);
  const [isAdminToolsVisible, setIsAdminToolsVisible] = useState(false);

  const driverAccessTokenStore = useMemo(() => createExpoSecureDriverAccessTokenStore(), []);
  const foregroundLocationPermissionService = useMemo(() => createExpoForegroundLocationPermissionService(), []);
  const continuousLocationStreamService = useMemo(() => createExpoContinuousLocationStreamService(), []);
  const proofPhotoCaptureService = useMemo(() => createExpoProofPhotoCaptureService(), []);
  const offlineSubmissionQueueStorage = useMemo(() => createExpoOfflineSubmissionQueueStorage(), []);
  const mockDriverEventService = useMemo(() => createMockDriverEventService(), []);
  const mockDriverConsentService = useMemo(() => createMockDriverConsentService(), []);
  const mockAssignedRouteService = useMemo(() => createMockAssignedRouteService({ status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute }), []);
  const mockProofMediaUploadService = useMemo(() => createMockProofMediaUploadService({ mode: 'success' }), []);
  const routeTabs = useMemo(() => getMvpRouteTabs(), []);
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

  const routeAccessService = useMemo(() => {
    if (runtimeConfig.mode === 'live') {
      return createDriverRuntimeServices({ config: runtimeConfig }).routeAccessService;
    }

    return createMockRouteAccessService(sampleInvitedRouteAccess);
  }, [runtimeConfig]);

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
  const stopDetailsCanMarkArrived = stopDetailsProgressState?.canMarkArrived === true;
  const isCompanyStep = navigationStepIndex === COMPANY_STEP_INDEX;
  const allStopsCompleted = selectedRoute !== null && selectedRoute.stops.every((stop) => completedStopIds.includes(stop.deliveryStopId));
  const currentCompany = selectedRouteSession?.companyGuidance ?? null;
  const recentlyCompletedStop = selectedRoute?.stops.find((stop) => stop.deliveryStopId === recentlyCompletedStopId) ?? null;

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
          const fallbackQueue = createInMemoryOfflineSubmissionQueue();
          setOfflineSubmissionQueue(fallbackQueue);
          setOfflineQueueCount(fallbackQueue.listPending().length);
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
          runtimeConfig,
          submission,
        }),
        locations,
        offlineQueue: queue,
        routePlanId,
      });
      setOfflineQueueCount(queue.listPending().length);
    });

    return () => registerContinuousLocationTaskHandler(null);
  }, [deliveryFinishResult, deliveryStartResult, mockDriverEventService, offlineSubmissionQueue, runtimeConfig, selectedRoute?.id, submission]);

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
    setIsCountrySelectorOpen(false);
    setNationalPhoneInput(formatDriverNationalPhoneInput({
      countryIso2: country.iso2,
      nationalPhoneInput,
    }));
  }

  function handleSendVerificationCode() {
    const phoneEntry = normalizeDriverPhoneEntry({
      countryIso2: selectedPhoneCountry.iso2,
      nationalPhoneInput,
    });

    if (!phoneEntry.ok) {
      setMessage(formatDriverPhoneEntryProblem(phoneEntry.reason));
      return;
    }

    setMessage(`Verification code request is ready for server integration for ${phoneEntry.phoneE164}.`);
  }

  async function handleLoginAndLoadRoutes() {
    if (driverName.trim().length === 0) {
      setMessage('Enter the driver name before continuing.');
      return;
    }

    if (!acceptedPrivacy || !acceptedLocation) {
      setMessage('Privacy Policy and Location-Based Services consent are required.');
      return;
    }

    setIsLoggingIn(true);
    setMessage(null);
    resetRouteProgress();

    try {
      const phoneEntry = normalizeDriverPhoneEntry({
        countryIso2: selectedPhoneCountry.iso2,
        nationalPhoneInput,
      });

      if (!phoneEntry.ok) {
        setMessage(formatDriverPhoneEntryProblem(phoneEntry.reason));
        return;
      }

      const lookupResult = await submitRouteAccess({ phoneE164: phoneEntry.phoneE164 }, routeAccessService);
      setSubmission(lookupResult);

      if (lookupResult.kind !== 'company_guidance' && lookupResult.kind !== 'route_choices') {
        setMessage(formatRouteAccessProblem(lookupResult));
        return;
      }

      const choices = getRouteChoicesFromSubmission(lookupResult);
      if (choices.length === 0) {
        setRouteSessions([]);
        setSelectedRouteId(null);
        setSelectedTab('upcoming');
        setScreen('routes');
        setMessage('Phone number verified. No active route is assigned right now.');
        return;
      }

      const loadedSessions: RouteSession[] = [];

      for (const choice of choices) {
        const choiceSubmission = toCompanyGuidanceSubmission(choice);
        await syncOfflineSubmissionsForSubmission(choiceSubmission);

        const consentResult = await submitDriverConsent(
          {
            appContext: { appVersion: '0.1.0', driverName: driverName.trim() },
            deviceContext: { platform: Platform.OS },
            routeContext: choice.routeAccess.routeContext,
          },
          getDriverConsentServiceForCurrentSubmission({
            fallback: mockDriverConsentService,
            runtimeConfig,
            submission: choiceSubmission,
          }),
        );
        setConsentSubmission(consentResult);

        if (consentResult.kind !== 'consent_recorded') {
          setMessage(consentResult.message);
          continue;
        }

        const assignedRouteResult = await loadAssignedRouteAfterConsent(
          {
            consentState: consentResult.flowState,
            routeContext: choice.routeAccess.routeContext,
          },
          getAssignedRouteServiceForCurrentSubmission({
            fallback: mockAssignedRouteService,
            runtimeConfig,
            submission: choiceSubmission,
          }),
        );
        if (assignedRouteResult.kind === 'route_ready') {
          loadedSessions.push({
            ...choice,
            route: assignedRouteResult.route,
          });
        } else {
          setMessage(assignedRouteResult.message);
        }
      }

      if (loadedSessions.length === 0) {
        setRouteSessions([]);
        setSubmission(null);
        setMessage('No active assigned route could be loaded for this phone number.');
        return;
      }

      setRouteSessions(loadedSessions);
      setSelectedRouteId(loadedSessions[0].route.id);
      const firstSubmission = toCompanyGuidanceSubmission(loadedSessions[0]);
      setSubmission(firstSubmission);
      await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(firstSubmission));
      setSelectedTab(getInitialAssignedRouteTab({
        now: new Date(),
        route: loadedSessions[0].route,
      }));
      setScreen('routes');
      setMessage(`${loadedSessions.length} route${loadedSessions.length === 1 ? '' : 's'} loaded.`);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleStartRoute(routeId?: string) {
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

      setSelectedTab('active');
      setNavigationStepIndex(COMPANY_STEP_INDEX);
      setScreen('liveTracking');
      setMessage('Route started. Begin with the company pickup step, then continue in stop order.');
    } finally {
      setIsStartingRoute(false);
      refreshOfflineQueueCount();
    }
  }

  function handleOpenRouteDetail(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('No route is available to review.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setScreen('routeDetail');
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

  function handleAnnounceStopTip(stop: AssignedRouteStop | null) {
    handleAnnounceNavigationTip({ isCompanyStep: false, stop });
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
      setScreen('liveTracking');
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

    setStopDetailsBackTarget('liveTracking');
    setSelectedStopDetailsId(currentStop.deliveryStopId);
    setScreen('stopDetails');
  }

  function handleContinueTracking() {
    setScreen('liveTracking');
  }

  function handleOpenStopFromRouteDetail(stop: AssignedRouteStop) {
    if (selectedRoute === null) {
      setMessage('No route is available to review.');
      return;
    }

    const stopIndex = selectedRoute.stops.findIndex((candidate) => candidate.deliveryStopId === stop.deliveryStopId);
    if (stopIndex === -1) {
      setMessage('This stop is no longer available on the selected route.');
      return;
    }

    setSelectedStopDetailsId(selectedRoute.stops[stopIndex]?.deliveryStopId ?? stop.deliveryStopId);
    setStopDetailsBackTarget('routeDetail');
    setScreen('stopDetails');
  }

  async function handleLoadBackdoorSession() {
    setIsLoadingBackdoorSession(true);
    setMessage(null);
    resetRouteProgress();
    const now = new Date();

    try {
      const backdoorRouteChoice: RouteAccessRouteChoice = {
        companyGuidance: sampleInvitedRouteAccess.companyGuidance,
        driverAccess: sampleInvitedRouteAccess.driverAccess,
        routeAccess: sampleInvitedRouteAccess.routeAccess,
      };
      const adminSession: RouteSession = {
        ...backdoorRouteChoice,
        route: sampleAssignedRoute,
      };
      const backdoorSubmission = toCompanyGuidanceSubmission(adminSession);

      await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(backdoorSubmission));
      setRouteSessions([adminSession]);
      setSelectedRouteId(adminSession.route.id);
      setSubmission(backdoorSubmission);
      setSelectedTab(getInitialAssignedRouteTab({ now, route: adminSession.route }));
      setNavigationStepIndex(COMPANY_STEP_INDEX);
      setScreen('routes');
      setMessage('Loaded admin backdoor session for route testing.');
      if (driverName.trim().length === 0) {
        setDriverName('Test Driver');
      }
    } catch {
      setMessage('Unable to load backdoor session. Try again.');
    } finally {
      setIsLoadingBackdoorSession(false);
    }
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

  async function handleOpenNavigationForCurrentStop(stop: AssignedRouteStop | null) {
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

  async function handleResetSessionForAdmin() {
    if (offlineSubmissionQueue === null) {
      setMessage('Offline queue is unavailable. Wait for app initialization and try again.');
      return;
    }

    const queueToReset = offlineSubmissionQueue;
    try {
      const resetResult = await resetDriverSession({
        driverAccessTokenStore,
        offlineQueue: queueToReset,
      });
      resetRouteProgress();
      setSubmission(null);
      setScreen('login');
      setMessage(`Session reset. Cleared ${resetResult.clearedOfflineSubmissions} queued item(s).`);
    } catch {
      setMessage('Session reset failed.');
    }
  }

  function handleContinueAfterStopCompleted() {
    if (selectedRoute === null) {
      setScreen('routes');
      return;
    }

    if (allStopsCompleted) {
      setScreen('completedDeliveries');
      return;
    }

    setScreen('liveTracking');
  }

  async function handleCapturePhoto(source: ProofPhotoCaptureSource) {
    if (currentStop === null || selectedRoute === null) {
      return;
    }

    setIsCapturingPhoto(true);
    setMessage(null);

    try {
      const captureResult = await captureProofPhoto({ captureService: proofPhotoCaptureService, source });
      setProofPhotoResults((current) => ({ ...current, [currentStop.deliveryStopId]: captureResult }));

      const uploadResult = await uploadCapturedProofPhoto({
        captureResult,
        uploadRequest: {
          deliveryStopId: currentStop.deliveryStopId,
          fileName: getFileNameFromUri(captureResult.kind === 'captured' ? captureResult.uri : '', currentStop.deliveryStopId),
          routePlanId: selectedRoute.id,
        },
        uploadService: getProofMediaUploadServiceForCurrentSubmission({
          fallback: mockProofMediaUploadService,
          runtimeConfig,
          submission,
        }),
      });
      setProofMediaResults((current) => ({ ...current, [currentStop.deliveryStopId]: uploadResult }));

      if (shouldQueueFailedProofMediaUpload(uploadResult) && captureResult.kind === 'captured') {
        offlineSubmissionQueue?.enqueueProofMediaUpload({
          deliveryStopId: currentStop.deliveryStopId,
          fileName: getFileNameFromUri(captureResult.uri, currentStop.deliveryStopId),
          routePlanId: selectedRoute.id,
          source: captureResult.source,
          uri: captureResult.uri,
        });
      }

      setMessage(formatPhotoResult(captureResult, uploadResult));
    } finally {
      setIsCapturingPhoto(false);
      refreshOfflineQueueCount();
    }
  }

  async function handleCompleteCurrentStop() {
    if (currentStop === null || selectedRoute === null || deliveryStartResult === null) {
      return;
    }

    const photoResult = proofPhotoResults[currentStop.deliveryStopId];
    if (photoResult?.kind !== 'captured') {
      setMessage('Photo proof is required. Capture or select a proof photo first.');
      return;
    }

    setIsCompletingStop(true);
    setMessage(null);

    try {
      const draft = getProofDraft(proofDrafts[currentStop.deliveryStopId]);
      const mediaResult = proofMediaResults[currentStop.deliveryStopId];
      const result = await recordStopProofEventAfterDeliveryStart({
        deliveryStart: deliveryStartResult,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          runtimeConfig,
          submission,
        }),
        input: {
          action: 'delivered',
          deliveryStopId: currentStop.deliveryStopId,
          media: mediaResult?.kind === 'uploaded' ? [mediaResult.media] : [],
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
      if (result.kind === 'queued') {
        setMessage('Stop proof was queued for retry. Sync it before finishing this route.');
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

      setNavigationStepIndex((index) => index + 1);
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
      }
      setSelectedTab('completed');
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

  async function syncOfflineSubmissionsForSubmission(
    activeSubmission: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }>,
  ): Promise<OfflineSubmissionRetryResult | null> {
    const queue = offlineSubmissionQueue;
    if (queue === null || queue.listPending().length === 0) {
      return null;
    }

    setIsSyncingOfflineQueue(true);
    try {
      const retryResult = await retryOfflineSubmissions({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          fallback: mockDriverEventService,
          runtimeConfig,
          submission: activeSubmission,
        }),
        proofMediaUploadService: getProofMediaUploadServiceForCurrentSubmission({
          fallback: mockProofMediaUploadService,
          runtimeConfig,
          submission: activeSubmission,
        }),
        queue,
      });
      await queue.whenPersisted();
      if (retryResult.succeeded > 0 || retryResult.discarded > 0) {
        setMessage(formatOfflineRetryResult(retryResult));
      }
      if (retryResult.requiresRouteLookup) {
        setMessage('Offline sync needs a fresh route lookup. Sign in again before continuing.');
      }
      return retryResult;
    } finally {
      setIsSyncingOfflineQueue(false);
      refreshOfflineQueueCount();
    }
  }

  function refreshOfflineQueueCount() {
    setOfflineQueueCount(offlineSubmissionQueue?.listPending().length ?? 0);
  }

  const handleAppBack = useCallback((): boolean => {
    switch (screen) {
      case 'arrivalCheck':
        setScreen('stopDetails');
        return true;
      case 'completedDeliveries':
        setScreen('routes');
        return true;
      case 'liveTracking':
        setScreen('routeDetail');
        return true;
      case 'routeDetail':
        setScreen('routes');
        return true;
      case 'stopCompleted':
        setScreen('routeDetail');
        return true;
      case 'stopDetails':
        setScreen(stopDetailsBackTarget);
        return true;
      case 'login':
      case 'routes':
        return false;
    }
  }, [screen, stopDetailsBackTarget]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleAppBack);
    return () => subscription.remove();
  }, [handleAppBack]);

  const swipeBackResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => {
      if (screen === 'login' || screen === 'routes') {
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        {...swipeBackResponder.panHandlers}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardArea}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {screen === 'login' ? (
            <LoginScreen
              acceptedLocation={acceptedLocation}
              acceptedPrivacy={acceptedPrivacy}
              adminToolsEnabled={ADMIN_SESSION_ENABLED}
              isAdminToolsVisible={isAdminToolsVisible}
              isBackdoorLoading={isLoadingBackdoorSession}
              countrySearchQuery={countrySearchQuery}
              driverPhoneCountries={visiblePhoneCountries}
              driverName={driverName}
              isLoggingIn={isLoggingIn || isSyncingOfflineQueue || offlineSubmissionQueue === null || isLoadingBackdoorSession}
              isCountrySelectorOpen={isCountrySelectorOpen}
              nationalPhoneInput={nationalPhoneInput}
              onAdminToolsToggle={() => {
                if (ADMIN_SESSION_ENABLED) {
                  setIsAdminToolsVisible((value) => !value);
                }
              }}
              onAcceptedLocationChange={setAcceptedLocation}
              onAcceptedPrivacyChange={setAcceptedPrivacy}
              onCountrySearchChange={setCountrySearchQuery}
              onCountrySelect={handlePhoneCountrySelect}
              onCountrySelectorToggle={() => setIsCountrySelectorOpen((current) => !current)}
              onLoadAdminSession={handleLoadBackdoorSession}
              onResetSession={handleResetSessionForAdmin}
              onDriverNameChange={setDriverName}
              onPhoneChange={handlePhoneInputChange}
              onSendCode={handleSendVerificationCode}
              onSubmit={handleLoginAndLoadRoutes}
              onVerificationCodeChange={setVerificationCode}
              phoneE164Preview={phoneE164Preview}
              selectedDriverLocale={selectedDriverLocale}
              selectedPhoneCountry={selectedPhoneCountry}
              verificationCode={verificationCode}
            />
          ) : null}

          {screen === 'routes' ? (
            <RouteListScreen
              completedStopIds={completedStopIds}
              driverName={driverName}
              isStartingRoute={isStartingRoute}
              onOpenCompletedDeliveries={() => setScreen('completedDeliveries')}
              onOpenRouteDetail={handleOpenRouteDetail}
              onSelectRoute={setSelectedRouteId}
              onSelectTab={setSelectedTab}
              onStartRoute={handleStartRoute}
              routeSessions={routeSessions}
              routeStatus={routeStatus}
              selectedRouteId={selectedRouteId}
              selectedTab={selectedTab}
              tabs={routeTabs}
            />
          ) : null}

          {screen === 'routeDetail' && selectedRoute !== null ? (
            <RouteDetailScreen
              allStopsCompleted={allStopsCompleted}
              company={currentCompany}
              completedStopIds={completedStopIds}
              currentNavigationStepIndex={navigationStepIndex}
              deliveryFinishResult={deliveryFinishResult}
              isFinishingRoute={isFinishingRoute}
              isStartingRoute={isStartingRoute}
              onBack={() => setScreen('routes')}
              onContinueTracking={handleContinueTracking}
              onFinishRoute={handleManualFinishRoute}
              onOpenStop={handleOpenStopFromRouteDetail}
              onStartRoute={() => handleStartRoute(selectedRoute.id)}
              route={selectedRoute}
              routeStartedEventResult={routeStartedEventResult}
              routeStatus={routeStatus}
            />
          ) : null}

          {screen === 'liveTracking' && selectedRoute !== null ? (
            <LiveTrackingScreen
              company={currentCompany}
              continuousLocationResult={continuousLocationResult}
              isCompanyStep={isCompanyStep}
              onArrived={handleArrivedAtStep}
              onBack={() => setScreen('routeDetail')}
              onOpenNavigation={() => handleOpenRouteNavigation(selectedRoute)}
              onViewStop={handleViewCurrentStop}
              route={selectedRoute}
              routeStatus={routeStatus}
              stop={currentStop}
            />
          ) : null}

          {screen === 'stopDetails' && stopDetailsStop !== null ? (
            <StopDetailsScreen
              canMarkArrived={stopDetailsCanMarkArrived}
              company={currentCompany}
              onAnnounceTip={() => handleAnnounceStopTip(stopDetailsStop)}
              onArrived={handleArrivedAtStep}
              onBack={() => {
                setSelectedStopDetailsId(null);
                setScreen(stopDetailsBackTarget);
              }}
              onCall={() => handleCallStop(stopDetailsStop)}
              onMessage={() => handleMessageStop(stopDetailsStop)}
              onOpenNavigation={() => handleOpenNavigationForCurrentStop(stopDetailsStop)}
              stop={stopDetailsStop}
            />
          ) : null}

          {screen === 'arrivalCheck' && currentStop !== null ? (
            <ArrivalCheckScreen
              draft={getProofDraft(proofDrafts[currentStop.deliveryStopId])}
              isCapturingPhoto={isCapturingPhoto}
              isCompletingStop={isCompletingStop || isFinishingRoute}
              mediaResult={proofMediaResults[currentStop.deliveryStopId]}
              onAnnounceTip={handleAnnounceCurrentTip}
              onBack={() => setScreen('stopDetails')}
              onCapturePhoto={handleCapturePhoto}
              onCompleteStop={handleCompleteCurrentStop}
              onDraftChange={updateCurrentStopDraft}
              photoResult={proofPhotoResults[currentStop.deliveryStopId]}
              proofResult={stopProofResults[currentStop.deliveryStopId]}
              stop={currentStop}
            />
          ) : null}

          {screen === 'stopCompleted' && selectedRoute !== null ? (
            <StopCompletedScreen
              completedStop={recentlyCompletedStop}
              completedStopIds={completedStopIds}
              completedStopTimes={completedStopTimes}
              onBackToRoute={() => setScreen('routeDetail')}
              onContinue={handleContinueAfterStopCompleted}
              route={selectedRoute}
            />
          ) : null}

          {screen === 'completedDeliveries' && selectedRoute !== null ? (
            <CompletedDeliveriesScreen
              completedStopIds={completedStopIds}
              completedStopTimes={completedStopTimes}
              onBack={() => setScreen('routes')}
              proofMediaResults={proofMediaResults}
              route={selectedRoute}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {message !== null ? <TransientToast text={message} /> : null}
    </SafeAreaView>
  );
}


function LoginScreen({
  acceptedLocation,
  acceptedPrivacy,
  adminToolsEnabled,
  countrySearchQuery,
  driverPhoneCountries,
  driverName,
  isCountrySelectorOpen,
  isLoggingIn,
  nationalPhoneInput,
  isAdminToolsVisible,
  isBackdoorLoading,
  onAdminToolsToggle,
  onAcceptedLocationChange,
  onAcceptedPrivacyChange,
  onCountrySearchChange,
  onCountrySelect,
  onCountrySelectorToggle,
  onLoadAdminSession,
  onDriverNameChange,
  onResetSession,
  onPhoneChange,
  onSendCode,
  onSubmit,
  onVerificationCodeChange,
  phoneE164Preview,
  selectedDriverLocale,
  selectedPhoneCountry,
  verificationCode,
}: {
  acceptedLocation: boolean;
  acceptedPrivacy: boolean;
  adminToolsEnabled: boolean;
  countrySearchQuery: string;
  driverPhoneCountries: DriverPhoneCountry[];
  driverName: string;
  isCountrySelectorOpen: boolean;
  isAdminToolsVisible: boolean;
  isBackdoorLoading: boolean;
  isLoggingIn: boolean;
  nationalPhoneInput: string;
  onAdminToolsToggle(): void;
  onAcceptedLocationChange(value: boolean): void;
  onAcceptedPrivacyChange(value: boolean): void;
  onCountrySearchChange(value: string): void;
  onCountrySelect(country: DriverPhoneCountry): void;
  onCountrySelectorToggle(): void;
  onLoadAdminSession(): void;
  onDriverNameChange(value: string): void;
  onResetSession(): void;
  onPhoneChange(value: string): void;
  onSendCode(): void;
  onSubmit(): void;
  onVerificationCodeChange(value: string): void;
  phoneE164Preview: string | null;
  selectedDriverLocale: string;
  selectedPhoneCountry: DriverPhoneCountry;
  verificationCode: string;
}) {
  return (
    <View style={styles.screenStack}>
      <Pressable
        accessibilityHint={adminToolsEnabled ? 'Long press to show admin tools.' : undefined}
        accessibilityRole={adminToolsEnabled ? 'button' : undefined}
        onLongPress={adminToolsEnabled ? onAdminToolsToggle : undefined}
        delayLongPress={700}
      >
        <View style={styles.brandPanel}>
          <Text style={styles.brandName}><Text style={styles.brandBlue}>Clever</Text> <Text style={styles.brandGreen}>Driver</Text></Text>
          <Text style={styles.brandTagline}>Smarter routes for faster deliveries.</Text>
        </View>
      </Pressable>

      {adminToolsEnabled && isAdminToolsVisible ? (
        <View style={styles.adminPanel}>
          <Text style={styles.adminPanelTitle}>Admin session tools</Text>
          <Text style={styles.helperText}>Use these controls for QA and internal testing only.</Text>
          <View style={styles.buttonColumn}>
            <SecondaryButton
              disabled={isBackdoorLoading || isLoggingIn}
              label="Load admin backdoor session"
              onPress={onLoadAdminSession}
            />
            <SecondaryButton
              disabled={isBackdoorLoading || isLoggingIn}
              label="Reset driver session"
              onPress={onResetSession}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.formCard}>
        <CountrySelector
          countries={driverPhoneCountries}
          isOpen={isCountrySelectorOpen}
          onSearchChange={onCountrySearchChange}
          onSelectCountry={onCountrySelect}
          onToggle={onCountrySelectorToggle}
          searchQuery={countrySearchQuery}
          selectedCountry={selectedPhoneCountry}
          selectedLocale={selectedDriverLocale}
        />
        <PhoneNumberInput
          callingCode={selectedPhoneCountry.callingCode}
          e164Preview={phoneE164Preview}
          onChangeText={onPhoneChange}
          value={nationalPhoneInput}
        />
        <LabeledInput
          label="Verification Code"
          onChangeText={onVerificationCodeChange}
          placeholder="Verification code"
          rightActionLabel="Send Code"
          onRightAction={onSendCode}
          value={verificationCode}
        />
        <LabeledInput label="Full Name" onChangeText={onDriverNameChange} placeholder="Enter your full name" value={driverName} />
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
        <PrimaryButton disabled={isLoggingIn} label="Continue" loading={isLoggingIn} onPress={onSubmit} />
      </View>
    </View>
  );
}

function RouteListScreen({
  completedStopIds,
  driverName,
  isStartingRoute,
  onOpenCompletedDeliveries,
  onOpenRouteDetail,
  onSelectRoute,
  onSelectTab,
  onStartRoute,
  routeSessions,
  routeStatus,
  selectedRouteId,
  selectedTab,
  tabs,
}: {
  completedStopIds: string[];
  driverName: string;
  isStartingRoute: boolean;
  onOpenCompletedDeliveries(): void;
  onOpenRouteDetail(routeId: string): void;
  onSelectRoute(routeId: string): void;
  onSelectTab(tab: RouteTabId): void;
  onStartRoute(routeId: string): void;
  routeSessions: RouteSession[];
  routeStatus: RouteStatus;
  selectedRouteId: string | null;
  selectedTab: RouteTabId;
  tabs: ReturnType<typeof getMvpRouteTabs>;
}) {
  const classificationNow = new Date();
  const visibleRouteSessions = filterVisibleAssignedRouteSessions(routeSessions, {
    now: classificationNow,
    selectedRouteId,
    selectedRouteStatus: routeStatus,
    selectedTab,
  });
  const activeSession = visibleRouteSessions.find((session) => session.route.id === selectedRouteId) ?? visibleRouteSessions[0] ?? null;
  const activeIndex = activeSession === null ? -1 : visibleRouteSessions.findIndex((session) => session.route.id === activeSession.route.id);
  const activeSessionStatus = activeSession === null
    ? selectedTab
    : getRouteSessionStatus(activeSession.route, selectedRouteId, routeStatus, classificationNow);

  function selectRelativeRoute(offset: number) {
    if (visibleRouteSessions.length === 0 || activeIndex < 0) {
      return;
    }

    const nextIndex = (activeIndex + offset + visibleRouteSessions.length) % visibleRouteSessions.length;
    onSelectRoute(visibleRouteSessions[nextIndex].route.id);
  }

  return (
    <View style={styles.screenStack}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Assigned Routes</Text>
        <Text style={styles.helperText}>{driverName.trim() ? `${driverName.trim()}, your assigned route is ready.` : 'Your assigned route is ready.'}</Text>
      </View>
      <SegmentedTabs onSelectTab={onSelectTab} selectedTab={selectedTab} tabs={tabs} />

      {activeSession !== null ? (
        <View style={styles.selectedRouteCard}>
          <View style={styles.routeCardHeader}>
            <View style={styles.routeInitialBadge}>
              <Text style={styles.routeInitialText}>{getInitials(activeSession.companyGuidance.companyDisplayName)}</Text>
            </View>
            <View style={styles.routeHeaderText}>
              <Text numberOfLines={1} style={styles.cardTitle}>{activeSession.companyGuidance.companyDisplayName}</Text>
              <Text numberOfLines={1} style={styles.helperText}>{activeSession.route.name}</Text>
            </View>
            <StatusChip tone={getChipTone(activeSessionStatus)} label={formatRouteStatus(activeSessionStatus)} />
          </View>

          <DataRow label="Company" value={activeSession.companyGuidance.companyDisplayName} />
          <DataRow label="Date" value={activeSession.route.deliveryDate} />
          <DataRow label="Region" value={getRouteRegion(activeSession.route)} />
          <DataRow label="Route" value={formatRouteSequence(activeSession.route)} />
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

          {selectedTab === 'completed' ? (
            <PrimaryButton label="View Completed Deliveries" onPress={onOpenCompletedDeliveries} />
          ) : selectedTab === 'active' ? (
            <PrimaryButton label="Continue Route" onPress={() => onOpenRouteDetail(activeSession.route.id)} />
          ) : (
            <View style={styles.buttonColumn}>
              <PrimaryButton disabled={isStartingRoute} label="Start Route" loading={isStartingRoute} onPress={() => onStartRoute(activeSession.route.id)} />
              <SecondaryButton label="Route Details" onPress={() => onOpenRouteDetail(activeSession.route.id)} />
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          title="No assigned route"
          body={formatRouteEmptyState(selectedTab, completedStopIds.length)}
        />
      )}

      <BottomNavigation selected="Home" />
    </View>
  );
}

function RouteDetailScreen({
  allStopsCompleted,
  company,
  completedStopIds,
  currentNavigationStepIndex,
  deliveryFinishResult,
  isFinishingRoute,
  isStartingRoute,
  onBack,
  onContinueTracking,
  onFinishRoute,
  onOpenStop,
  onStartRoute,
  route,
  routeStartedEventResult,
  routeStatus,
}: {
  allStopsCompleted: boolean;
  company: RouteAccessCompanyGuidance | null;
  completedStopIds: string[];
  currentNavigationStepIndex: number;
  deliveryFinishResult: DeliveryFinishResult | null;
  isFinishingRoute: boolean;
  isStartingRoute: boolean;
  onBack(): void;
  onContinueTracking(): void;
  onFinishRoute(): void;
  onOpenStop(stop: AssignedRouteStop): void;
  onStartRoute(): void;
  route: AssignedRoute;
  routeStartedEventResult: RouteStartedRecordResult | null;
  routeStatus: RouteStatus;
}) {
  const depotIsProcessing = routeStatus === 'active' && currentNavigationStepIndex === COMPANY_STEP_INDEX;
  const depotMeta = depotIsProcessing ? 'Processing' : routeStatus === 'upcoming' ? 'Start' : 'Done';
  const depotMetaTone = depotIsProcessing ? 'blue' : routeStatus === 'upcoming' ? 'neutral' : 'green';
  const depotState = routeStatus === 'upcoming' || depotIsProcessing ? 'current' : 'completed';

  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Route Details" />
      <View style={styles.summaryCard}>
        <Text numberOfLines={1} style={styles.cardTitle}>{company?.companyDisplayName ?? route.shopDomain}</Text>
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

      <View style={styles.timelineCard}>
        <Text style={styles.sectionTitle}>Route Sequence</Text>
        <TimelineRow marker="D" title="Depot" subtitle="Pickup point" state={depotState} meta={depotMeta} metaTone={depotMetaTone} />
        {route.stops.map((stop, index) => {
          const completed = completedStopIds.includes(stop.deliveryStopId);
          const isProcessing = routeStatus === 'active' && currentNavigationStepIndex === index + 1 && !completed;
          const state = completed ? 'completed' : isProcessing ? 'current' : 'upcoming';
          const meta = completed ? 'Done' : isProcessing ? 'Processing' : 'Pending';
          const metaTone = completed ? 'green' : isProcessing ? 'blue' : 'neutral';
          return (
            <TimelineRow
              key={stop.deliveryStopId}
              marker={String(stop.sequence)}
              title={`Stop ${stop.sequence}`}
              subtitle={formatStopAddress(stop)}
              state={state}
              meta={meta}
              metaTone={metaTone}
              onPress={() => onOpenStop(stop)}
            />
          );
        })}
      </View>

      {routeStartedEventResult?.kind === 'recorded' ? <StatusBanner tone="green" text="Route start event recorded." /> : null}
      {deliveryFinishResult?.flowState === 'delivery_finished' ? <StatusBanner tone="green" text={deliveryFinishResult.message} /> : null}

      <View style={styles.buttonColumn}>
        {routeStatus === 'upcoming' ? (
          <PrimaryButton disabled={isStartingRoute} label="Begin Tracking" loading={isStartingRoute} onPress={onStartRoute} />
        ) : routeStatus === 'active' && allStopsCompleted ? (
          <PrimaryButton disabled={isFinishingRoute} label="Finish Route" loading={isFinishingRoute} onPress={onFinishRoute} />
        ) : routeStatus === 'active' ? (
          <PrimaryButton label="Continue Tracking" onPress={onContinueTracking} />
        ) : null}
        <SecondaryButton label="Back to Menu" onPress={onBack} />
      </View>
    </View>
  );
}

function LiveTrackingScreen({
  company,
  continuousLocationResult,
  isCompanyStep,
  onArrived,
  onBack,
  onOpenNavigation,
  onViewStop,
  route,
  routeStatus,
  stop,
}: {
  company: RouteAccessCompanyGuidance | null;
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  isCompanyStep: boolean;
  onArrived(): void;
  onBack(): void;
  onOpenNavigation(): void;
  onViewStop(): void;
  route: AssignedRoute;
  routeStatus: RouteStatus;
  stop: AssignedRouteStop | null;
}) {
  const stepLabel = isCompanyStep ? 'Company Pickup' : stop === null ? 'Next Stop' : `Stop ${stop.sequence}`;
  const destination = isCompanyStep ? company?.pickupGuidance ?? 'Pickup guidance' : stop === null ? 'Stop address' : formatStopAddress(stop);
  const trackingLabel = continuousLocationResult?.kind === 'streaming' || routeStatus === 'active' ? 'GPS tracking active' : 'GPS tracking pending';

  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Live Tracking" />
      <View style={styles.trackingCard}>
        <View style={styles.gpsStatusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.gpsPillText}>{trackingLabel}</Text>
        </View>
        <View style={styles.destinationBlock}>
          <Text style={styles.labelText}>Current destination</Text>
          <Text numberOfLines={4} style={styles.sheetTitle}>{destination}</Text>
          <Text style={styles.helperText}>{stepLabel}</Text>
        </View>
        <View style={styles.trackingMetrics}>
          <MetricBlock label="Distance" value={formatAssignedRouteDistance(route.routeMetrics)} />
          <MetricBlock label="ETA" value={formatAssignedRouteDuration(route.routeMetrics)} />
          <MetricBlock label="Status" value={routeStatus === 'active' ? 'In progress' : 'Pending'} tone={routeStatus === 'active' ? 'green' : 'neutral'} />
        </View>
        <View style={styles.buttonColumn}>
          <PrimaryButton label="Open in Map" onPress={onOpenNavigation} />
          <Text style={styles.helperText}>Opens this route in your default map app.</Text>
          {isCompanyStep || stop === null ? null : <SecondaryButton label="View Stop" onPress={onViewStop} />}
          <PrimaryButton label={isCompanyStep ? 'Pickup Confirmed' : 'Arrived'} onPress={onArrived} />
        </View>
      </View>
    </View>
  );
}

function StopDetailsScreen({
  canMarkArrived,
  company,
  onAnnounceTip,
  onArrived,
  onBack,
  onCall,
  onMessage,
  onOpenNavigation,
  stop,
}: {
  canMarkArrived: boolean;
  company: RouteAccessCompanyGuidance | null;
  onAnnounceTip(): void;
  onArrived(): void;
  onBack(): void;
  onCall(): void;
  onMessage(): void;
  onOpenNavigation(): void;
  stop: AssignedRouteStop;
}) {
  const tip = getNavigationTip({ company, isCompanyStep: false, stop });
  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Stop Details" />
      <View style={styles.stopSummaryCard}>
        <View style={styles.stopBadge}><Text style={styles.stopBadgeText}>Stop {stop.sequence}</Text></View>
        <View style={styles.routeHeaderText}>
          <Text numberOfLines={2} style={styles.cardTitle}>{formatStopAddress(stop)}</Text>
          <Text numberOfLines={1} style={styles.helperText}>{stop.recipientName ?? 'Recipient / Location'}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Delivery Instructions</Text>
      <TextCard text="Delivery instructions are provided by dispatch when available." />
      <Text style={styles.sectionTitle}>Location Tips</Text>
      <TextCard text={tip} />
      <View style={styles.buttonRow}>
        <SecondaryButton label="Open Stop Map" onPress={onOpenNavigation} />
        <SecondaryButton label="Call" onPress={onCall} />
        <SecondaryButton label="Message" onPress={onMessage} />
      </View>
      <View style={styles.buttonColumn}>
        {canMarkArrived ? (
          <PrimaryButton label="Arrived" onPress={onArrived} />
        ) : (
          <StatusBanner
            tone="warning"
            text="Preview only. Use Live Tracking and the current-step button to advance route progress."
          />
        )}
        <SecondaryButton label="I’m Nearby" onPress={onAnnounceTip} />
      </View>
    </View>
  );
}

function ArrivalCheckScreen({
  draft,
  isCapturingPhoto,
  isCompletingStop,
  mediaResult,
  onAnnounceTip,
  onBack,
  onCapturePhoto,
  onCompleteStop,
  onDraftChange,
  photoResult,
  proofResult,
  stop,
}: {
  draft: StopProofDraft;
  isCapturingPhoto: boolean;
  isCompletingStop: boolean;
  mediaResult?: ProofMediaUploadResult;
  onAnnounceTip(): void;
  onBack(): void;
  onCapturePhoto(source: ProofPhotoCaptureSource): void;
  onCompleteStop(): void;
  onDraftChange(patch: Partial<StopProofDraft>): void;
  photoResult?: ProofPhotoCaptureResult;
  proofResult?: StopProofEventResult;
  stop: AssignedRouteStop;
}) {
  return (
    <View style={styles.screenStack}>
      <ScreenHeader onBack={onBack} title="Arrival Check" />
      <Pressable accessibilityRole="button" onPress={onAnnounceTip} style={styles.nearbyBanner}>
        <View style={styles.statusDot} />
        <View style={styles.routeHeaderText}>
          <Text style={styles.nearbyTitle}>You’re near the destination</Text>
          <Text style={styles.helperText}>Voice tip available for this area.</Text>
        </View>
      </Pressable>

      <Text style={styles.sectionTitle}>Photo Proof</Text>
      <View style={styles.proofTileRow}>
        <ProofTile disabled={isCapturingPhoto} label="Camera Proof" loading={isCapturingPhoto} onPress={() => onCapturePhoto('camera')} />
        <ProofTile disabled={isCapturingPhoto} label="Library Proof" loading={isCapturingPhoto} onPress={() => onCapturePhoto('library')} />
        <View style={styles.proofTile}><Text style={styles.proofTileText}>{photoResult?.kind === 'captured' ? 'Proof Ready' : 'Proof Item'}</Text></View>
      </View>
      {photoResult !== undefined ? <StatusBanner tone={photoResult.kind === 'captured' ? 'green' : 'warning'} text={formatPhotoCaptureResult(photoResult)} /> : null}
      {mediaResult !== undefined ? <StatusBanner tone={mediaResult.kind === 'uploaded' ? 'green' : 'warning'} text={formatMediaUploadResult(mediaResult)} /> : null}

      <LabeledInput
        label="Today’s Delivery Notes"
        onChangeText={(value) => onDraftChange({ todayNote: value })}
        placeholder="Select an issue"
        value={draft.todayNote}
      />
      <LabeledInput
        label="Location Tip"
        onChangeText={(value) => onDraftChange({ locationTip: value })}
        placeholder="Add or select a delivery tip"
        value={draft.locationTip}
      />
      <LabeledInput
        label="Additional Notes"
        multiline
        onChangeText={(value) => onDraftChange({ additionalNotes: value })}
        placeholder="Add any additional notes here…"
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
      <PrimaryButton label={nextStop === null ? 'View Completed Deliveries' : 'Continue to Next Stop'} onPress={onContinue} />
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
        <Text style={styles.pageTitleSmall}>Today</Text>
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

function ScreenHeader({ title }: { onBack?(): void; rightLabel?: string; title: string }) {
  return (
    <View style={styles.screenHeader}>
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function SegmentedTabs({ onSelectTab, selectedTab, tabs }: { onSelectTab(tab: RouteTabId): void; selectedTab: RouteTabId; tabs: ReturnType<typeof getMvpRouteTabs> }) {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => (
        <Pressable accessibilityRole="button" key={tab.id} onPress={() => onSelectTab(tab.id)} style={[styles.tab, selectedTab === tab.id && styles.tabActive]}>
          <Text style={[styles.tabText, selectedTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CountrySelector({
  countries,
  isOpen,
  onSearchChange,
  onSelectCountry,
  onToggle,
  searchQuery,
  selectedCountry,
  selectedLocale,
}: {
  countries: DriverPhoneCountry[];
  isOpen: boolean;
  onSearchChange(value: string): void;
  onSelectCountry(country: DriverPhoneCountry): void;
  onToggle(): void;
  searchQuery: string;
  selectedCountry: DriverPhoneCountry;
  selectedLocale: string;
}) {
  const selectedText = getSelectedCountryCardText(selectedCountry, { locale: selectedLocale });

  return (
    <View style={[styles.inputGroup, styles.countrySelectorGroup, isOpen && styles.countrySelectorGroupOpen]}>
      <Text style={styles.inputLabel}>Country</Text>
      <Pressable
        accessibilityHint={isOpen ? 'Closes the country search list.' : 'Opens the country search list.'}
        accessibilityLabel={`Country ${selectedText.title} ${selectedText.callingCode}`}
        accessibilityRole="button"
        onPress={onToggle}
        style={styles.countrySelectorButton}
      >
        <View style={styles.routeHeaderText}>
          <Text numberOfLines={1} style={styles.countrySelectorText}>{selectedText.title}</Text>
        </View>
        <Text style={styles.countryCallingCodeText}>{selectedText.callingCode}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.countryListPanel}>
          <LabeledInput
            label="Search Country"
            onChangeText={onSearchChange}
            placeholder="Country, ISO, + code, locale, or language"
            value={searchQuery}
          />
          <ScrollView nestedScrollEnabled style={styles.countryListScroll}>
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
      ) : null}
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
  keyboardType,
  label,
  multiline,
  onChangeText,
  onRightAction,
  placeholder,
  rightActionLabel,
  value,
}: {
  keyboardType?: 'default' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  onRightAction?(): void;
  placeholder: string;
  rightActionLabel?: string;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.inputShell, multiline === true && styles.multilineInput]}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType ?? 'default'}
          multiline={multiline}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8a94a6"
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
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onValueChange(!value)} style={styles.consentRow}>
      <View style={[styles.checkboxBox, value && styles.checkboxBoxSelected]} />
      <Text style={styles.consentText}>{label} <Text style={styles.linkText}>{linkLabel}</Text></Text>
    </Pressable>
  );
}

function PrimaryButton({ disabled, label, loading, onPress }: { disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function SecondaryButton({ compact, disabled, label, loading, onPress }: { compact?: boolean; disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.secondaryButton, compact === true && styles.compactButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#0b57d0" /> : <Text style={styles.secondaryButtonText}>{label}</Text>}
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

function StatusChip({ label, tone }: { label: string; tone: 'blue' | 'green' | 'neutral' | 'warning' }) {
  const toneStyle = tone === 'blue'
    ? styles.statusChipBlue
    : tone === 'green'
      ? styles.statusChipGreen
      : tone === 'warning'
        ? styles.statusChipWarning
        : styles.statusChipNeutral;
  return <Text style={[styles.statusChip, toneStyle]}>{label}</Text>;
}

function TimelineRow({
  marker,
  meta,
  metaTone,
  onPress,
  state,
  subtitle,
  title,
}: {
  marker: string;
  meta: string;
  metaTone: 'blue' | 'green' | 'neutral';
  onPress?: () => void;
  state: 'completed' | 'current' | 'upcoming';
  subtitle: string;
  title: string;
}) {
  const content = (
    <>
      <View style={[styles.timelineMarker, state === 'completed' && styles.timelineMarkerCompleted, state === 'current' && styles.timelineMarkerCurrent]}>
        <Text style={[styles.timelineMarkerText, (state === 'completed' || state === 'current') && styles.timelineMarkerTextActive]}>{marker}</Text>
      </View>
      <View style={styles.routeHeaderText}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.helperText}>{subtitle}</Text>
      </View>
      <StatusChip label={meta} tone={metaTone} />
    </>
  );

  if (onPress !== undefined) {
    return (
      <Pressable
        accessibilityLabel={`${title}. ${subtitle}. ${meta}.`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.timelineRow,
          styles.timelineRowInteractive,
          state === 'current' && styles.timelineRowCurrent,
          pressed && styles.timelineRowPressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.timelineRow, state === 'current' && styles.timelineRowCurrent]}>
      {content}
    </View>
  );
}

function ProofTile({ disabled, label, loading, onPress }: { disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.proofTile, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#0b57d0" /> : <Text style={styles.proofTileText}>{label}</Text>}
    </Pressable>
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

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </View>
  );
}

function BottomNavigation({ selected }: { selected: 'Earnings' | 'Home' | 'Profile' | 'Routes' }) {
  const items = ['Home', 'Routes', 'Earnings', 'Profile'] as const;
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => <Text key={item} style={[styles.bottomNavLabel, item === selected && styles.bottomNavLabelSelected]}>{item}</Text>)}
    </View>
  );
}

function getDriverConsentServiceForCurrentSubmission(input: {
  fallback: DriverConsentService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverConsentService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverConsentService;
}

function getAssignedRouteServiceForCurrentSubmission(input: {
  fallback: AssignedRouteService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): AssignedRouteService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).assignedRouteService;
}

function getDriverEventServiceForCurrentSubmission(input: {
  fallback: DriverEventService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverEventService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverEventService;
}

function getProofMediaUploadServiceForCurrentSubmission(input: {
  fallback: ProofMediaUploadService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): ProofMediaUploadService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.fallback;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
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

function getRouteSessionStatus(route: AssignedRoute, selectedRouteId: string | null, selectedRouteStatus: RouteStatus, now: Date): RouteStatus {
  return classifyAssignedRouteSession({
    now,
    route,
    selectedRouteId,
    selectedRouteStatus,
  });
}

function formatRouteAccessProblem(result: RouteAccessSubmissionResult): string {
  if (result.kind === 'validation_error' || result.kind === 'denied' || result.kind === 'multiple_matches') {
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

function formatRouteEmptyState(selectedTab: RouteTabId, completedStopCount: number): string {
  if (selectedTab === 'completed' && completedStopCount > 0) {
    return 'Completed stops are available after route completion.';
  }
  if (selectedTab === 'unfinished') {
    return 'No unfinished route is available.';
  }

  return 'No route is available for this status.';
}

function formatOfflineRetryResult(result: OfflineSubmissionRetryResult): string {
  const parts = [
    result.succeeded > 0 ? `${result.succeeded} synced` : null,
    result.discarded > 0 ? `${result.discarded} discarded` : null,
    result.failed > 0 ? `${result.failed} still pending` : null,
  ].filter((value): value is string => value !== null);

  return parts.length === 0
    ? 'Offline sync checked. No pending updates were sent.'
    : `Offline sync complete: ${parts.join(', ')}.`;
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
    draft.todayNote.trim().length > 0 ? `Delivery note: ${draft.todayNote.trim()}` : null,
    draft.locationTip.trim().length > 0 ? `Location tip: ${draft.locationTip.trim()}` : null,
    draft.additionalNotes.trim().length > 0 ? `Additional notes: ${draft.additionalNotes.trim()}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n') || 'Photo proof submitted.';
}

function formatPhotoResult(captureResult: ProofPhotoCaptureResult, uploadResult: ProofMediaUploadResult): string {
  return `${formatPhotoCaptureResult(captureResult)} ${formatMediaUploadResult(uploadResult)}`.trim();
}

function formatPhotoCaptureResult(result: ProofPhotoCaptureResult): string {
  if (result.kind === 'captured') {
    return `Photo proof attached from ${result.source}.`;
  }

  if (result.kind === 'cancelled') {
    return 'Photo selection was cancelled.';
  }

  return result.message;
}

function formatMediaUploadResult(result: ProofMediaUploadResult): string {
  if (result.kind === 'uploaded') {
    return `Proof uploaded: ${result.media.mediaId}`;
  }

  return result.message;
}

function formatStopProofResult(result: StopProofEventResult): string {
  if (result.kind === 'recorded') {
    return `Stop completion recorded: ${result.eventId}`;
  }

  if (result.kind === 'queued') {
    return `Saved to offline queue: ${result.queueItemId}`;
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

function formatRouteSequence(route: AssignedRoute): string {
  if (route.stops.length === 0) {
    return 'Depot';
  }

  const stopMarkers = route.stops.map((stop, index) => (index === route.stops.length - 1 ? 'Last' : String(stop.sequence)));
  return ['Depot', ...stopMarkers].join(' → ');
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
  safeArea: {
    backgroundColor: '#f7f9fc',
    flex: 1,
  },
  keyboardArea: {
    flex: 1,
  },
  container: {
    gap: 22,
    padding: 22,
    paddingBottom: APP_CONTENT_BOTTOM_CLEARANCE,
  },
  screenStack: {
    gap: 22,
    overflow: 'visible',
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
  adminPanel: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  adminPanelTitle: {
    color: '#8a4f09',
    fontSize: 15,
    fontWeight: '800',
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
  countrySelectorGroup: {
    overflow: 'visible',
    position: 'relative',
    zIndex: 20,
  },
  countrySelectorGroupOpen: {
    zIndex: COUNTRY_SELECTOR_OVERLAY_BEHAVIOR.zIndex,
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
  countryListPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    borderWidth: 1,
    elevation: COUNTRY_SELECTOR_OVERLAY_BEHAVIOR.elevation,
    gap: 10,
    left: 0,
    padding: 12,
    position: COUNTRY_SELECTOR_OVERLAY_BEHAVIOR.position,
    right: 0,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    top: 84,
    zIndex: COUNTRY_SELECTOR_OVERLAY_BEHAVIOR.zIndex,
  },
  countryListScroll: {
    maxHeight: COUNTRY_SELECTOR_OVERLAY_BEHAVIOR.maxVisibleRows * 62,
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
  consentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
  },
  checkboxBox: {
    backgroundColor: '#ffffff',
    borderColor: '#cfd6e4',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 24,
    width: 24,
  },
  checkboxBoxSelected: {
    backgroundColor: '#0b57d0',
    borderColor: '#0b57d0',
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
  tabs: {
    backgroundColor: '#ffffff',
    borderColor: '#d9dee8',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  tabActive: {
    backgroundColor: '#0b57d0',
  },
  tabText: {
    color: '#475467',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#ffffff',
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
  bottomNav: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#eef2f6',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    minHeight: BOTTOM_NAV_MIN_HEIGHT,
    paddingHorizontal: 10,
  },
  bottomNavLabel: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomNavLabelSelected: {
    color: '#0b57d0',
    fontWeight: '900',
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
  timelineCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  timelineRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  timelineRowInteractive: {
    borderColor: '#eef2f6',
    borderWidth: 1,
  },
  timelineRowCurrent: {
    backgroundColor: '#eef6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
  },
  timelineRowPressed: {
    opacity: 0.72,
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
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  timelineMeta: {
    color: '#475467',
    fontSize: 12,
    fontWeight: '800',
  },
  trackingCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 22,
    borderWidth: 1,
    gap: 16,
    padding: 18,
    ...shadow,
  },
  gpsStatusRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ecfdf3',
    borderColor: '#abefc6',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusDot: {
    backgroundColor: '#12b76a',
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  gpsPillText: {
    color: '#087443',
    fontSize: 14,
    fontWeight: '800',
  },
  destinationBlock: {
    backgroundColor: '#f8fafc',
    borderColor: '#e5e7eb',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  labelText: {
    color: '#667085',
    fontSize: 13,
    fontWeight: '700',
  },
  sheetTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 27,
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
  proofTileRow: {
    flexDirection: 'row',
    gap: 12,
  },
  proofTile: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1.4,
    flex: 1,
    height: 112,
    justifyContent: 'center',
    padding: 10,
  },
  proofTileText: {
    color: '#475467',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
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
  emptyTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
});
