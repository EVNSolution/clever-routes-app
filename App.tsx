import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
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
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  type DriverFlowState,
} from './src/driverFlow';
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

export default function App() {
  const [routeContext, setRouteContext] = useState(sampleInvitedRouteAccess.routeAccess.routeContext);
  const [phoneE164, setPhoneE164] = useState(SAMPLE_PHONE_E164);
  const [mockMode, setMockMode] = useState<MockMode>('INVITED');
  const [consentMockMode, setConsentMockMode] = useState<ConsentMockMode>('success');
  const [assignedRouteMockMode, setAssignedRouteMockMode] = useState<AssignedRouteMockMode>('assigned');
  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [consentSubmission, setConsentSubmission] = useState<DriverConsentSubmissionResult | null>(null);
  const [assignedRouteSubmission, setAssignedRouteSubmission] = useState<AssignedRouteLoadResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecordingConsent, setIsRecordingConsent] = useState(false);
  const [isLoadingAssignedRoute, setIsLoadingAssignedRoute] = useState(false);

  const routeAccessService = useMemo(() => {
    const result: RouteAccessLookupResult =
      mockMode === 'INVITED' ? sampleInvitedRouteAccess : { status: mockMode };
    return createMockRouteAccessService(result);
  }, [mockMode]);

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

  const currentFlowState = getCurrentFlowState(submission, consentSubmission, assignedRouteSubmission);
  const canRevealRoute = canRevealRouteDetails(currentFlowState);
  const canStartDelivery = canEnterDeliveryActive({
    state: currentFlowState,
    hasLocationPermission: false,
  });

  async function handleLookup() {
    setIsSubmitting(true);
    setConsentSubmission(null);
    setAssignedRouteSubmission(null);
    try {
      setSubmission(await submitRouteAccess({ routeContext, phoneE164 }, routeAccessService));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordConsent(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']) {
    setIsRecordingConsent(true);
    setAssignedRouteSubmission(null);
    try {
      setConsentSubmission(await submitDriverConsent(
        {
          appContext: { appVersion: '0.1.0' },
          deviceContext: { platform: Platform.OS },
          routeContext: routeAccess.routeContext,
        },
        driverConsentService,
      ));
    } finally {
      setIsRecordingConsent(false);
    }
  }

  async function handleLoadAssignedRoute(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']) {
    setIsLoadingAssignedRoute(true);
    try {
      setAssignedRouteSubmission(await loadAssignedRouteAfterConsent(
        {
          consentState: consentSubmission?.flowState === 'consent_recorded' ? 'consent_recorded' : 'consent_required',
          routeContext: routeAccess.routeContext,
        },
        assignedRouteService,
      ));
    } finally {
      setIsLoadingAssignedRoute(false);
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
            isLoadingAssignedRoute={isLoadingAssignedRoute}
            isRecordingConsent={isRecordingConsent}
            onLoadAssignedRoute={handleLoadAssignedRoute}
            onRecordConsent={handleRecordConsent}
            result={submission}
            setAssignedRouteMockMode={setAssignedRouteMockMode}
            setConsentMockMode={setConsentMockMode}
          />
        )}

        <View style={styles.guardPanel}>
          <Text style={styles.sectionTitle}>Current guard snapshot</Text>
          <GuardRow label="Current flow state" value={currentFlowState} />
          <GuardRow label="Route details visible" value={canRevealRoute ? 'yes' : 'blocked until consent'} />
          <GuardRow label="Delivery active allowed" value={canStartDelivery ? 'yes' : 'requires route_ready + OS permission'} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getCurrentFlowState(
  submission: RouteAccessSubmissionResult | null,
  consentSubmission: DriverConsentSubmissionResult | null,
  assignedRouteSubmission: AssignedRouteLoadResult | null,
): DriverFlowState {
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
  consentResult,
  isLoadingAssignedRoute,
  isRecordingConsent,
  onLoadAssignedRoute,
  onRecordConsent,
  result,
  setAssignedRouteMockMode,
  setConsentMockMode,
}: {
  assignedRouteMockMode: AssignedRouteMockMode;
  assignedRouteResult: AssignedRouteLoadResult | null;
  consentMockMode: ConsentMockMode;
  consentResult: DriverConsentSubmissionResult | null;
  isLoadingAssignedRoute: boolean;
  isRecordingConsent: boolean;
  onLoadAssignedRoute(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']): void;
  onRecordConsent(routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess']): void;
  result: RouteAccessSubmissionResult;
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
          isLoadingAssignedRoute={isLoadingAssignedRoute}
          onLoadAssignedRoute={() => onLoadAssignedRoute(result.routeAccess)}
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
  isLoadingAssignedRoute,
  onLoadAssignedRoute,
  setAssignedRouteMockMode,
}: {
  assignedRouteMockMode: AssignedRouteMockMode;
  assignedRouteResult: AssignedRouteLoadResult | null;
  isLoadingAssignedRoute: boolean;
  onLoadAssignedRoute(): void;
  setAssignedRouteMockMode(value: AssignedRouteMockMode): void;
}) {
  return (
    <View style={styles.routePanel}>
      <Text style={styles.consentKicker}>Assigned route</Text>
      <Text style={styles.consentTitle}>Today's route after consent</Text>
      <Text style={styles.consentBody}>
        The app loads route and stop context only after consent is recorded. Delivery start and
        OS location permission stay blocked for a later slice.
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
            <AssignedRouteStopCard key={stop.deliveryStopId} stop={stop} />
          ))}
        </View>
      ) : null}
      {assignedRouteResult !== null && assignedRouteResult.kind !== 'route_ready' ? (
        <Text style={styles.routeWarningText}>{assignedRouteResult.message}</Text>
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

function AssignedRouteStopCard({ stop }: { stop: AssignedRouteStop }) {
  return (
    <View style={styles.stopCard}>
      <Text style={styles.stopSequence}>Stop {stop.sequence}</Text>
      <Text style={styles.stopTitle}>{stop.orderName}</Text>
      <Text style={styles.stopBody}>{stop.recipientName ?? 'Recipient pending'}</Text>
      <Text style={styles.stopBody}>{formatStopAddress(stop)}</Text>
      <Text style={styles.stopMeta}>Phone: {stop.phone ?? 'Contact dispatch'}</Text>
      <Text style={styles.stopMeta}>Coordinates: {formatCoordinates(stop)}</Text>
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
