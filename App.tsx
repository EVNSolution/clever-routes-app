import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  type DriverFlowState,
} from './src/driverFlow';
import {
  createMockRouteAccessService,
  sampleInvitedRouteAccess,
  submitRouteAccess,
  type RouteAccessLookupResult,
  type RouteAccessSubmissionResult,
} from './src/routeAccess';

const SAMPLE_PHONE_E164 = '+14165550123';

type MockMode = RouteAccessLookupResult['status'];

export default function App() {
  const [routeContext, setRouteContext] = useState(sampleInvitedRouteAccess.routeAccess.routeContext);
  const [phoneE164, setPhoneE164] = useState(SAMPLE_PHONE_E164);
  const [mockMode, setMockMode] = useState<MockMode>('INVITED');
  const [submission, setSubmission] = useState<RouteAccessSubmissionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const routeAccessService = useMemo(() => {
    const result: RouteAccessLookupResult =
      mockMode === 'INVITED' ? sampleInvitedRouteAccess : { status: mockMode };
    return createMockRouteAccessService(result);
  }, [mockMode]);

  const currentFlowState = getCurrentFlowState(submission);
  const canRevealRoute = canRevealRouteDetails(currentFlowState);
  const canStartDelivery = canEnterDeliveryActive({
    state: currentFlowState,
    hasLocationPermission: true,
  });

  async function handleLookup() {
    setIsSubmitting(true);
    try {
      setSubmission(await submitRouteAccess({ routeContext, phoneE164 }, routeAccessService));
    } finally {
      setIsSubmitting(false);
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

        {submission === null ? <EmptyStateCard /> : <RouteAccessResultCard result={submission} />}

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

function getCurrentFlowState(submission: RouteAccessSubmissionResult | null): DriverFlowState {
  if (submission?.kind === 'company_guidance') {
    return submission.flowState;
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

function RouteAccessResultCard({ result }: { result: RouteAccessSubmissionResult }) {
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
        <Text style={styles.actionPreviewText}>Continue to consent gate placeholder</Text>
      </View>
    </View>
  );
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
