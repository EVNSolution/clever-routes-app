import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createMockAssignedRouteService,
  loadAssignedRouteAfterConsent,
  sampleAssignedRoute,
  type AssignedRoute,
  type AssignedRouteService,
  type AssignedRouteStop,
} from './src/assignedRoute';
import {
  recordContinuousLocationUpdateBatch,
  startContinuousLocationUpdatesAfterDeliveryStart,
  stopContinuousLocationUpdates,
  type ContinuousLocationStopResult,
  type ContinuousLocationStreamStartResult,
} from './src/continuousLocationStream';
import { finishDeliveryAfterActive, type DeliveryFinishResult } from './src/deliveryFinish';
import { startDeliveryWithForegroundPermission, type DeliveryStartResult } from './src/deliveryStart';
import { createDriverApiClientsFromRouteAccess } from './src/driverApiClients';
import { createMockDriverEventService, recordRouteStartedAfterDeliveryStart, type DriverEventService, type RouteStartedRecordResult } from './src/driverEvents';
import { createExpoContinuousLocationStreamService, registerContinuousLocationTaskHandler } from './src/expoContinuousLocationStreamService';
import { createExpoForegroundLocationPermissionService } from './src/expoLocationPermissionService';
import { createExpoOfflineSubmissionQueueStorage } from './src/expoOfflineSubmissionQueueStorage';
import { createExpoProofPhotoCaptureService } from './src/expoProofPhotoCaptureService';
import { createExpoSecureDriverAccessTokenStore } from './src/expoSecureDriverAccessTokenStore';
import { createPersistentOfflineSubmissionQueue, type OfflineSubmissionQueue } from './src/offlineSubmissionQueue';
import { captureProofPhoto, type ProofPhotoCaptureResult, type ProofPhotoCaptureSource } from './src/proofPhotoCapture';
import {
  createMockProofMediaUploadService,
  shouldQueueFailedProofMediaUpload,
  uploadCapturedProofPhoto,
  type ProofMediaUploadResult,
  type ProofMediaUploadService,
} from './src/proofMediaUpload';
import { createDriverRuntimeServices, readDriverRuntimeConfig } from './src/driverRuntimeConfig';
import { createMockDriverConsentService, submitDriverConsent, type DriverConsentService, type DriverConsentSubmissionResult } from './src/driverConsent';
import { getMvpRouteTabs } from './src/driverFlow';
import {
  createMockRouteAccessService,
  sampleInvitedRouteAccess,
  submitRouteAccess,
  type RouteAccessCompanyGuidance,
  type RouteAccessLookupResult,
  type RouteAccessRouteChoice,
  type RouteAccessSubmissionResult,
} from './src/routeAccess';
import { openStopNavigation, type StopNavigationResult } from './src/stopNavigation';
import { recordStopProofEventAfterDeliveryStart, type StopProofEventResult } from './src/stopProofEvents';

type AppScreen = 'login' | 'navigation' | 'routeDetail' | 'routes' | 'stopProof';
type RouteTabId = ReturnType<typeof getMvpRouteTabs>[number]['id'];
type RouteStatus = 'active' | 'completed' | 'upcoming';

type StopProofDraft = {
  locationTip: string;
  todayNote: string;
};

type RouteSession = RouteAccessRouteChoice & {
  route: AssignedRoute;
};

const SAMPLE_PHONE_E164 = '+14165550123';
const DEFAULT_DRIVER_NAME = '배송원';
const COMPANY_STEP_INDEX = 0;

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('login');
  const [phoneE164, setPhoneE164] = useState(SAMPLE_PHONE_E164);
  const [driverName, setDriverName] = useState(DEFAULT_DRIVER_NAME);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedLocation, setAcceptedLocation] = useState(false);
  const [selectedTab, setSelectedTab] = useState<RouteTabId>('upcoming');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = useState(COMPANY_STEP_INDEX);
  const [routeSessions, setRouteSessions] = useState<RouteSession[]>([]);

  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [consentSubmission, setConsentSubmission] = useState<DriverConsentSubmissionResult | null>(null);
  const [deliveryStartResult, setDeliveryStartResult] = useState<DeliveryStartResult | null>(null);
  const [deliveryFinishResult, setDeliveryFinishResult] = useState<DeliveryFinishResult | null>(null);
  const [routeStartedEventResult, setRouteStartedEventResult] = useState<RouteStartedRecordResult | null>(null);
  const [continuousLocationResult, setContinuousLocationResult] = useState<ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null>(null);
  const [stopProofResults, setStopProofResults] = useState<Record<string, StopProofEventResult>>({});
  const [proofDrafts, setProofDrafts] = useState<Record<string, StopProofDraft>>({});
  const [proofPhotoResults, setProofPhotoResults] = useState<Record<string, ProofPhotoCaptureResult>>({});
  const [proofMediaResults, setProofMediaResults] = useState<Record<string, ProofMediaUploadResult>>({});
  const [stopNavigationResults, setStopNavigationResults] = useState<Record<string, StopNavigationResult>>({});
  const [completedStopIds, setCompletedStopIds] = useState<string[]>([]);
  const [offlineSubmissionQueue, setOfflineSubmissionQueue] = useState<OfflineSubmissionQueue | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isStartingRoute, setIsStartingRoute] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isCompletingStop, setIsCompletingStop] = useState(false);
  const [isFinishingRoute, setIsFinishingRoute] = useState(false);
  const [isOpeningNavigation, setIsOpeningNavigation] = useState(false);

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
  const currentStop = selectedRoute === null ? null : selectedRoute.stops[navigationStepIndex - 1] ?? null;
  const isCompanyStep = navigationStepIndex === COMPANY_STEP_INDEX;
  const allStopsCompleted = selectedRoute !== null && selectedRoute.stops.every((stop) => completedStopIds.includes(stop.deliveryStopId));
  const currentCompany = selectedRouteSession?.companyGuidance ?? null;

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
          setMessage('오프라인 큐 저장소를 열지 못했습니다. 현재 세션에서만 재시도합니다.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [offlineSubmissionQueueStorage]);

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

  async function handleLoginAndLoadRoutes() {
    if (driverName.trim().length === 0) {
      setMessage('이름을 입력해 주세요.');
      return;
    }

    if (!acceptedPrivacy || !acceptedLocation) {
      setMessage('개인정보활용 동의와 위치기반서비스 동의가 모두 필요합니다.');
      return;
    }

    setIsLoggingIn(true);
    setMessage(null);
    resetRouteProgress();

    try {
      const lookupResult = await submitRouteAccess({ phoneE164 }, routeAccessService);
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
        setMessage('등록된 전화번호를 확인했습니다. 현재 배정된 활성 라우트가 없습니다.');
        return;
      }

      const loadedSessions: RouteSession[] = [];

      for (const choice of choices) {
        const choiceSubmission = toCompanyGuidanceSubmission(choice);
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
        setMessage('전화번호에 배정된 활성 라우트를 불러오지 못했습니다.');
        return;
      }

      setRouteSessions(loadedSessions);
      setSelectedRouteId(loadedSessions[0].route.id);
      const firstSubmission = toCompanyGuidanceSubmission(loadedSessions[0]);
      setSubmission(firstSubmission);
      await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(firstSubmission));
      setSelectedTab('upcoming');
      setScreen('routes');
      setMessage(`${loadedSessions.length}개 라우트를 불러왔습니다.`);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleStartRoute(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('시작할 라우트가 없습니다.');
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
      setScreen('navigation');
      setMessage('배송을 시작했습니다. 회사 픽업부터 순서대로 진행하세요.');
    } finally {
      setIsStartingRoute(false);
      refreshOfflineQueueCount();
    }
  }

  function handleOpenRouteDetail(routeId?: string) {
    const routeSession = getRouteSessionForAction(routeSessions, routeId ?? selectedRouteId);
    if (routeSession === null) {
      setMessage('확인할 라우트가 없습니다.');
      return;
    }

    setSelectedRouteId(routeSession.route.id);
    setSubmission(toCompanyGuidanceSubmission(routeSession));
    setScreen('routeDetail');
  }

  async function handleOpenCurrentNavigation() {
    if (currentStop === null) {
      setMessage('회사 픽업 단계는 회사 안내를 확인한 뒤 다음으로 이동하세요.');
      return;
    }

    setIsOpeningNavigation(true);
    try {
      const result = await openStopNavigation({
        linking: Linking,
        platform: Platform.OS,
        stop: currentStop,
      });
      setStopNavigationResults((current) => ({ ...current, [currentStop.deliveryStopId]: result }));
      setMessage(result.message);
    } finally {
      setIsOpeningNavigation(false);
    }
  }

  function handleAnnounceCurrentTip() {
    const text = getNavigationTip({ company: currentCompany, isCompanyStep, stop: currentStop });
    Speech.stop();
    Speech.speak(text, { language: 'ko-KR', rate: 0.94 });
    setMessage(`음성 안내: ${text}`);
  }

  function handleArrivedAtStep() {
    if (selectedRoute === null) {
      return;
    }

    if (isCompanyStep) {
      setNavigationStepIndex(1);
      setMessage('회사 픽업을 확인했습니다. 첫 번째 배송지로 이동하세요.');
      return;
    }

    setScreen('stopProof');
    setMessage('도착지 근방입니다. 사진 증빙을 남긴 뒤 배송완료를 기록하세요.');
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
      setMessage('배송완료 사진은 필수입니다. 먼저 사진을 촬영하거나 선택해 주세요.');
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

      const nextCompletedStopIds = [...new Set([...completedStopIds, currentStop.deliveryStopId])];
      setCompletedStopIds(nextCompletedStopIds);

      const isLastStop = selectedRoute.stops.every((stop) => nextCompletedStopIds.includes(stop.deliveryStopId));
      if (isLastStop) {
        await finishRoute(selectedRoute);
        return;
      }

      setNavigationStepIndex((index) => index + 1);
      setScreen('navigation');
      setMessage('배송완료가 기록됐습니다. 다음 배송지로 이동하세요.');
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
      setScreen('routes');
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
    setStopNavigationResults({});
    setCompletedStopIds([]);
    setNavigationStepIndex(COMPANY_STEP_INDEX);
    setSelectedRouteId(null);
  }

  function refreshOfflineQueueCount() {
    setOfflineQueueCount(offlineSubmissionQueue?.listPending().length ?? 0);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Clever Driver</Text>
          <Text style={styles.title}>{getScreenTitle(screen)}</Text>
          <Text style={styles.subtitle}>배송원용 MVP: 전화번호 확인, 라우트 선택, 순서 배송, 도착지 증빙.</Text>
        </View>

        <ProgressSteps activeScreen={screen} />

        {message !== null ? <Text style={styles.message}>{message}</Text> : null}

        {screen === 'login' ? (
          <LoginScreen
            acceptedLocation={acceptedLocation}
            acceptedPrivacy={acceptedPrivacy}
            driverName={driverName}
            isLoggingIn={isLoggingIn}
            onAcceptedLocationChange={setAcceptedLocation}
            onAcceptedPrivacyChange={setAcceptedPrivacy}
            onDriverNameChange={setDriverName}
            onPhoneChange={setPhoneE164}
            onSubmit={handleLoginAndLoadRoutes}
            phoneE164={phoneE164}
          />
        ) : null}

        {screen === 'routes' ? (
          <RouteListScreen
            driverName={driverName}
            isStartingRoute={isStartingRoute}
            onOpenRouteDetail={handleOpenRouteDetail}
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
            continuousLocationResult={continuousLocationResult}
            deliveryFinishResult={deliveryFinishResult}
            isFinishingRoute={isFinishingRoute}
            isStartingRoute={isStartingRoute}
            onBack={() => setScreen('routes')}
            onFinishRoute={handleManualFinishRoute}
            onStartRoute={() => handleStartRoute(selectedRoute.id)}
            route={selectedRoute}
            routeStartedEventResult={routeStartedEventResult}
            routeStatus={routeStatus}
          />
        ) : null}

        {screen === 'navigation' && selectedRoute !== null ? (
          <NavigationScreen
            company={currentCompany}
            currentStepIndex={navigationStepIndex}
            isCompanyStep={isCompanyStep}
            isOpeningNavigation={isOpeningNavigation}
            onAnnounceTip={handleAnnounceCurrentTip}
            onArrived={handleArrivedAtStep}
            onBackToRoute={() => setScreen('routeDetail')}
            onOpenNavigation={handleOpenCurrentNavigation}
            route={selectedRoute}
            stop={currentStop}
            navigationResult={currentStop === null ? undefined : stopNavigationResults[currentStop.deliveryStopId]}
          />
        ) : null}

        {screen === 'stopProof' && currentStop !== null ? (
          <StopProofScreen
            draft={getProofDraft(proofDrafts[currentStop.deliveryStopId])}
            isCapturingPhoto={isCapturingPhoto}
            isCompletingStop={isCompletingStop || isFinishingRoute}
            onBack={() => setScreen('navigation')}
            onCapturePhoto={handleCapturePhoto}
            onCompleteStop={handleCompleteCurrentStop}
            onDraftChange={updateCurrentStopDraft}
            photoResult={proofPhotoResults[currentStop.deliveryStopId]}
            proofResult={stopProofResults[currentStop.deliveryStopId]}
            mediaResult={proofMediaResults[currentStop.deliveryStopId]}
            stop={currentStop}
          />
        ) : null}

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>상태</Text>
          <InfoRow label="API" value={runtimeConfig.mode === 'live' ? runtimeConfig.deliveryServerBaseUrl : 'local mock'} />
          <InfoRow label="오프라인 큐" value={`${offlineQueueCount}건`} />
          <InfoRow label="현재 탭" value={selectedTab} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoginScreen({
  acceptedLocation,
  acceptedPrivacy,
  driverName,
  isLoggingIn,
  onAcceptedLocationChange,
  onAcceptedPrivacyChange,
  onDriverNameChange,
  onPhoneChange,
  onSubmit,
  phoneE164,
}: {
  acceptedLocation: boolean;
  acceptedPrivacy: boolean;
  driverName: string;
  isLoggingIn: boolean;
  onAcceptedLocationChange(value: boolean): void;
  onAcceptedPrivacyChange(value: boolean): void;
  onDriverNameChange(value: string): void;
  onPhoneChange(value: string): void;
  onSubmit(): void;
  phoneE164: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>로그인</Text>
      <Text style={styles.bodyText}>서버에 등록된 전화번호로 배정된 라우트를 확인합니다.</Text>
      <LabeledInput keyboardType="phone-pad" label="전화번호" onChangeText={onPhoneChange} placeholder="+821012345678" value={phoneE164} />
      <LabeledInput label="이름" onChangeText={onDriverNameChange} placeholder="배송원 이름" value={driverName} />
      <ConsentRow label="개인정보활용에 동의합니다" onValueChange={onAcceptedPrivacyChange} value={acceptedPrivacy} />
      <ConsentRow label="위치기반서비스에 동의합니다" onValueChange={onAcceptedLocationChange} value={acceptedLocation} />
      <PrimaryButton disabled={isLoggingIn} label="전화번호 확인" loading={isLoggingIn} onPress={onSubmit} />
    </View>
  );
}

function RouteListScreen({
  driverName,
  isStartingRoute,
  onOpenRouteDetail,
  onSelectTab,
  onStartRoute,
  routeSessions,
  routeStatus,
  selectedRouteId,
  selectedTab,
  tabs,
}: {
  driverName: string;
  isStartingRoute: boolean;
  onOpenRouteDetail(routeId: string): void;
  onSelectTab(tab: RouteTabId): void;
  onStartRoute(routeId: string): void;
  routeSessions: RouteSession[];
  routeStatus: RouteStatus;
  selectedRouteId: string | null;
  selectedTab: RouteTabId;
  tabs: ReturnType<typeof getMvpRouteTabs>;
}) {
  const visibleRouteSessions = routeSessions.filter((session) => getRouteSessionStatus(session.route.id, selectedRouteId, routeStatus) === selectedTab);
  return (
    <View>
      <Text style={styles.sectionHeading}>{driverName}님의 라우트</Text>
      <View style={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable
            accessibilityRole="button"
            key={tab.id}
            onPress={() => onSelectTab(tab.id)}
            style={[styles.tab, selectedTab === tab.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, selectedTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      {visibleRouteSessions.length > 0 ? (
        visibleRouteSessions.map((session) => {
          const sessionStatus = getRouteSessionStatus(session.route.id, selectedRouteId, routeStatus);
          return (
            <View key={session.route.id} style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{session.route.name}</Text>
                <Text style={styles.badge}>{formatRouteStatus(sessionStatus)}</Text>
              </View>
              <InfoRow label="회사" value={session.companyGuidance.companyDisplayName} />
              <InfoRow label="날짜" value={session.route.deliveryDate} />
              <InfoRow label="지역" value={getRouteRegion(session.route)} />
              <InfoRow label="경로" value={`${session.route.stops.length}개 배송지`} />
              {selectedRouteId === session.route.id ? <Text style={styles.successText}>선택된 라우트입니다.</Text> : null}
              {sessionStatus === 'active' ? (
                <PrimaryButton label="배송 계속하기" onPress={() => onOpenRouteDetail(session.route.id)} />
              ) : sessionStatus === 'completed' ? (
                <PrimaryButton label="완료 내역 보기" onPress={() => onOpenRouteDetail(session.route.id)} />
              ) : (
                <View style={styles.buttonRow}>
                  <SecondaryButton label="상세 보기" onPress={() => onOpenRouteDetail(session.route.id)} />
                  <PrimaryButton disabled={isStartingRoute} label="배송 시작" loading={isStartingRoute} onPress={() => onStartRoute(session.route.id)} />
                </View>
              )}
            </View>
          );
        })
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>표시할 라우트가 없습니다</Text>
          <Text style={styles.bodyText}>배정된 라우트가 없거나 다른 탭에서 확인할 수 있습니다.</Text>
        </View>
      )}
    </View>
  );
}

function RouteDetailScreen({
  allStopsCompleted,
  company,
  completedStopIds,
  continuousLocationResult,
  deliveryFinishResult,
  isFinishingRoute,
  isStartingRoute,
  onBack,
  onFinishRoute,
  onStartRoute,
  route,
  routeStartedEventResult,
  routeStatus,
}: {
  allStopsCompleted: boolean;
  company: RouteAccessCompanyGuidance | null;
  completedStopIds: string[];
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  deliveryFinishResult: DeliveryFinishResult | null;
  isFinishingRoute: boolean;
  isStartingRoute: boolean;
  onBack(): void;
  onFinishRoute(): void;
  onStartRoute(): void;
  route: AssignedRoute;
  routeStartedEventResult: RouteStartedRecordResult | null;
  routeStatus: RouteStatus;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>라우트 상세</Text>
      <InfoRow label="회사" value={company?.companyDisplayName ?? route.shopDomain} />
      <InfoRow label="회사 도메인" value={route.shopDomain} />
      <InfoRow label="날짜" value={route.deliveryDate} />
      <InfoRow label="지역" value={getRouteRegion(route)} />
      <InfoRow label="상태" value={formatRouteStatus(routeStatus)} />
      {company?.pickupGuidance !== null && company?.pickupGuidance !== undefined ? (
        <Text style={styles.tipText}>회사 안내: {company.pickupGuidance}</Text>
      ) : null}
      {company?.driverInstructions.map((instruction) => <Text key={instruction} style={styles.tipText}>• {instruction}</Text>)}
      <View style={styles.stopList}>
        <Text style={styles.subheading}>정해진 순서</Text>
        <RouteStepRow done={routeStatus !== 'upcoming'} label="회사" meta="픽업/회사 안내 확인" />
        {route.stops.map((stop) => (
          <RouteStepRow
            done={completedStopIds.includes(stop.deliveryStopId)}
            key={stop.deliveryStopId}
            label={`${stop.sequence}. ${stop.orderName}`}
            meta={formatStopAddress(stop)}
          />
        ))}
      </View>
      {routeStartedEventResult?.kind === 'recorded' ? <Text style={styles.successText}>배송 시작 이벤트 기록됨</Text> : null}
      {continuousLocationResult !== null ? <Text style={styles.successText}>{formatContinuousLocationResult(continuousLocationResult)}</Text> : null}
      {deliveryFinishResult?.flowState === 'delivery_finished' ? <Text style={styles.successText}>{deliveryFinishResult.message}</Text> : null}
      <View style={styles.buttonRow}>
        <SecondaryButton label="목록" onPress={onBack} />
        {routeStatus === 'upcoming' ? (
          <PrimaryButton disabled={isStartingRoute} label="배송 시작" loading={isStartingRoute} onPress={onStartRoute} />
        ) : routeStatus === 'active' && allStopsCompleted ? (
          <PrimaryButton disabled={isFinishingRoute} label="라우트 완료" loading={isFinishingRoute} onPress={onFinishRoute} />
        ) : null}
      </View>
    </View>
  );
}

function NavigationScreen({
  company,
  currentStepIndex,
  isCompanyStep,
  isOpeningNavigation,
  navigationResult,
  onAnnounceTip,
  onArrived,
  onBackToRoute,
  onOpenNavigation,
  route,
  stop,
}: {
  company: RouteAccessCompanyGuidance | null;
  currentStepIndex: number;
  isCompanyStep: boolean;
  isOpeningNavigation: boolean;
  navigationResult?: StopNavigationResult;
  onAnnounceTip(): void;
  onArrived(): void;
  onBackToRoute(): void;
  onOpenNavigation(): void;
  route: AssignedRoute;
  stop: AssignedRouteStop | null;
}) {
  const totalSteps = route.stops.length + 1;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>내비게이션</Text>
      <Text style={styles.badge}>순서 {currentStepIndex + 1} / {totalSteps}</Text>
      {isCompanyStep ? (
        <View>
          <Text style={styles.destinationTitle}>회사: {company?.companyDisplayName ?? route.shopDomain}</Text>
          <Text style={styles.bodyText}>{company?.pickupGuidance ?? '회사 픽업 안내를 확인하세요.'}</Text>
        </View>
      ) : stop !== null ? (
        <View>
          <Text style={styles.destinationTitle}>{stop.sequence}. {stop.orderName}</Text>
          <Text style={styles.bodyText}>{stop.recipientName ?? '수령인 정보 없음'}</Text>
          <Text style={styles.bodyText}>{formatStopAddress(stop)}</Text>
          {navigationResult !== undefined ? <Text style={styles.successText}>{navigationResult.message}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.tipText}>지역 팁: {getNavigationTip({ company, isCompanyStep, stop })}</Text>
      <View style={styles.buttonColumn}>
        <SecondaryButton label="지역 팁 음성 안내" onPress={onAnnounceTip} />
        {!isCompanyStep ? <SecondaryButton disabled={isOpeningNavigation} label="내비게이션 열기" loading={isOpeningNavigation} onPress={onOpenNavigation} /> : null}
        <PrimaryButton label={isCompanyStep ? '회사 확인, 다음 배송지' : '도착, 증빙하기'} onPress={onArrived} />
        <SecondaryButton label="라우트 상세" onPress={onBackToRoute} />
      </View>
    </View>
  );
}

function StopProofScreen({
  draft,
  isCapturingPhoto,
  isCompletingStop,
  mediaResult,
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
  onBack(): void;
  onCapturePhoto(source: ProofPhotoCaptureSource): void;
  onCompleteStop(): void;
  onDraftChange(patch: Partial<StopProofDraft>): void;
  photoResult?: ProofPhotoCaptureResult;
  proofResult?: StopProofEventResult;
  stop: AssignedRouteStop;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>도착지 배송완료 증빙</Text>
      <Text style={styles.destinationTitle}>{stop.sequence}. {stop.orderName}</Text>
      <Text style={styles.bodyText}>{formatStopAddress(stop)}</Text>
      <Text style={styles.requiredText}>필수: 배송완료 사진</Text>
      <View style={styles.buttonRow}>
        <SecondaryButton disabled={isCapturingPhoto} label="사진 촬영" loading={isCapturingPhoto} onPress={() => onCapturePhoto('camera')} />
        <SecondaryButton disabled={isCapturingPhoto} label="앨범 선택" loading={isCapturingPhoto} onPress={() => onCapturePhoto('library')} />
      </View>
      {photoResult !== undefined ? <Text style={photoResult.kind === 'captured' ? styles.successText : styles.warningText}>{formatPhotoCaptureResult(photoResult)}</Text> : null}
      {mediaResult !== undefined ? <Text style={mediaResult.kind === 'uploaded' ? styles.successText : styles.warningText}>{formatMediaUploadResult(mediaResult)}</Text> : null}
      <LabeledInput
        label="금일 배송시 특이사항 (선택)"
        multiline
        onChangeText={(value) => onDraftChange({ todayNote: value })}
        placeholder="예: 고객 부재, 경비실 전달 등"
        value={draft.todayNote}
      />
      <LabeledInput
        label="배송지의 특성 팁 (선택)"
        multiline
        onChangeText={(value) => onDraftChange({ locationTip: value })}
        placeholder="예: 후문 이용, 주차 위치, 엘리베이터 위치 등"
        value={draft.locationTip}
      />
      {proofResult !== undefined ? <Text style={proofResult.kind === 'recorded' ? styles.successText : styles.warningText}>{formatStopProofResult(proofResult)}</Text> : null}
      <View style={styles.buttonColumn}>
        <PrimaryButton disabled={isCompletingStop} label="배송완료 기록" loading={isCompletingStop} onPress={onCompleteStop} />
        <SecondaryButton label="내비게이션으로 돌아가기" onPress={onBack} />
      </View>
    </View>
  );
}

function ProgressSteps({ activeScreen }: { activeScreen: AppScreen }) {
  const steps: { id: AppScreen; label: string }[] = [
    { id: 'login', label: '로그인' },
    { id: 'routes', label: '내용' },
    { id: 'navigation', label: '내비게이션' },
    { id: 'stopProof', label: '증빙' },
  ];
  return (
    <View style={styles.progressRow}>
      {steps.map((step) => (
        <Text key={step.id} style={[styles.progressItem, step.id === activeScreen && styles.progressItemActive]}>{step.label}</Text>
      ))}
    </View>
  );
}

function LabeledInput({
  keyboardType,
  label,
  multiline,
  onChangeText,
  placeholder,
  value,
}: {
  keyboardType?: 'default' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        style={[styles.input, multiline === true && styles.multilineInput]}
        value={value}
      />
    </View>
  );
}

function ConsentRow({ label, onValueChange, value }: { label: string; onValueChange(value: boolean): void; value: boolean }) {
  return (
    <View style={styles.consentRow}>
      <Text style={styles.consentText}>{label}</Text>
      <Switch onValueChange={onValueChange} value={value} />
    </View>
  );
}

function PrimaryButton({ disabled, label, loading, onPress }: { disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function SecondaryButton({ disabled, label, loading, onPress }: { disabled?: boolean; label: string; loading?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.secondaryButton, disabled === true && styles.buttonDisabled]}>
      {loading === true ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.secondaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function RouteStepRow({ done, label, meta }: { done: boolean; label: string; meta: string }) {
  return (
    <View style={styles.stepRow}>
      <Text style={[styles.stepDot, done && styles.stepDotDone]}>{done ? '✓' : '•'}</Text>
      <View style={styles.stepTextColumn}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={styles.stepMeta}>{meta}</Text>
      </View>
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

function getRouteSessionStatus(routeId: string, selectedRouteId: string | null, selectedRouteStatus: RouteStatus): RouteStatus {
  return routeId === selectedRouteId ? selectedRouteStatus : 'upcoming';
}

function formatRouteAccessProblem(result: RouteAccessSubmissionResult): string {
  if (result.kind === 'validation_error' || result.kind === 'denied' || result.kind === 'multiple_matches') {
    return result.message;
  }

  return '라우트 확인이 필요합니다.';
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
      return '배송중';
    case 'completed':
      return '배송완료';
    case 'upcoming':
      return '배송전';
  }
}

function getScreenTitle(screen: AppScreen): string {
  switch (screen) {
    case 'login':
      return '로그인';
    case 'routes':
      return '내용';
    case 'routeDetail':
      return '라우트 상세';
    case 'navigation':
      return '내비게이션';
    case 'stopProof':
      return '도착지 처리';
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

function getNavigationTip(input: {
  company: RouteAccessCompanyGuidance | null;
  isCompanyStep: boolean;
  stop: AssignedRouteStop | null;
}): string {
  if (input.isCompanyStep) {
    return input.company?.pickupGuidance ?? '회사 픽업 지점에서 담당자 안내를 확인하세요.';
  }

  if (input.stop === null) {
    return '다음 배송지를 확인하세요.';
  }

  const area = input.stop.address.city || input.stop.address.province;
  return `${area} 지역입니다. 건물 출입구와 주차 가능 위치를 먼저 확인하고, 특이사항은 배송완료 화면에 남겨 주세요.`;
}

function getProofDraft(draft?: StopProofDraft): StopProofDraft {
  return {
    locationTip: draft?.locationTip ?? '',
    todayNote: draft?.todayNote ?? '',
  };
}

function formatStopProofNote(draft: StopProofDraft): string {
  return [
    draft.todayNote.trim().length > 0 ? `금일 특이사항: ${draft.todayNote.trim()}` : null,
    draft.locationTip.trim().length > 0 ? `배송지 팁: ${draft.locationTip.trim()}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n') || '배송완료 사진 증빙.';
}

function formatPhotoResult(captureResult: ProofPhotoCaptureResult, uploadResult: ProofMediaUploadResult): string {
  return `${formatPhotoCaptureResult(captureResult)} ${formatMediaUploadResult(uploadResult)}`.trim();
}

function formatPhotoCaptureResult(result: ProofPhotoCaptureResult): string {
  if (result.kind === 'captured') {
    return `사진 첨부됨: ${result.source}`;
  }

  if (result.kind === 'cancelled') {
    return '사진 선택이 취소됐습니다.';
  }

  return result.message;
}

function formatMediaUploadResult(result: ProofMediaUploadResult): string {
  if (result.kind === 'uploaded') {
    return `업로드됨: ${result.media.mediaId}`;
  }

  return result.message;
}

function formatStopProofResult(result: StopProofEventResult): string {
  if (result.kind === 'recorded') {
    return `배송완료 기록됨: ${result.eventId}`;
  }

  if (result.kind === 'queued') {
    return `오프라인 큐에 저장됨: ${result.queueItemId}`;
  }

  return result.message;
}

function formatContinuousLocationResult(result: ContinuousLocationStreamStartResult | ContinuousLocationStopResult): string {
  if (result.kind === 'streaming') {
    return '위치 추적 실행 중';
  }

  if (result.kind === 'stopped') {
    return '위치 추적 중지됨';
  }

  return result.message;
}

function getFileNameFromUri(uri: string, deliveryStopId: string): string {
  const fileName = uri.split('/').pop()?.trim();
  return fileName === undefined || fileName === '' ? `${deliveryStopId}.jpg` : fileName;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  container: {
    gap: 16,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    gap: 8,
    paddingTop: 12,
  },
  kicker: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#0f172a',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 22,
  },
  progressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  progressItem: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  progressItemActive: {
    backgroundColor: '#0f172a',
    color: '#ffffff',
  },
  message: {
    backgroundColor: '#e0f2fe',
    borderColor: '#7dd3fc',
    borderRadius: 16,
    borderWidth: 1,
    color: '#075985',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 14,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  cardHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: '#0f172a',
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
  },
  sectionHeading: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  subheading: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  bodyText: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 22,
  },
  destinationTitle: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    color: '#166534',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    flex: 1,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: '#2563eb',
  },
  tabText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
    borderRadius: 14,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  consentRow: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  consentText: {
    color: '#0f172a',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 16,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    borderRadius: 16,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonColumn: {
    gap: 10,
  },
  infoRow: {
    borderBottomColor: '#e2e8f0',
    borderBottomWidth: 1,
    gap: 4,
    paddingBottom: 10,
  },
  infoLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  infoValue: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  stopList: {
    gap: 10,
  },
  stepRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  stepDot: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    color: '#475569',
    fontSize: 16,
    fontWeight: '900',
    height: 28,
    lineHeight: 28,
    overflow: 'hidden',
    textAlign: 'center',
    width: 28,
  },
  stepDotDone: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
  },
  stepTextColumn: {
    flex: 1,
    gap: 2,
  },
  stepLabel: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
  stepMeta: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  tipText: {
    backgroundColor: '#fef9c3',
    borderRadius: 14,
    color: '#713f12',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 12,
  },
  requiredText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '800',
  },
  successText: {
    color: '#047857',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  warningText: {
    color: '#b45309',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  emptyTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
  },
  footerCard: {
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    gap: 10,
    padding: 16,
  },
  footerTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
});
