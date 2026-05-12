import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  canEnterDeliveryActive,
  canRevealRouteDetails,
  DRIVER_FLOW_STATES,
  getInitialAccessValidation,
  getPlaceholderScreens,
  type PlaceholderScreen,
} from './src/driverFlow';

const SAMPLE_ROUTE_CONTEXT = 'tomatono-route-2026-05-12';
const SAMPLE_PHONE_E164 = '+14165550123';

export default function App() {
  const screens = useMemo(() => getPlaceholderScreens(), []);
  const [screenIndex, setScreenIndex] = useState(0);
  const currentScreen = screens[screenIndex];
  const accessValidation = getInitialAccessValidation({
    routeContext: SAMPLE_ROUTE_CONTEXT,
    phoneE164: SAMPLE_PHONE_E164,
  });
  const canRevealRoute = canRevealRouteDetails(currentScreen.state);
  const canStartDelivery = canEnterDeliveryActive({
    state: currentScreen.state,
    hasLocationPermission: true,
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Clever Driver MVP</Text>
          <Text style={styles.title}>Route + phone delivery flow</Text>
          <Text style={styles.subtitle}>
            Native iOS/Android bootstrap for route-scoped driver access, company guidance,
            consent gate, and delivery-ready state placeholders.
          </Text>
        </View>

        <FlowProgress currentState={currentScreen.state} />
        <ScreenCard screen={currentScreen} />

        <View style={styles.guardPanel}>
          <Text style={styles.sectionTitle}>Current guard snapshot</Text>
          <GuardRow label="Sample access input" value={accessValidation.ok ? 'route context + E.164 phone' : accessValidation.reason} />
          <GuardRow label="Route details visible" value={canRevealRoute ? 'yes' : 'blocked until consent'} />
          <GuardRow label="Delivery active allowed" value={canStartDelivery ? 'yes' : 'requires route_ready + OS permission'} />
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={screenIndex === 0}
            onPress={() => setScreenIndex((value) => Math.max(0, value - 1))}
            style={[styles.button, screenIndex === 0 && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={screenIndex === screens.length - 1}
            onPress={() => setScreenIndex((value) => Math.min(screens.length - 1, value + 1))}
            style={[styles.button, screenIndex === screens.length - 1 && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>Next step</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FlowProgress({ currentState }: { currentState: PlaceholderScreen['state'] }) {
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

function ScreenCard({ screen }: { screen: PlaceholderScreen }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardKicker}>{screen.state}</Text>
      <Text style={styles.cardTitle}>{screen.title}</Text>
      <Text style={styles.cardBody}>{screen.purpose}</Text>
      <View style={styles.actionPreview}>
        <Text style={styles.actionPreviewLabel}>Primary action</Text>
        <Text style={styles.actionPreviewText}>{screen.primaryAction}</Text>
      </View>
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
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 28,
    gap: 12,
    padding: 22,
  },
  cardKicker: {
    color: '#93c5fd',
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
  cardBody: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 24,
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
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 16,
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonDisabled: {
    backgroundColor: '#94a3b8',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
