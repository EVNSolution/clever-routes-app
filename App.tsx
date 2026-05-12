import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  loadAssignedRouteAfterConsent,
  sampleAssignedRoute,
  type AssignedRouteLoadResult,
  type AssignedRouteLookupResult,
  type AssignedRouteService,
  type AssignedRouteStop,
} from './src/assignedRoute';
import {
  startDeliveryWithForegroundPermission,
  type DeliveryStartResult,
} from './src/deliveryStart';
import {
  finishDeliveryAfterActive,
  type DeliveryFinishResult,
} from './src/deliveryFinish';
import {
  createMockDriverEventService,
  recordRouteStartedAfterDeliveryStart,
  type DriverEventService,
  type RouteStartedRecordResult,
} from './src/driverEvents';
import {
  recordForegroundLocationUpdateAfterDeliveryStart,
  type ForegroundLocationUpdateResult,
} from './src/foregroundLocationEvent';
import {
  recordContinuousLocationUpdateBatch,
  startContinuousLocationUpdatesAfterDeliveryStart,
  stopContinuousLocationUpdates,
  type ContinuousLocationStopResult,
  type ContinuousLocationStreamStartResult,
} from './src/continuousLocationStream';
import {
  recordStopProofEventAfterDeliveryStart,
  type StopProofAction,
  type StopProofEventResult,
  type StopProofFailureReason,
} from './src/stopProofEvents';
import {
  captureProofPhoto,
  type ProofPhotoCaptureResult,
  type ProofPhotoCaptureSource,
} from './src/proofPhotoCapture';
import {
  uploadCapturedProofPhoto,
  createMockProofMediaUploadService,
  type ProofMediaUploadResult,
  type ProofMediaUploadService,
} from './src/proofMediaUpload';
import {
  captureProofSignature,
  type ProofSignatureCaptureResult,
} from './src/proofSignatureCapture';
import {
  captureProofBarcode,
  type ProofBarcodeCaptureResult,
} from './src/proofBarcodeCapture';
import {
  createInMemoryOfflineSubmissionQueue,
  createPersistentOfflineSubmissionQueue,
  retryOfflineSubmissions,
  type OfflineSubmissionQueue,
  type OfflineSubmissionRetryResult,
} from './src/offlineSubmissionQueue';
import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  type DriverFlowState,
} from './src/driverFlow';
import { createDriverApiClientsFromRouteAccess } from './src/driverApiClients';
import { type DriverAccessRestoreResult } from './src/driverAccessTokenStore';
import { createExpoSecureDriverAccessTokenStore } from './src/expoSecureDriverAccessTokenStore';
import { createExpoForegroundLocationPermissionService } from './src/expoLocationPermissionService';
import { createExpoForegroundLocationSnapshotService } from './src/expoForegroundLocationSnapshotService';
import {
  createExpoContinuousLocationStreamService,
  registerContinuousLocationTaskHandler,
} from './src/expoContinuousLocationStreamService';
import { createExpoProofPhotoCaptureService } from './src/expoProofPhotoCaptureService';
import { createExpoProofBarcodeCaptureService } from './src/expoProofBarcodeCaptureService';
import { createExpoOfflineSubmissionQueueStorage } from './src/expoOfflineSubmissionQueueStorage';
import {
  createDriverRuntimeServices,
  readDriverRuntimeConfig,
} from './src/driverRuntimeConfig';
import {
  CONSENT_COPY_VERSIONS,
  createMockDriverConsentService,
  submitDriverConsent,
  type DriverConsentService,
  type DriverConsentSubmissionResult,
} from './src/driverConsent';
import {
  createMockRouteAccessService,
  sampleInvitedRouteAccess,
  submitRouteAccess,
  type RouteAccessLookupResult,
  type RouteAccessSubmissionResult,
} from './src/routeAccess';

const SAMPLE_PHONE_E164 = '+14165550123';

type MockMode = RouteAccessLookupResult['status'];
type ConsentMockMode = 'success' | 'failure';
type AssignedRouteMockMode = 'assigned' | 'failure' | 'none';
type OfflineQueueRestoreStatus = 'failed' | 'loading' | 'ready';
type StopProofDraft = {
  failureReason: StopProofFailureReason;
  note: string;
  photoUri: string;
  signaturePointCount: number;
  signerName: string;
};

const STOP_PROOF_FAILURE_REASONS: StopProofFailureReason[] = ['CUSTOMER_UNAVAILABLE', 'DAMAGED', 'INACCESSIBLE', 'OTHER'];

export default function App() {
  const [routeContext, setRouteContext] = useState(sampleInvitedRouteAccess.routeAccess.routeContext);
  const [phoneE164, setPhoneE164] = useState(SAMPLE_PHONE_E164);
  const [mockMode, setMockMode] = useState<MockMode>('INVITED');
  const [consentMockMode, setConsentMockMode] = useState<ConsentMockMode>('success');
  const [assignedRouteMockMode, setAssignedRouteMockMode] = useState<AssignedRouteMockMode>('assigned');
  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [consentSubmission, setConsentSubmission] = useState<DriverConsentSubmissionResult | null>(null);
  const [assignedRouteSubmission, setAssignedRouteSubmission] = useState<AssignedRouteLoadResult | null>(null);
  const [deliveryStartResult, setDeliveryStartResult] = useState<DeliveryStartResult | null>(null);
  const [deliveryFinishResult, setDeliveryFinishResult] = useState<DeliveryFinishResult | null>(null);
  const [routeStartedEventResult, setRouteStartedEventResult] = useState<RouteStartedRecordResult | null>(null);
  const [locationUpdateResult, setLocationUpdateResult] = useState<ForegroundLocationUpdateResult | null>(null);
  const [continuousLocationResult, setContinuousLocationResult] = useState<ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null>(null);
  const [stopProofResults, setStopProofResults] = useState<Record<string, StopProofEventResult>>({});
  const [stopProofDrafts, setStopProofDrafts] = useState<Record<string, StopProofDraft>>({});
  const [proofPhotoCaptureResults, setProofPhotoCaptureResults] = useState<Record<string, ProofPhotoCaptureResult>>({});
  const [proofMediaUploadResults, setProofMediaUploadResults] = useState<Record<string, ProofMediaUploadResult>>({});
  const [proofSignatureCaptureResults, setProofSignatureCaptureResults] = useState<Record<string, ProofSignatureCaptureResult>>({});
  const [proofBarcodeCaptureResults, setProofBarcodeCaptureResults] = useState<Record<string, ProofBarcodeCaptureResult>>({});
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineQueueRetryResult, setOfflineQueueRetryResult] = useState<OfflineSubmissionRetryResult | null>(null);
  const [offlineQueueRestoreStatus, setOfflineQueueRestoreStatus] = useState<OfflineQueueRestoreStatus>('loading');
  const [offlineSubmissionQueue, setOfflineSubmissionQueue] = useState<OfflineSubmissionQueue>(() => createInMemoryOfflineSubmissionQueue());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecordingConsent, setIsRecordingConsent] = useState(false);
  const [isLoadingAssignedRoute, setIsLoadingAssignedRoute] = useState(false);
  const [isStartingDelivery, setIsStartingDelivery] = useState(false);
  const [isRecordingRouteStarted, setIsRecordingRouteStarted] = useState(false);
  const [isRecordingLocationUpdate, setIsRecordingLocationUpdate] = useState(false);
  const [isStartingContinuousLocation, setIsStartingContinuousLocation] = useState(false);
  const [isStoppingContinuousLocation, setIsStoppingContinuousLocation] = useState(false);
  const [isFinishingDelivery, setIsFinishingDelivery] = useState(false);
  const [recordingStopProofId, setRecordingStopProofId] = useState<string | null>(null);
  const [capturingProofPhotoId, setCapturingProofPhotoId] = useState<string | null>(null);
  const [uploadingProofMediaId, setUploadingProofMediaId] = useState<string | null>(null);
  const [capturingProofSignatureId, setCapturingProofSignatureId] = useState<string | null>(null);
  const [capturingProofBarcodeId, setCapturingProofBarcodeId] = useState<string | null>(null);
  const [isRetryingOfflineQueue, setIsRetryingOfflineQueue] = useState(false);
  const [driverAccessRestoreStatus, setDriverAccessRestoreStatus] = useState<DriverAccessRestoreResult['kind']>('missing');

  const driverAccessTokenStore = useMemo(() => createExpoSecureDriverAccessTokenStore(), []);
  const foregroundLocationPermissionService = useMemo(() => createExpoForegroundLocationPermissionService(), []);
  const foregroundLocationSnapshotService = useMemo(() => createExpoForegroundLocationSnapshotService(), []);
  const continuousLocationStreamService = useMemo(() => createExpoContinuousLocationStreamService(), []);
  const proofPhotoCaptureService = useMemo(() => createExpoProofPhotoCaptureService(), []);
  const proofBarcodeCaptureService = useMemo(() => createExpoProofBarcodeCaptureService(), []);
  const proofMediaUploadService = useMemo(() => createMockProofMediaUploadService(), []);
  const offlineSubmissionQueueStorage = useMemo(() => createExpoOfflineSubmissionQueueStorage(), []);

  const runtimeConfig = useMemo(
    () => readDriverRuntimeConfig({
      EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL,
    }),
    [],
  );

  useEffect(() => {
    let isMounted = true;
    createPersistentOfflineSubmissionQueue({ storage: offlineSubmissionQueueStorage })
      .then((queue) => {
        if (isMounted) {
          setOfflineSubmissionQueue(queue);
          setOfflineQueueCount(queue.listPending().length);
          setOfflineQueueRestoreStatus('ready');
        }
      })
      .catch(() => {
        if (isMounted) {
          setOfflineQueueRestoreStatus('failed');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [offlineSubmissionQueueStorage]);

  useEffect(() => {
    let isMounted = true;
    driverAccessTokenStore.loadActiveDriverAccess()
      .then((result) => {
        if (isMounted) {
          setDriverAccessRestoreStatus(result.kind);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDriverAccessRestoreStatus('invalid');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [driverAccessTokenStore]);

  const routeAccessService = useMemo(() => {
    if (runtimeConfig.mode === 'live') {
      return createDriverRuntimeServices({ config: runtimeConfig }).routeAccessService;
    }

    const result: RouteAccessLookupResult =
      mockMode === 'INVITED' ? sampleInvitedRouteAccess : { status: mockMode };
    return createMockRouteAccessService(result);
  }, [mockMode, runtimeConfig]);

  const driverConsentService = useMemo<DriverConsentService>(() => {
    if (consentMockMode === 'failure') {
      return {
        recordDriverConsents: async () => {
          throw new Error('Local consent mock failure');
        },
      };
    }

    return createMockDriverConsentService();
  }, [consentMockMode]);

  const driverEventService = useMemo<DriverEventService>(() => createMockDriverEventService(), []);

  const assignedRouteService = useMemo<AssignedRouteService>(() => {
    if (assignedRouteMockMode === 'failure') {
      return {
        getAssignedRoute: async () => {
          throw new Error('Local assigned route mock failure');
        },
      };
    }

    const result: AssignedRouteLookupResult =
      assignedRouteMockMode === 'none'
        ? { status: 'NO_ASSIGNED_ROUTE' }
        : { status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute };

    return createMockAssignedRouteService(result);
  }, [assignedRouteMockMode]);

  const currentFlowState = getCurrentFlowState(
    submission,
    consentSubmission,
    assignedRouteSubmission,
    deliveryStartResult,
    deliveryFinishResult,
  );
  const canRevealRoute = canRevealRouteDetails(currentFlowState);
  const canStartDelivery = canEnterDeliveryActive({
    state: currentFlowState,
    hasLocationPermission: deliveryStartResult?.kind === 'delivery_active',
  });

  const activeRoutePlanId = assignedRouteSubmission?.kind === 'route_ready' ? assignedRouteSubmission.route.id : null;

  useEffect(() => {
    if (deliveryStartResult?.kind !== 'delivery_active' || deliveryFinishResult?.flowState === 'delivery_finished') {
      registerContinuousLocationTaskHandler(null);
      return;
    }

    registerContinuousLocationTaskHandler(async (locations) => {
      await recordContinuousLocationUpdateBatch({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          driverEventService,
          runtimeConfig,
          submission,
        }),
        locations,
        offlineQueue: offlineSubmissionQueue,
        routePlanId: activeRoutePlanId,
      });
      setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
    });

    return () => {
      registerContinuousLocationTaskHandler(null);
    };
  }, [activeRoutePlanId, deliveryFinishResult, deliveryStartResult, driverEventService, offlineSubmissionQueue, runtimeConfig, submission]);

  async function handleLookup() {
    setIsSubmitting(true);
    setConsentSubmission(null);
    setAssignedRouteSubmission(null);
    setDeliveryStartResult(null);
    setDeliveryFinishResult(null);
    setRouteStartedEventResult(null);
    setLocationUpdateResult(null);
    setContinuousLocationResult(null);
    setStopProofResults({});
    setStopProofDrafts({});
    setProofPhotoCaptureResults({});
    setProofMediaUploadResults({});
    setProofSignatureCaptureResults({});
    setProofBarcodeCaptureResults({});
    try {
      const result = await submitRouteAccess({ routeContext, phoneE164 }, routeAccessService);
      setSubmission(result);
      if (result.kind === 'company_guidance') {
        await driverAccessTokenStore.saveFromInvitedRouteAccess(toInvitedRouteAccess(result));
        setDriverAccessRestoreStatus('active');
      } else if (result.kind === 'denied') {
        await driverAccessTokenStore.clear();
        setDriverAccessRestoreStatus('missing');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordConsent(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']) {
    setIsRecordingConsent(true);
    setAssignedRouteSubmission(null);
    setDeliveryFinishResult(null);
    try {
      setConsentSubmission(await submitDriverConsent(
        {
          appContext: { appVersion: '0.1.0' },
          deviceContext: { platform: Platform.OS },
          routeContext: routeAccess.routeContext,
        },
        getDriverConsentServiceForCurrentSubmission({
          driverConsentService,
          runtimeConfig,
          submission,
        }),
      ));
    } finally {
      setIsRecordingConsent(false);
    }
  }

  async function handleLoadAssignedRoute(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']) {
    setIsLoadingAssignedRoute(true);
    setDeliveryStartResult(null);
    setDeliveryFinishResult(null);
    try {
      setAssignedRouteSubmission(await loadAssignedRouteAfterConsent(
        {
          consentState: consentSubmission?.flowState === 'consent_recorded' ? 'consent_recorded' : 'consent_required',
          routeContext: routeAccess.routeContext,
        },
        getAssignedRouteServiceForCurrentSubmission({
          assignedRouteService,
          runtimeConfig,
          submission,
        }),
      ));
    } finally {
      setIsLoadingAssignedRoute(false);
    }
  }


  async function handleStartDelivery() {
    setIsStartingDelivery(true);
    try {
      const deliveryStart = await startDeliveryWithForegroundPermission({
        flowState: currentFlowState,
        permissionService: foregroundLocationPermissionService,
      });
      setDeliveryStartResult(deliveryStart);
      setDeliveryFinishResult(null);
      setRouteStartedEventResult(null);
      setContinuousLocationResult(null);

      if (deliveryStart.kind === 'delivery_active') {
        setIsRecordingRouteStarted(true);
        try {
          const routeStartedResult = await recordRouteStartedAfterDeliveryStart({
            deliveryStart,
            driverEventService: getDriverEventServiceForCurrentSubmission({
              driverEventService,
              runtimeConfig,
              submission,
            }),
            offlineQueue: offlineSubmissionQueue,
            routePlanId: activeRoutePlanId,
          });
          setRouteStartedEventResult(routeStartedResult);
          setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
        } finally {
          setIsRecordingRouteStarted(false);
        }
      }
    } finally {
      setIsStartingDelivery(false);
    }
  }



  async function handleRecordLocationUpdate() {
    const effectiveDeliveryStart: DeliveryStartResult = deliveryStartResult ?? {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Delivery must be active before syncing foreground location.',
    };

    setIsRecordingLocationUpdate(true);
    try {
      const locationResult = await recordForegroundLocationUpdateAfterDeliveryStart({
        deliveryStart: effectiveDeliveryStart,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          driverEventService,
          runtimeConfig,
          submission,
        }),
        locationService: foregroundLocationSnapshotService,
        offlineQueue: offlineSubmissionQueue,
        routePlanId: activeRoutePlanId,
      });
      setLocationUpdateResult(locationResult);
      setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
    } finally {
      setIsRecordingLocationUpdate(false);
    }
  }

  async function handleStartContinuousLocation() {
    const effectiveDeliveryStart: DeliveryStartResult = deliveryStartResult ?? {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Delivery must be active before starting continuous location updates.',
    };

    setIsStartingContinuousLocation(true);
    try {
      setContinuousLocationResult(await startContinuousLocationUpdatesAfterDeliveryStart({
        deliveryStart: effectiveDeliveryStart,
        routePlanId: activeRoutePlanId,
        streamService: continuousLocationStreamService,
      }));
    } finally {
      setIsStartingContinuousLocation(false);
    }
  }

  async function handleStopContinuousLocation() {
    setIsStoppingContinuousLocation(true);
    try {
      setContinuousLocationResult(await stopContinuousLocationUpdates({
        streamService: continuousLocationStreamService,
      }));
    } finally {
      setIsStoppingContinuousLocation(false);
    }
  }

  async function handleFinishDelivery() {
    const effectiveDeliveryStart: DeliveryStartResult = deliveryStartResult ?? {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Delivery must be active before finishing the route.',
    };

    setIsFinishingDelivery(true);
    try {
      const finishResult = await finishDeliveryAfterActive({
        deliveryStart: effectiveDeliveryStart,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          driverEventService,
          runtimeConfig,
          submission,
        }),
        offlineQueue: offlineSubmissionQueue,
        routePlanId: activeRoutePlanId,
        streamService: continuousLocationStreamService,
      });
      setDeliveryFinishResult(finishResult);
      if (finishResult.kind !== 'blocked') {
        setContinuousLocationResult({
          kind: 'stopped',
          taskName: finishResult.stoppedTaskName,
        });
      }
      setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
    } finally {
      setIsFinishingDelivery(false);
    }
  }


  function updateStopProofDraft(deliveryStopId: string, patch: Partial<StopProofDraft>) {
    setStopProofDrafts((current) => ({
      ...current,
      [deliveryStopId]: {
        ...getStopProofDraft(current[deliveryStopId]),
        ...patch,
      },
    }));
  }

  async function handleCaptureStopProofPhoto(stop: AssignedRouteStop, source: ProofPhotoCaptureSource) {
    const captureKey = `${stop.deliveryStopId}:${source}`;
    setCapturingProofPhotoId(captureKey);
    try {
      const result = await captureProofPhoto({
        captureService: proofPhotoCaptureService,
        source,
      });
      setProofPhotoCaptureResults((current) => ({ ...current, [stop.deliveryStopId]: result }));
      if (result.kind === 'captured') {
        updateStopProofDraft(stop.deliveryStopId, { photoUri: result.uri });
      }
      setUploadingProofMediaId(stop.deliveryStopId);
      const uploadRequest = {
        deliveryStopId: stop.deliveryStopId,
        fileName: getFileNameFromUri(result.kind === 'captured' ? result.uri : '', stop.deliveryStopId),
        routePlanId: activeRoutePlanId ?? '',
      };
      const uploadResult = await uploadCapturedProofPhoto({
        captureResult: result,
        uploadRequest,
        uploadService: getProofMediaUploadServiceForCurrentSubmission({
          proofMediaUploadService,
          runtimeConfig,
          submission,
        }),
      });
      if (uploadResult.kind === 'upload_failed' && result.kind === 'captured') {
        offlineSubmissionQueue.enqueueProofMediaUpload({
          ...uploadRequest,
          source: result.source,
          uri: result.uri,
        });
        setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
      }
      setProofMediaUploadResults((current) => ({ ...current, [stop.deliveryStopId]: uploadResult }));
    } finally {
      setCapturingProofPhotoId(null);
      setUploadingProofMediaId(null);
    }
  }

  async function handleCaptureStopProofSignature(stop: AssignedRouteStop) {
    setCapturingProofSignatureId(stop.deliveryStopId);
    try {
      const draft = getStopProofDraft(stopProofDrafts[stop.deliveryStopId]);
      const result = await captureProofSignature({
        captureService: {
          captureSignature: async () => ({
            kind: 'captured',
            signerName: draft.signerName,
            strokes: [Array.from({ length: draft.signaturePointCount }, (_value, index) => ({ x: index, y: index }))],
          }),
        },
      });
      setProofSignatureCaptureResults((current) => ({ ...current, [stop.deliveryStopId]: result }));
    } finally {
      setCapturingProofSignatureId(null);
    }
  }

  async function handleCaptureStopProofBarcode(stop: AssignedRouteStop) {
    setCapturingProofBarcodeId(stop.deliveryStopId);
    try {
      const result = await captureProofBarcode({ barcodeService: proofBarcodeCaptureService });
      setProofBarcodeCaptureResults((current) => ({ ...current, [stop.deliveryStopId]: result }));
    } finally {
      setCapturingProofBarcodeId(null);
    }
  }

  async function handleRecordStopProof(stop: AssignedRouteStop, action: StopProofAction) {
    const effectiveDeliveryStart: DeliveryStartResult = deliveryStartResult ?? {
      flowState: 'route_ready',
      kind: 'permission_denied',
      reason: 'foreground_location_denied',
      message: 'Delivery must be active before recording stop proof.',
    };
    const proofKey = `${stop.deliveryStopId}:${action}`;
    const draft = getStopProofDraft(stopProofDrafts[stop.deliveryStopId]);

    setRecordingStopProofId(proofKey);
    try {
      const result = await recordStopProofEventAfterDeliveryStart({
        deliveryStart: effectiveDeliveryStart,
        driverEventService: getDriverEventServiceForCurrentSubmission({
          driverEventService,
          runtimeConfig,
          submission,
        }),
        input: {
          action,
          barcodes: getScannedProofBarcodes(proofBarcodeCaptureResults[stop.deliveryStopId]),
          deliveryStopId: stop.deliveryStopId,
          media: getUploadedProofMedia(proofMediaUploadResults[stop.deliveryStopId]),
          note: draft.note,
          reason: action === 'failed' ? draft.failureReason : undefined,
          routePlanId: activeRoutePlanId ?? '',
          signatures: getCapturedProofSignatures(proofSignatureCaptureResults[stop.deliveryStopId]),
        },
        offlineQueue: offlineSubmissionQueue,
      });
      setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
      setStopProofResults((current) => ({ ...current, [proofKey]: result }));
    } finally {
      setRecordingStopProofId(null);
    }
  }

  async function handleRetryOfflineQueue() {
    setIsRetryingOfflineQueue(true);
    try {
      const result = await retryOfflineSubmissions({
        driverEventService: getDriverEventServiceForCurrentSubmission({
          driverEventService,
          runtimeConfig,
          submission,
        }),
        proofMediaUploadService: getProofMediaUploadServiceForCurrentSubmission({
          proofMediaUploadService,
          runtimeConfig,
          submission,
        }),
        queue: offlineSubmissionQueue,
      });
      setOfflineQueueRetryResult(result);
      setOfflineQueueCount(offlineSubmissionQueue.listPending().length);
    } finally {
      setIsRetryingOfflineQueue(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Clever Driver MVP</Text>
          <Text style={styles.title}>Route + phone access</Text>
          <Text style={styles.subtitle}>
            Enter the company route context and E.164 phone number. The app shows company
            guidance before consent, and never reveals stop/customer data in this step.
          </Text>
        </View>

        <FlowProgress currentState={currentFlowState} />

        <View style={styles.guardPanel}>
          <Text style={styles.sectionTitle}>Runtime API mode</Text>
          <GuardRow
            label="Delivery server"
            value={runtimeConfig.mode === 'live' ? runtimeConfig.deliveryServerBaseUrl : 'local mock services'}
          />
          <GuardRow label="Secure driver token" value={formatDriverAccessRestoreStatus(driverAccessRestoreStatus)} />
          <GuardRow label="Offline queue storage" value={formatOfflineQueueRestoreStatus(offlineQueueRestoreStatus)} />
          <GuardRow label="Offline queue" value={`${offlineQueueCount} pending submission${offlineQueueCount === 1 ? '' : 's'}`} />
          {offlineQueueRetryResult !== null ? (
            <Text style={offlineQueueRetryResult.failed === 0 ? styles.deliveryStartSuccessText : styles.routeWarningText}>
              {formatOfflineQueueRetryResult(offlineQueueRetryResult)}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={isRetryingOfflineQueue || offlineQueueCount === 0}
            onPress={handleRetryOfflineQueue}
            style={[styles.secondaryButton, (isRetryingOfflineQueue || offlineQueueCount === 0) && styles.buttonDisabled]}
          >
            {isRetryingOfflineQueue ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.secondaryButtonText}>Retry queued submissions</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.cardLight}>
          <Text style={styles.sectionTitle}>Access lookup</Text>
          <LabeledInput
            label="Route context"
            onChangeText={setRouteContext}
            placeholder="Route link/code or RoutePlan UUID"
            value={routeContext}
          />
          <LabeledInput
            keyboardType="phone-pad"
            label="Driver phone (E.164)"
            onChangeText={setPhoneE164}
            placeholder="+14165550123"
            value={phoneE164}
          />
          <MockModePicker mockMode={mockMode} setMockMode={setMockMode} />
          <Pressable accessibilityRole="button" onPress={handleLookup} style={styles.primaryButton}>
            {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Look up assignment</Text>}
          </Pressable>
        </View>

        {submission === null ? (
          <EmptyStateCard />
        ) : (
          <RouteAccessResultCard
            assignedRouteMockMode={assignedRouteMockMode}
            assignedRouteResult={assignedRouteSubmission}
            consentMockMode={consentMockMode}
            consentResult={consentSubmission}
            deliveryStartResult={deliveryStartResult}
            deliveryFinishResult={deliveryFinishResult}
            continuousLocationResult={continuousLocationResult}
            isFinishingDelivery={isFinishingDelivery}
            isLoadingAssignedRoute={isLoadingAssignedRoute}
            isRecordingConsent={isRecordingConsent}
            isRecordingLocationUpdate={isRecordingLocationUpdate}
            isStartingContinuousLocation={isStartingContinuousLocation}
            isRecordingRouteStarted={isRecordingRouteStarted}
            isStartingDelivery={isStartingDelivery}
            isStoppingContinuousLocation={isStoppingContinuousLocation}
            locationUpdateResult={locationUpdateResult}
            onLoadAssignedRoute={handleLoadAssignedRoute}
            onRecordConsent={handleRecordConsent}
            onRecordLocationUpdate={handleRecordLocationUpdate}
            onStartContinuousLocation={handleStartContinuousLocation}
            onStartDelivery={handleStartDelivery}
            onStopContinuousLocation={handleStopContinuousLocation}
            onFinishDelivery={handleFinishDelivery}
            onCaptureStopProofBarcode={handleCaptureStopProofBarcode}
            onCaptureStopProofPhoto={handleCaptureStopProofPhoto}
            onCaptureStopProofSignature={handleCaptureStopProofSignature}
            onRecordStopProof={handleRecordStopProof}
            proofBarcodeCaptureResults={proofBarcodeCaptureResults}
            proofMediaUploadResults={proofMediaUploadResults}
            proofPhotoCaptureResults={proofPhotoCaptureResults}
            proofSignatureCaptureResults={proofSignatureCaptureResults}
            capturingProofBarcodeId={capturingProofBarcodeId}
            capturingProofPhotoId={capturingProofPhotoId}
            capturingProofSignatureId={capturingProofSignatureId}
            uploadingProofMediaId={uploadingProofMediaId}
            result={submission}
            recordingStopProofId={recordingStopProofId}
            routeStartedEventResult={routeStartedEventResult}
            stopProofDrafts={stopProofDrafts}
            stopProofResults={stopProofResults}
            onUpdateStopProofDraft={updateStopProofDraft}
            setAssignedRouteMockMode={setAssignedRouteMockMode}
            setConsentMockMode={setConsentMockMode}
          />
        )}

        <View style={styles.guardPanel}>
          <Text style={styles.sectionTitle}>Current guard snapshot</Text>
          <GuardRow label="Current flow state" value={currentFlowState} />
          <GuardRow label="Route details visible" value={canRevealRoute ? 'yes' : 'blocked until consent'} />
          <GuardRow label="Foreground location" value={formatForegroundLocationStatus(deliveryStartResult)} />
          <GuardRow label="Delivery active allowed" value={formatDeliveryActiveGuard(currentFlowState, canStartDelivery)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}



function formatForegroundLocationStatus(deliveryStartResult: DeliveryStartResult | null): string {
  if (deliveryStartResult?.kind === 'delivery_active') {
    return 'granted for active delivery';
  }

  if (deliveryStartResult?.kind === 'permission_denied') {
    return 'denied; retry or open system settings';
  }

  return 'not requested before delivery start';
}

function formatDeliveryActiveGuard(currentFlowState: DriverFlowState, canStartDelivery: boolean): string {
  if (currentFlowState === 'delivery_finished') {
    return 'finished; tracking stopped';
  }

  if (currentFlowState === 'delivery_active') {
    return 'active';
  }

  return canStartDelivery ? 'ready to start' : 'requires route_ready + foreground permission';
}

function formatOfflineQueueRetryResult(result: OfflineSubmissionRetryResult): string {
  return `Offline retry: ${result.succeeded}/${result.retried} synced, ${result.discarded} discarded by policy, ${result.failed} still pending.`;
}

function formatOfflineQueueRestoreStatus(status: OfflineQueueRestoreStatus): string {
  switch (status) {
    case 'failed':
      return 'durable queue unavailable; using session memory';
    case 'loading':
      return 'loading durable queue';
    case 'ready':
      return 'durable queue ready';
  }
}

function toInvitedRouteAccess(
  result: Extract<RouteAccessSubmissionResult, { kind: 'company_guidance' }>,
): Extract<RouteAccessLookupResult, { status: 'INVITED' }> {
  return {
    status: 'INVITED',
    companyGuidance: result.companyGuidance,
    driverAccess: result.driverAccess,
    routeAccess: result.routeAccess,
  };
}

function getDriverConsentServiceForCurrentSubmission(input: {
  driverConsentService: DriverConsentService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverConsentService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.driverConsentService;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverConsentService;
}

function getAssignedRouteServiceForCurrentSubmission(input: {
  assignedRouteService: AssignedRouteService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): AssignedRouteService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.assignedRouteService;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).assignedRouteService;
}


function getDriverEventServiceForCurrentSubmission(input: {
  driverEventService: DriverEventService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): DriverEventService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.driverEventService;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).driverEventService;
}

function getProofMediaUploadServiceForCurrentSubmission(input: {
  proofMediaUploadService: ProofMediaUploadService;
  runtimeConfig: ReturnType<typeof readDriverRuntimeConfig>;
  submission: RouteAccessSubmissionResult | null;
}): ProofMediaUploadService {
  if (input.runtimeConfig.mode !== 'live' || input.submission?.kind !== 'company_guidance') {
    return input.proofMediaUploadService;
  }

  return createDriverApiClientsFromRouteAccess({
    baseUrl: input.runtimeConfig.deliveryServerBaseUrl,
    routeAccess: toInvitedRouteAccess(input.submission),
  }).proofMediaUploadService;
}

function getUploadedProofMedia(result?: ProofMediaUploadResult) {
  return result?.kind === 'uploaded' ? [result.media] : [];
}

function getCapturedProofSignatures(result?: ProofSignatureCaptureResult) {
  return result?.kind === 'captured' ? [result.signature] : [];
}

function getScannedProofBarcodes(result?: ProofBarcodeCaptureResult) {
  return result?.kind === 'scanned' ? [result.barcode] : [];
}

function getFileNameFromUri(uri: string, deliveryStopId: string): string {
  const fileName = uri.split('/').pop()?.trim();
  return fileName === undefined || fileName === '' ? `${deliveryStopId}.jpg` : fileName;
}

function formatDriverAccessRestoreStatus(status: DriverAccessRestoreResult['kind']): string {
  switch (status) {
    case 'active':
      return 'active in native secure storage';
    case 'expired':
      return 'expired and cleared';
    case 'invalid':
      return 'invalid and cleared';
    case 'missing':
      return 'no active token';
  }
}

function getCurrentFlowState(
  submission: RouteAccessSubmissionResult | null,
  consentSubmission: DriverConsentSubmissionResult | null,
  assignedRouteSubmission: AssignedRouteLoadResult | null,
  deliveryStartResult: DeliveryStartResult | null,
  deliveryFinishResult: DeliveryFinishResult | null,
): DriverFlowState {
  if (deliveryFinishResult?.flowState === 'delivery_finished') {
    return deliveryFinishResult.flowState;
  }

  if (deliveryStartResult?.kind === 'delivery_active') {
    return deliveryStartResult.flowState;
  }

  if (assignedRouteSubmission?.kind === 'route_ready') {
    return assignedRouteSubmission.flowState;
  }

  if (consentSubmission !== null) {
    return consentSubmission.flowState;
  }

  if (submission?.kind === 'company_guidance') {
    return submission.nextState;
  }

  return 'route_context_entered';
}

function LabeledInput({
  keyboardType,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  keyboardType?: 'default' | 'phone-pad';
  label: string;
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
        onChangeText={onChangeText}
        placeholder={placeholder}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function MockModePicker({
  mockMode,
  setMockMode,
}: {
  mockMode: MockMode;
  setMockMode(value: MockMode): void;
}) {
  const modes: MockMode[] = ['INVITED', 'NOT_FOUND', 'DISABLED', 'BLOCKED'];
  return (
    <View style={styles.mockPanel}>
      <Text style={styles.inputLabel}>Local mock response</Text>
      <View style={styles.chipGrid}>
        {modes.map((mode) => (
          <Pressable
            accessibilityRole="button"
            key={mode}
            onPress={() => setMockMode(mode)}
            style={[styles.chip, mockMode === mode && styles.chipActive]}
          >
            <Text style={[styles.chipText, mockMode === mode && styles.chipTextActive]}>{mode}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RouteAccessResultCard({
  assignedRouteMockMode,
  assignedRouteResult,
  consentMockMode,
  continuousLocationResult,
  consentResult,
  deliveryFinishResult,
  deliveryStartResult,
  isFinishingDelivery,
  isLoadingAssignedRoute,
  isRecordingConsent,
  isRecordingLocationUpdate,
  isRecordingRouteStarted,
  isStartingContinuousLocation,
  isStartingDelivery,
  isStoppingContinuousLocation,
  locationUpdateResult,
  onLoadAssignedRoute,
  onRecordConsent,
  onRecordLocationUpdate,
  onCaptureStopProofBarcode,
  onCaptureStopProofPhoto,
  onCaptureStopProofSignature,
  onStartContinuousLocation,
  onStartDelivery,
  onStopContinuousLocation,
  onFinishDelivery,
  onRecordStopProof,
  proofBarcodeCaptureResults,
  proofMediaUploadResults,
  proofPhotoCaptureResults,
  proofSignatureCaptureResults,
  capturingProofBarcodeId,
  capturingProofPhotoId,
  capturingProofSignatureId,
  uploadingProofMediaId,
  result,
  recordingStopProofId,
  routeStartedEventResult,
  stopProofDrafts,
  stopProofResults,
  onUpdateStopProofDraft,
  setAssignedRouteMockMode,
  setConsentMockMode,
}: {
  assignedRouteMockMode: AssignedRouteMockMode;
  assignedRouteResult: AssignedRouteLoadResult | null;
  consentMockMode: ConsentMockMode;
  consentResult: DriverConsentSubmissionResult | null;
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  deliveryFinishResult: DeliveryFinishResult | null;
  deliveryStartResult: DeliveryStartResult | null;
  isFinishingDelivery: boolean;
  isLoadingAssignedRoute: boolean;
  isRecordingConsent: boolean;
  isRecordingLocationUpdate: boolean;
  isRecordingRouteStarted: boolean;
  isStartingContinuousLocation: boolean;
  isStartingDelivery: boolean;
  isStoppingContinuousLocation: boolean;
  locationUpdateResult: ForegroundLocationUpdateResult | null;
  onLoadAssignedRoute(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']): void;
  onRecordConsent(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']): void;
  onRecordLocationUpdate(): void;
  onCaptureStopProofBarcode(stop: AssignedRouteStop): void;
  onCaptureStopProofPhoto(stop: AssignedRouteStop, source: ProofPhotoCaptureSource): void;
  onCaptureStopProofSignature(stop: AssignedRouteStop): void;
  onStartContinuousLocation(): void;
  onStartDelivery(): void;
  onStopContinuousLocation(): void;
  onFinishDelivery(): void;
  onRecordStopProof(stop: AssignedRouteStop, action: StopProofAction): void;
  proofBarcodeCaptureResults: Record<string, ProofBarcodeCaptureResult>;
  proofMediaUploadResults: Record<string, ProofMediaUploadResult>;
  proofPhotoCaptureResults: Record<string, ProofPhotoCaptureResult>;
  proofSignatureCaptureResults: Record<string, ProofSignatureCaptureResult>;
  capturingProofBarcodeId: string | null;
  capturingProofPhotoId: string | null;
  capturingProofSignatureId: string | null;
  uploadingProofMediaId: string | null;
  result: RouteAccessSubmissionResult;
  recordingStopProofId: string | null;
  routeStartedEventResult: RouteStartedRecordResult | null;
  stopProofDrafts: Record<string, StopProofDraft>;
  stopProofResults: Record<string, StopProofEventResult>;
  onUpdateStopProofDraft(deliveryStopId: string, patch: Partial<StopProofDraft>): void;
  setAssignedRouteMockMode(value: AssignedRouteMockMode): void;
  setConsentMockMode(value: ConsentMockMode): void;
}) {
  if (result.kind === 'validation_error') {
    return (
      <View style={styles.warningCard}>
        <Text style={styles.cardKickerDark}>Fix input</Text>
        <Text style={styles.cardTitleDark}>Lookup blocked before server call</Text>
        <Text style={styles.cardBodyDark}>{result.message}</Text>
      </View>
    );
  }

  if (result.kind === 'denied') {
    return (
      <View style={styles.warningCard}>
        <Text style={styles.cardKickerDark}>{result.status}</Text>
        <Text style={styles.cardTitleDark}>Assignment not available</Text>
        <Text style={styles.cardBodyDark}>{result.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.cardDark}>
      <Text style={styles.cardKicker}>Company guidance</Text>
      <Text style={styles.cardTitle}>{result.companyGuidance.companyDisplayName}</Text>
      <Text style={styles.cardBody}>{result.companyGuidance.routeName}</Text>
      <InfoRow label="Shop" value={result.companyGuidance.shopDomain} />
      <InfoRow label="Delivery date" value={result.companyGuidance.deliveryDate} />
      <InfoRow label="Timezone" value={result.companyGuidance.timezone ?? 'pending'} />
      <InfoRow label="Pickup" value={result.companyGuidance.pickupGuidance ?? 'No pickup guidance yet'} />
      <InfoRow label="Support" value={result.companyGuidance.operatorSupportContact ?? 'Contact dispatch'} />
      {result.companyGuidance.driverInstructions.map((instruction) => (
        <Text key={instruction} style={styles.instructionText}>• {instruction}</Text>
      ))}
      <View style={styles.actionPreview}>
        <Text style={styles.actionPreviewLabel}>Next</Text>
        <Text style={styles.actionPreviewText}>Record required consent before route details</Text>
      </View>
      <ConsentGateCard
        consentMockMode={consentMockMode}
        consentResult={consentResult}
        isRecordingConsent={isRecordingConsent}
        onRecordConsent={() => onRecordConsent(result.routeAccess)}
        setConsentMockMode={setConsentMockMode}
      />
      {consentResult?.kind === 'consent_recorded' ? (
        <AssignedRouteCard
          assignedRouteMockMode={assignedRouteMockMode}
          assignedRouteResult={assignedRouteResult}
          continuousLocationResult={continuousLocationResult}
          deliveryFinishResult={deliveryFinishResult}
          deliveryStartResult={deliveryStartResult}
          isFinishingDelivery={isFinishingDelivery}
          isLoadingAssignedRoute={isLoadingAssignedRoute}
          isRecordingLocationUpdate={isRecordingLocationUpdate}
          isRecordingRouteStarted={isRecordingRouteStarted}
          isStartingContinuousLocation={isStartingContinuousLocation}
          isStartingDelivery={isStartingDelivery}
          isStoppingContinuousLocation={isStoppingContinuousLocation}
          locationUpdateResult={locationUpdateResult}
          onLoadAssignedRoute={() => onLoadAssignedRoute(result.routeAccess)}
          onRecordLocationUpdate={onRecordLocationUpdate}
          onCaptureStopProofBarcode={onCaptureStopProofBarcode}
          onCaptureStopProofPhoto={onCaptureStopProofPhoto}
          onCaptureStopProofSignature={onCaptureStopProofSignature}
          onRecordStopProof={onRecordStopProof}
          proofBarcodeCaptureResults={proofBarcodeCaptureResults}
          proofMediaUploadResults={proofMediaUploadResults}
          proofPhotoCaptureResults={proofPhotoCaptureResults}
          proofSignatureCaptureResults={proofSignatureCaptureResults}
          capturingProofBarcodeId={capturingProofBarcodeId}
          capturingProofPhotoId={capturingProofPhotoId}
          capturingProofSignatureId={capturingProofSignatureId}
          uploadingProofMediaId={uploadingProofMediaId}
          onStartContinuousLocation={onStartContinuousLocation}
          onStartDelivery={onStartDelivery}
          onStopContinuousLocation={onStopContinuousLocation}
          onFinishDelivery={onFinishDelivery}
          recordingStopProofId={recordingStopProofId}
          routeStartedEventResult={routeStartedEventResult}
          stopProofDrafts={stopProofDrafts}
          stopProofResults={stopProofResults}
          onUpdateStopProofDraft={onUpdateStopProofDraft}
          setAssignedRouteMockMode={setAssignedRouteMockMode}
        />
      ) : null}
    </View>
  );
}

function ConsentGateCard({
  consentMockMode,
  consentResult,
  isRecordingConsent,
  onRecordConsent,
  setConsentMockMode,
}: {
  consentMockMode: ConsentMockMode;
  consentResult: DriverConsentSubmissionResult | null;
  isRecordingConsent: boolean;
  onRecordConsent(): void;
  setConsentMockMode(value: ConsentMockMode): void;
}) {
  return (
    <View style={styles.consentPanel}>
      <Text style={styles.consentKicker}>Consent gate</Text>
      <Text style={styles.consentTitle}>Required before assigned route</Text>
      <Text style={styles.consentBody}>
        The app records location-information and personal-information consent before route
        stops, customer addresses, or delivery location flows can be shown.
      </Text>
      <InfoRow label="Location consent" value={CONSENT_COPY_VERSIONS.locationInformation} />
      <InfoRow label="Privacy consent" value={CONSENT_COPY_VERSIONS.personalInformation} />
      <ConsentMockModePicker consentMockMode={consentMockMode} setConsentMockMode={setConsentMockMode} />
      {consentResult?.kind === 'consent_error' ? (
        <Text style={styles.consentErrorText}>{consentResult.message}</Text>
      ) : null}
      {consentResult?.kind === 'consent_recorded' ? (
        <View style={styles.consentSuccessBox}>
          <Text style={styles.consentSuccessTitle}>Consent recorded</Text>
          <Text style={styles.consentSuccessText}>{consentResult.recordedAt}</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={isRecordingConsent}
          onPress={onRecordConsent}
          style={[styles.secondaryButton, isRecordingConsent && styles.buttonDisabled]}
        >
          {isRecordingConsent ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.secondaryButtonText}>Record required consents</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function ConsentMockModePicker({
  consentMockMode,
  setConsentMockMode,
}: {
  consentMockMode: ConsentMockMode;
  setConsentMockMode(value: ConsentMockMode): void;
}) {
  const modes: ConsentMockMode[] = ['success', 'failure'];
  return (
    <View style={styles.mockPanel}>
      <Text style={styles.inputLabel}>Local consent mock</Text>
      <View style={styles.chipGrid}>
        {modes.map((mode) => (
          <Pressable
            accessibilityRole="button"
            key={mode}
            onPress={() => setConsentMockMode(mode)}
            style={[styles.chip, consentMockMode === mode && styles.chipActive]}
          >
            <Text style={[styles.chipText, consentMockMode === mode && styles.chipTextActive]}>{mode}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AssignedRouteCard({
  assignedRouteMockMode,
  assignedRouteResult,
  continuousLocationResult,
  deliveryFinishResult,
  deliveryStartResult,
  isFinishingDelivery,
  isLoadingAssignedRoute,
  isRecordingLocationUpdate,
  isRecordingRouteStarted,
  isStartingContinuousLocation,
  isStartingDelivery,
  isStoppingContinuousLocation,
  locationUpdateResult,
  onLoadAssignedRoute,
  onRecordLocationUpdate,
  onCaptureStopProofBarcode,
  onCaptureStopProofPhoto,
  onCaptureStopProofSignature,
  onRecordStopProof,
  onStartContinuousLocation,
  onStartDelivery,
  onStopContinuousLocation,
  onFinishDelivery,
  recordingStopProofId,
  routeStartedEventResult,
  proofBarcodeCaptureResults,
  proofMediaUploadResults,
  proofPhotoCaptureResults,
  proofSignatureCaptureResults,
  capturingProofBarcodeId,
  capturingProofPhotoId,
  capturingProofSignatureId,
  uploadingProofMediaId,
  stopProofDrafts,
  stopProofResults,
  onUpdateStopProofDraft,
  setAssignedRouteMockMode,
}: {
  assignedRouteMockMode: AssignedRouteMockMode;
  assignedRouteResult: AssignedRouteLoadResult | null;
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  deliveryFinishResult: DeliveryFinishResult | null;
  deliveryStartResult: DeliveryStartResult | null;
  isFinishingDelivery: boolean;
  isLoadingAssignedRoute: boolean;
  isRecordingLocationUpdate: boolean;
  isRecordingRouteStarted: boolean;
  isStartingContinuousLocation: boolean;
  isStartingDelivery: boolean;
  isStoppingContinuousLocation: boolean;
  locationUpdateResult: ForegroundLocationUpdateResult | null;
  onLoadAssignedRoute(): void;
  onRecordLocationUpdate(): void;
  onCaptureStopProofBarcode(stop: AssignedRouteStop): void;
  onCaptureStopProofPhoto(stop: AssignedRouteStop, source: ProofPhotoCaptureSource): void;
  onCaptureStopProofSignature(stop: AssignedRouteStop): void;
  onRecordStopProof(stop: AssignedRouteStop, action: StopProofAction): void;
  onStartContinuousLocation(): void;
  onStartDelivery(): void;
  onStopContinuousLocation(): void;
  onFinishDelivery(): void;
  recordingStopProofId: string | null;
  routeStartedEventResult: RouteStartedRecordResult | null;
  proofBarcodeCaptureResults: Record<string, ProofBarcodeCaptureResult>;
  proofMediaUploadResults: Record<string, ProofMediaUploadResult>;
  proofPhotoCaptureResults: Record<string, ProofPhotoCaptureResult>;
  proofSignatureCaptureResults: Record<string, ProofSignatureCaptureResult>;
  capturingProofBarcodeId: string | null;
  capturingProofPhotoId: string | null;
  capturingProofSignatureId: string | null;
  uploadingProofMediaId: string | null;
  stopProofDrafts: Record<string, StopProofDraft>;
  stopProofResults: Record<string, StopProofEventResult>;
  onUpdateStopProofDraft(deliveryStopId: string, patch: Partial<StopProofDraft>): void;
  setAssignedRouteMockMode(value: AssignedRouteMockMode): void;
}) {
  return (
    <View style={styles.routePanel}>
      <Text style={styles.consentKicker}>Assigned route</Text>
      <Text style={styles.consentTitle}>Today's route after consent</Text>
      <Text style={styles.consentBody}>
        The app loads route and stop context only after consent is recorded. Delivery start asks
        for OS foreground location permission only after route_ready.
      </Text>
      <AssignedRouteMockModePicker
        assignedRouteMockMode={assignedRouteMockMode}
        setAssignedRouteMockMode={setAssignedRouteMockMode}
      />
      {assignedRouteResult === null ? (
        <Text style={styles.routeHelpText}>Load the assigned route to move from consent_recorded to route_ready.</Text>
      ) : null}
      {assignedRouteResult?.kind === 'route_ready' ? (
        <View style={styles.routeReadyBox}>
          <Text style={styles.routeReadyKicker}>route_ready</Text>
          <Text style={styles.routeReadyTitle}>{assignedRouteResult.route.name}</Text>
          <InfoRow label="Delivery date" value={assignedRouteResult.route.deliveryDate} />
          <InfoRow label="Shop" value={assignedRouteResult.route.shopDomain} />
          <InfoRow label="Timezone" value={assignedRouteResult.route.timezone} />
          {assignedRouteResult.route.stops.map((stop) => (
            <AssignedRouteStopCard
              isDeliveryActive={deliveryStartResult?.kind === 'delivery_active' && deliveryFinishResult?.flowState !== 'delivery_finished'}
              key={stop.deliveryStopId}
              onRecordStopProof={(action) => onRecordStopProof(stop, action)}
              barcodeResult={proofBarcodeCaptureResults[stop.deliveryStopId]}
              captureResult={proofPhotoCaptureResults[stop.deliveryStopId]}
              mediaUploadResult={proofMediaUploadResults[stop.deliveryStopId]}
              signatureResult={proofSignatureCaptureResults[stop.deliveryStopId]}
              capturingProofBarcodeId={capturingProofBarcodeId}
              capturingProofPhotoId={capturingProofPhotoId}
              capturingProofSignatureId={capturingProofSignatureId}
              draft={getStopProofDraft(stopProofDrafts[stop.deliveryStopId])}
              onCaptureProofBarcode={() => onCaptureStopProofBarcode(stop)}
              onCaptureProofPhoto={(source) => onCaptureStopProofPhoto(stop, source)}
              onCaptureProofSignature={() => onCaptureStopProofSignature(stop)}
              onUpdateDraft={(patch) => onUpdateStopProofDraft(stop.deliveryStopId, patch)}
              recordingStopProofId={recordingStopProofId}
              stop={stop}
              stopProofResults={stopProofResults}
              uploadingProofMediaId={uploadingProofMediaId}
            />
          ))}
        </View>
      ) : null}
      {assignedRouteResult !== null && assignedRouteResult.kind !== 'route_ready' ? (
        <Text style={styles.routeWarningText}>{assignedRouteResult.message}</Text>
      ) : null}
      {assignedRouteResult?.kind === 'route_ready' ? (
        <DeliveryStartCard
          continuousLocationResult={continuousLocationResult}
          deliveryFinishResult={deliveryFinishResult}
          deliveryStartResult={deliveryStartResult}
          isFinishingDelivery={isFinishingDelivery}
          isRecordingLocationUpdate={isRecordingLocationUpdate}
          isRecordingRouteStarted={isRecordingRouteStarted}
          isStartingContinuousLocation={isStartingContinuousLocation}
          isStartingDelivery={isStartingDelivery}
          isStoppingContinuousLocation={isStoppingContinuousLocation}
          locationUpdateResult={locationUpdateResult}
          onRecordLocationUpdate={onRecordLocationUpdate}
          onStartContinuousLocation={onStartContinuousLocation}
          onStartDelivery={onStartDelivery}
          onStopContinuousLocation={onStopContinuousLocation}
          onFinishDelivery={onFinishDelivery}
          routeStartedEventResult={routeStartedEventResult}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoadingAssignedRoute}
        onPress={onLoadAssignedRoute}
        style={[styles.secondaryButton, isLoadingAssignedRoute && styles.buttonDisabled]}
      >
        {isLoadingAssignedRoute ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Load assigned route</Text>
        )}
      </Pressable>
    </View>
  );
}


function DeliveryStartCard({
  continuousLocationResult,
  deliveryFinishResult,
  deliveryStartResult,
  isFinishingDelivery,
  isRecordingLocationUpdate,
  isRecordingRouteStarted,
  isStartingContinuousLocation,
  isStartingDelivery,
  isStoppingContinuousLocation,
  locationUpdateResult,
  onRecordLocationUpdate,
  onStartContinuousLocation,
  onStartDelivery,
  onStopContinuousLocation,
  onFinishDelivery,
  routeStartedEventResult,
}: {
  continuousLocationResult: ContinuousLocationStreamStartResult | ContinuousLocationStopResult | null;
  deliveryFinishResult: DeliveryFinishResult | null;
  deliveryStartResult: DeliveryStartResult | null;
  isFinishingDelivery: boolean;
  isRecordingLocationUpdate: boolean;
  isRecordingRouteStarted: boolean;
  isStartingContinuousLocation: boolean;
  isStartingDelivery: boolean;
  isStoppingContinuousLocation: boolean;
  locationUpdateResult: ForegroundLocationUpdateResult | null;
  onRecordLocationUpdate(): void;
  onStartContinuousLocation(): void;
  onStartDelivery(): void;
  onStopContinuousLocation(): void;
  onFinishDelivery(): void;
  routeStartedEventResult: RouteStartedRecordResult | null;
}) {
  const isFinished = deliveryFinishResult?.flowState === 'delivery_finished';
  const isActive = deliveryStartResult?.kind === 'delivery_active' && !isFinished;
  return (
    <View style={styles.deliveryStartPanel}>
      <Text style={styles.consentKicker}>delivery_active gate</Text>
      <Text style={styles.consentTitle}>Start delivery with foreground location</Text>
      <Text style={styles.consentBody}>
        The app requests OS foreground location permission only after the driver explicitly starts
        delivery. The app records ROUTE_STARTED, foreground LOCATION_UPDATED, and continuous
        background-capable LOCATION_UPDATED events after delivery_active succeeds.
      </Text>
      {deliveryStartResult !== null ? (
        <Text style={isActive ? styles.deliveryStartSuccessText : styles.routeWarningText}>
          {deliveryStartResult.message}
        </Text>
      ) : null}
      {isRecordingRouteStarted ? (
        <Text style={styles.routeHelpText}>Recording route started event…</Text>
      ) : null}
      {routeStartedEventResult?.kind === 'recorded' ? (
        <Text style={styles.deliveryStartSuccessText}>Route started event recorded: {routeStartedEventResult.eventId}</Text>
      ) : null}
      {routeStartedEventResult?.kind === 'queued' ? (
        <Text style={styles.routeWarningText}>Route started event queued: {routeStartedEventResult.queueItemId}</Text>
      ) : null}
      {isRecordingLocationUpdate ? (
        <Text style={styles.routeHelpText}>Recording foreground location update…</Text>
      ) : null}
      {locationUpdateResult?.kind === 'recorded' ? (
        <Text style={styles.deliveryStartSuccessText}>Foreground location update recorded: {locationUpdateResult.eventId}</Text>
      ) : null}
      {locationUpdateResult?.kind === 'queued' ? (
        <Text style={styles.routeWarningText}>Foreground location update queued: {locationUpdateResult.queueItemId}</Text>
      ) : null}
      {continuousLocationResult !== null ? (
        <Text style={continuousLocationResult.kind === 'streaming' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
          {formatContinuousLocationResult(continuousLocationResult)}
        </Text>
      ) : null}
      {isFinishingDelivery ? (
        <Text style={styles.routeHelpText}>Finishing delivery and stopping route tracking…</Text>
      ) : null}
      {deliveryFinishResult !== null ? (
        <Text style={deliveryFinishResult.kind === 'recorded' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
          {formatDeliveryFinishResult(deliveryFinishResult)}
        </Text>
      ) : null}
      {isActive ? (
        <Pressable
          accessibilityRole="button"
          disabled={isRecordingLocationUpdate}
          onPress={onRecordLocationUpdate}
          style={[styles.secondaryButton, isRecordingLocationUpdate && styles.buttonDisabled]}
        >
          {isRecordingLocationUpdate ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.secondaryButtonText}>Sync foreground location</Text>
          )}
        </Pressable>
      ) : null}
      {isActive ? (
        <View style={styles.stopActionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={isStartingContinuousLocation}
            onPress={onStartContinuousLocation}
            style={[styles.stopActionButton, isStartingContinuousLocation && styles.buttonDisabled]}
          >
            <Text style={styles.stopActionButtonText}>
              {isStartingContinuousLocation ? 'Starting…' : 'Start continuous tracking'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isStoppingContinuousLocation}
            onPress={onStopContinuousLocation}
            style={[styles.stopActionDangerButton, isStoppingContinuousLocation && styles.buttonDisabled]}
          >
            <Text style={styles.stopActionButtonText}>
              {isStoppingContinuousLocation ? 'Stopping…' : 'Stop tracking'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {isActive ? (
        <Pressable
          accessibilityRole="button"
          disabled={isFinishingDelivery}
          onPress={onFinishDelivery}
          style={[styles.stopActionDangerButton, isFinishingDelivery && styles.buttonDisabled]}
        >
          <Text style={styles.stopActionButtonText}>
            {isFinishingDelivery ? 'Finishing…' : 'Finish delivery'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isStartingDelivery || isActive || isFinished}
        onPress={onStartDelivery}
        style={[styles.secondaryButton, (isStartingDelivery || isActive || isFinished) && styles.buttonDisabled]}
      >
        {isStartingDelivery ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>
            {isFinished ? 'Delivery finished' : isActive ? 'Delivery active' : 'Start delivery'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}


function formatContinuousLocationResult(result: ContinuousLocationStreamStartResult | ContinuousLocationStopResult): string {
  if (result.kind === 'streaming') {
    return result.alreadyStarted
      ? `Continuous location already active: ${result.taskName}`
      : `Continuous location active: ${result.taskName}`;
  }

  if (result.kind === 'stopped') {
    return `Continuous location stopped: ${result.taskName}`;
  }

  return result.message;
}

function formatDeliveryFinishResult(result: DeliveryFinishResult): string {
  if (result.kind === 'recorded') {
    return `${result.message} Event: ${result.eventId}. Tracking stopped: ${result.stoppedTaskName}.`;
  }

  if (result.kind === 'queued') {
    return `${result.message} Queue item: ${result.queueItemId}. Tracking stopped: ${result.stoppedTaskName}.`;
  }

  return result.message;
}

function AssignedRouteMockModePicker({
  assignedRouteMockMode,
  setAssignedRouteMockMode,
}: {
  assignedRouteMockMode: AssignedRouteMockMode;
  setAssignedRouteMockMode(value: AssignedRouteMockMode): void;
}) {
  const modes: AssignedRouteMockMode[] = ['assigned', 'none', 'failure'];
  return (
    <View style={styles.mockPanel}>
      <Text style={styles.inputLabel}>Local assigned route mock</Text>
      <View style={styles.chipGrid}>
        {modes.map((mode) => (
          <Pressable
            accessibilityRole="button"
            key={mode}
            onPress={() => setAssignedRouteMockMode(mode)}
            style={[styles.chip, assignedRouteMockMode === mode && styles.chipActive]}
          >
            <Text style={[styles.chipText, assignedRouteMockMode === mode && styles.chipTextActive]}>{mode}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}



function formatProofPhotoCaptureResult(result: ProofPhotoCaptureResult): string {
  if (result.kind === 'captured') {
    return `Proof photo attached from ${result.source}: ${result.uri}`;
  }

  if (result.kind === 'cancelled') {
    return `Proof photo ${result.source} selection cancelled.`;
  }

  return result.message;
}

function formatProofMediaUploadResult(result: ProofMediaUploadResult): string {
  if (result.kind === 'uploaded') {
    return `Proof media uploaded: ${result.media.mediaId}`;
  }

  return result.message;
}

function formatProofSignatureCaptureResult(result: ProofSignatureCaptureResult): string {
  if (result.kind === 'captured') {
    return `Signature captured: ${result.signature.signatureId} (${result.signature.pointCount} points)`;
  }

  return result.message;
}

function formatProofBarcodeCaptureResult(result: ProofBarcodeCaptureResult): string {
  if (result.kind === 'scanned') {
    return `Barcode scanned: ${result.barcode.symbology} ${result.barcode.data}`;
  }

  return result.message;
}

function getStopProofDraft(draft?: StopProofDraft): StopProofDraft {
  return {
    failureReason: draft?.failureReason ?? 'OTHER',
    note: draft?.note ?? 'Driver proof recorded in MVP app.',
    photoUri: draft?.photoUri ?? '',
    signaturePointCount: draft?.signaturePointCount ?? 0,
    signerName: draft?.signerName ?? 'Recipient',
  };
}

function AssignedRouteStopCard({
  barcodeResult,
  captureResult,
  mediaUploadResult,
  signatureResult,
  capturingProofBarcodeId,
  capturingProofPhotoId,
  capturingProofSignatureId,
  draft,
  isDeliveryActive,
  onCaptureProofBarcode,
  onCaptureProofPhoto,
  onCaptureProofSignature,
  onRecordStopProof,
  onUpdateDraft,
  recordingStopProofId,
  stop,
  stopProofResults,
  uploadingProofMediaId,
}: {
  barcodeResult?: ProofBarcodeCaptureResult;
  captureResult?: ProofPhotoCaptureResult;
  mediaUploadResult?: ProofMediaUploadResult;
  signatureResult?: ProofSignatureCaptureResult;
  capturingProofBarcodeId: string | null;
  capturingProofPhotoId: string | null;
  capturingProofSignatureId: string | null;
  draft: StopProofDraft;
  isDeliveryActive: boolean;
  onCaptureProofBarcode(): void;
  onCaptureProofPhoto(source: ProofPhotoCaptureSource): void;
  onCaptureProofSignature(): void;
  onRecordStopProof(action: StopProofAction): void;
  onUpdateDraft(patch: Partial<StopProofDraft>): void;
  recordingStopProofId: string | null;
  stop: AssignedRouteStop;
  stopProofResults: Record<string, StopProofEventResult>;
  uploadingProofMediaId: string | null;
}) {
  const deliveredKey = `${stop.deliveryStopId}:delivered`;
  const failedKey = `${stop.deliveryStopId}:failed`;
  const deliveredResult = stopProofResults[deliveredKey];
  const failedResult = stopProofResults[failedKey];
  return (
    <View style={styles.stopCard}>
      <Text style={styles.stopSequence}>Stop {stop.sequence}</Text>
      <Text style={styles.stopTitle}>{stop.orderName}</Text>
      <Text style={styles.stopBody}>{stop.recipientName ?? 'Recipient pending'}</Text>
      <Text style={styles.stopBody}>{formatStopAddress(stop)}</Text>
      <Text style={styles.stopMeta}>Phone: {stop.phone ?? 'Contact dispatch'}</Text>
      <Text style={styles.stopMeta}>Coordinates: {formatCoordinates(stop)}</Text>
      {isDeliveryActive ? (
        <View style={styles.stopActionPanel}>
          <Text style={styles.stopMeta}>Proof evidence: uploaded photo media, signature drawing evidence, barcode scan evidence, note, and failure reason.</Text>
          <TextInput
            onChangeText={(value) => onUpdateDraft({ note: value })}
            placeholder="Proof note"
            placeholderTextColor="#94a3b8"
            style={styles.stopProofInput}
            value={draft.note}
          />
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => onUpdateDraft({ photoUri: value })}
            placeholder="Captured photo URI before upload"
            placeholderTextColor="#94a3b8"
            style={styles.stopProofInput}
            value={draft.photoUri}
          />
          {captureResult !== undefined ? (
            <Text style={captureResult.kind === 'captured' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
              {formatProofPhotoCaptureResult(captureResult)}
            </Text>
          ) : null}
          {uploadingProofMediaId === stop.deliveryStopId ? (
            <Text style={styles.routeHelpText}>Uploading proof media…</Text>
          ) : null}
          {mediaUploadResult !== undefined ? (
            <Text style={mediaUploadResult.kind === 'uploaded' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
              {formatProofMediaUploadResult(mediaUploadResult)}
            </Text>
          ) : null}
          <View style={styles.stopActionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={capturingProofPhotoId === `${stop.deliveryStopId}:camera`}
              onPress={() => onCaptureProofPhoto('camera')}
              style={[styles.stopActionButton, capturingProofPhotoId === `${stop.deliveryStopId}:camera` && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {capturingProofPhotoId === `${stop.deliveryStopId}:camera` ? 'Opening…' : 'Take photo'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={capturingProofPhotoId === `${stop.deliveryStopId}:library`}
              onPress={() => onCaptureProofPhoto('library')}
              style={[styles.stopActionButton, capturingProofPhotoId === `${stop.deliveryStopId}:library` && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {capturingProofPhotoId === `${stop.deliveryStopId}:library` ? 'Opening…' : 'Choose photo'}
              </Text>
            </Pressable>
          </View>
          <TextInput
            onChangeText={(value) => onUpdateDraft({ signerName: value })}
            placeholder="Signer name"
            placeholderTextColor="#94a3b8"
            style={styles.stopProofInput}
            value={draft.signerName}
          />
          <View
            onTouchMove={() => onUpdateDraft({ signaturePointCount: draft.signaturePointCount + 1 })}
            onTouchStart={() => onUpdateDraft({ signaturePointCount: draft.signaturePointCount + 1 })}
            style={styles.signaturePad}
          >
            <Text style={styles.signaturePadText}>Draw signature here: {draft.signaturePointCount} captured points</Text>
          </View>
          <View style={styles.stopActionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onUpdateDraft({ signaturePointCount: 0 })}
              style={styles.stopActionButton}
            >
              <Text style={styles.stopActionButtonText}>Clear signature</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={capturingProofSignatureId === stop.deliveryStopId}
              onPress={onCaptureProofSignature}
              style={[styles.stopActionButton, capturingProofSignatureId === stop.deliveryStopId && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {capturingProofSignatureId === stop.deliveryStopId ? 'Capturing…' : 'Capture signature'}
              </Text>
            </Pressable>
          </View>
          {signatureResult !== undefined ? (
            <Text style={signatureResult.kind === 'captured' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
              {formatProofSignatureCaptureResult(signatureResult)}
            </Text>
          ) : null}
          <View style={styles.stopActionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={capturingProofBarcodeId === stop.deliveryStopId}
              onPress={onCaptureProofBarcode}
              style={[styles.stopActionButton, capturingProofBarcodeId === stop.deliveryStopId && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {capturingProofBarcodeId === stop.deliveryStopId ? 'Scanning…' : 'Scan barcode'}
              </Text>
            </Pressable>
          </View>
          {barcodeResult !== undefined ? (
            <Text style={barcodeResult.kind === 'scanned' ? styles.deliveryStartSuccessText : styles.routeWarningText}>
              {formatProofBarcodeCaptureResult(barcodeResult)}
            </Text>
          ) : null}
          <View style={styles.stopActionRow}>
            {STOP_PROOF_FAILURE_REASONS.map((reason) => (
              <Pressable
                accessibilityRole="button"
                key={reason}
                onPress={() => onUpdateDraft({ failureReason: reason })}
                style={[styles.reasonChip, draft.failureReason === reason && styles.reasonChipActive]}
              >
                <Text style={[styles.reasonChipText, draft.failureReason === reason && styles.reasonChipTextActive]}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          {deliveredResult?.kind === 'recorded' ? (
            <Text style={styles.deliveryStartSuccessText}>Delivered event: {deliveredResult.eventId}</Text>
          ) : null}
          {deliveredResult?.kind === 'queued' ? (
            <Text style={styles.routeWarningText}>Delivered event queued: {deliveredResult.queueItemId}</Text>
          ) : null}
          {failedResult?.kind === 'recorded' ? (
            <Text style={styles.routeWarningText}>Failed event: {failedResult.eventId}</Text>
          ) : null}
          {failedResult?.kind === 'queued' ? (
            <Text style={styles.routeWarningText}>Failed event queued: {failedResult.queueItemId}</Text>
          ) : null}
          <View style={styles.stopActionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={recordingStopProofId === deliveredKey}
              onPress={() => onRecordStopProof('delivered')}
              style={[styles.stopActionButton, recordingStopProofId === deliveredKey && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {recordingStopProofId === deliveredKey ? 'Recording…' : 'Mark delivered'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={recordingStopProofId === failedKey}
              onPress={() => onRecordStopProof('failed')}
              style={[styles.stopActionDangerButton, recordingStopProofId === failedKey && styles.buttonDisabled]}
            >
              <Text style={styles.stopActionButtonText}>
                {recordingStopProofId === failedKey ? 'Recording…' : 'Mark failed'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function formatStopAddress(stop: AssignedRouteStop): string {
  return [
    stop.address.address1,
    stop.address.address2,
    stop.address.city,
    stop.address.province,
    stop.address.postalCode,
    stop.address.countryCode,
  ].filter(Boolean).join(', ');
}

function formatCoordinates(stop: AssignedRouteStop): string {
  if (stop.coordinates === null) {
    return 'pending';
  }

  return `${stop.coordinates.latitude.toFixed(4)}, ${stop.coordinates.longitude.toFixed(4)}`;
}

function EmptyStateCard() {
  return (
    <View style={styles.cardDark}>
      <Text style={styles.cardKicker}>Before route data</Text>
      <Text style={styles.cardTitle}>Company confirmation comes first</Text>
      <Text style={styles.cardBody}>
        The lookup step only returns safe company guidance. Consent, route stops, customer
        address, and location collection remain blocked for later states.
      </Text>
    </View>
  );
}

function FlowProgress({ currentState }: { currentState: DriverFlowState }) {
  return (
    <View style={styles.progressPanel}>
      <Text style={styles.sectionTitle}>Documented state flow</Text>
      <View style={styles.chipGrid}>
        {DRIVER_FLOW_STATES.map((state) => (
          <View key={state} style={[styles.chip, state === currentState && styles.chipActive]}>
            <Text style={[styles.chipText, state === currentState && styles.chipTextActive]}>
              {state}
            </Text>
          </View>
        ))}
      </View>
    </View>
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

function GuardRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.guardRow}>
      <Text style={styles.guardLabel}>{label}</Text>
      <Text style={styles.guardValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f8fb',
  },
  container: {
    gap: 20,
    padding: 24,
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    color: '#0f172a',
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
  },
  subtitle: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 24,
  },
  progressPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    gap: 14,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  cardLight: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    gap: 14,
    padding: 18,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
    borderRadius: 14,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  mockPanel: {
    gap: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#1d4ed8',
  },
  chipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cardDark: {
    backgroundColor: '#0f172a',
    borderRadius: 28,
    gap: 12,
    padding: 22,
  },
  warningCard: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  cardKicker: {
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardKickerDark: {
    color: '#c2410c',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
  },
  cardTitleDark: {
    color: '#7c2d12',
    fontSize: 22,
    fontWeight: '800',
  },
  cardBody: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 24,
  },
  cardBodyDark: {
    color: '#9a3412',
    fontSize: 15,
    lineHeight: 22,
  },
  infoRow: {
    borderTopColor: '#1e293b',
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 10,
  },
  infoLabel: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  instructionText: {
    color: '#dbeafe',
    fontSize: 14,
    lineHeight: 20,
  },
  actionPreview: {
    backgroundColor: '#1e293b',
    borderRadius: 18,
    gap: 4,
    marginTop: 8,
    padding: 14,
  },
  actionPreviewLabel: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  actionPreviewText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  consentPanel: {
    backgroundColor: '#172554',
    borderColor: '#1d4ed8',
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
    padding: 16,
  },
  consentKicker: {
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  consentTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  consentBody: {
    color: '#dbeafe',
    fontSize: 14,
    lineHeight: 21,
  },
  consentErrorText: {
    backgroundColor: '#7f1d1d',
    borderRadius: 14,
    color: '#fee2e2',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 12,
  },
  consentSuccessBox: {
    backgroundColor: '#14532d',
    borderRadius: 16,
    gap: 4,
    padding: 14,
  },
  consentSuccessTitle: {
    color: '#bbf7d0',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  consentSuccessText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  deliveryStartPanel: {
    backgroundColor: '#ecfeff',
    borderColor: '#06b6d4',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 16,
    padding: 16,
  },
  deliveryStartSuccessText: {
    color: '#0f766e',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  routePanel: {
    backgroundColor: '#052e16',
    borderColor: '#16a34a',
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
    padding: 16,
  },
  routeHelpText: {
    backgroundColor: '#064e3b',
    borderRadius: 14,
    color: '#d1fae5',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 12,
  },
  routeReadyBox: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    gap: 10,
    padding: 14,
  },
  routeReadyKicker: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  routeReadyTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  routeWarningText: {
    backgroundColor: '#7f1d1d',
    borderRadius: 14,
    color: '#fee2e2',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 12,
  },
  stopCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    gap: 5,
    padding: 12,
  },
  stopSequence: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  stopTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  stopBody: {
    color: '#dbeafe',
    fontSize: 14,
    lineHeight: 20,
  },
  stopMeta: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  stopActionPanel: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    marginTop: 8,
    padding: 10,
  },
  stopActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stopActionButton: {
    backgroundColor: '#16a34a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stopActionDangerButton: {
    backgroundColor: '#dc2626',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stopActionButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  stopProofInput: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: 12,
    borderWidth: 1,
    color: '#e2e8f0',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  signaturePad: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderColor: '#64748b',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 92,
    padding: 12,
  },
  signaturePadText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  reasonChip: {
    backgroundColor: '#1e293b',
    borderColor: '#475569',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  reasonChipActive: {
    backgroundColor: '#f8fafc',
    borderColor: '#f8fafc',
  },
  reasonChipText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
  },
  reasonChipTextActive: {
    color: '#0f172a',
  },
  guardPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    gap: 12,
    padding: 18,
  },
  guardRow: {
    borderTopColor: '#e2e8f0',
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 12,
  },
  guardLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  guardValue: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
});
