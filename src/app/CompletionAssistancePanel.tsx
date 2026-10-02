import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompletionAssignmentIdentity, CompletionAssistanceState, CompletionCandidate } from '../domain/completion/completionAssistance';
import { getLocationInferredStopIds } from './completionAssistanceDisplay';

export function LocationInferenceNotice(props: {
  state: CompletionAssistanceState;
  identity?: CompletionAssignmentIdentity;
  stops?: { deliveryStopId: string; status: string }[];
  stopId: string;
  onReview(): void;
}) {
  if (!getLocationInferredStopIds(props.state, props.identity, props.stops).includes(props.stopId)) return null;
  return <Pressable accessibilityRole="button" onPress={props.onReview} style={styles.refresh}>
    <Text style={styles.link}>Location inferred completion · Review or correct</Text>
  </Pressable>;
}

export function CompletionAssistancePanel(props: {
  state: CompletionAssistanceState;
  error: string | null;
  supported: boolean;
  syncing: boolean;
  onSync(): void;
  onRespond(candidate: CompletionCandidate, response: NonNullable<CompletionCandidate['response']>): Promise<void>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const candidates = [...props.state.candidates].sort((left, right) => right.exitAt.localeCompare(left.exitAt));
  const respond = async (candidate: CompletionCandidate, response: NonNullable<CompletionCandidate['response']>) => {
    if (savingId !== null) return;
    setSavingId(candidate.candidateId);
    try { await props.onRespond(candidate, response); } finally { setSavingId(null); }
  };
  return (
    <View style={styles.page}>
      <Text style={styles.intro}>Did you just complete a delivery?</Text>
      <Text style={styles.note}>Confirm each visit. Your response takes priority. If you do not respond for 24 hours after departure, the server may mark an eligible visit as completed using location evidence.</Text>
      <Text style={styles.note}>You can finish your route and stop GPS tracking while these confirmations remain open.</Text>
      <Pressable accessibilityRole="button" disabled={props.syncing} onPress={props.onSync} style={styles.refresh}>
        <Text style={styles.link}>{props.syncing ? 'Syncing…' : 'Refresh confirmations'}</Text>
      </Pressable>
      {props.error !== null ? <Text accessibilityRole="alert" style={styles.warning}>{props.error}</Text> : null}
      {candidates.length === 0 ? <Text style={styles.note}>{props.supported
        ? 'No delivery visits need confirmation.'
        : 'Delivery confirmations are not enabled for this account yet. Continue using the delivery buttons.'}</Text> : null}
      {candidates.map((candidate) => {
        const pending = props.state.commands.some((command) => command.kind === 'response' && command.candidateId === candidate.candidateId);
        const disabled = savingId !== null || candidate.status === 'invalidated';
        return (
          <View key={candidate.candidateId} style={styles.row}>
            <Text style={styles.route}>{candidate.routeName ?? 'Delivery route'}</Text>
            <Text style={styles.title}>{candidate.stopLabel ?? 'Delivery visit'}</Text>
            <Text style={candidate.status === 'inferred_completed' ? styles.inferred : styles.status}>{statusLabel(candidate, pending)}</Text>
            <Text style={styles.note}>Visit: {formatTime(candidate.arrivalAt)} · Departed: {formatTime(candidate.exitAt)}</Text>
            {candidate.autoCompletedAt !== undefined ? <Text style={styles.note}>Automatically processed: {formatTime(candidate.autoCompletedAt)}</Text> : null}
            {candidate.status === 'awaiting_response' ? <Text style={styles.note}>{candidate.responseDeadlineAt === undefined
              ? 'Saved on this device. Waiting for the server to confirm the response deadline.'
              : `Respond by ${formatTime(candidate.responseDeadlineAt)}`}</Text> : null}
            {candidate.status === 'held' ? <Text style={styles.warning}>Automatic completion is on hold. Confirm the actual delivery result.</Text> : null}
            {candidate.status !== 'invalidated' ? (
              <View style={styles.actions}>
                {([
                  ['completed', 'Completed'], ['failed', 'Failed'], ['not_completed', 'Not completed yet'],
                ] as const).map(([response, label]) => (
                  <Pressable key={response} accessibilityRole="button"
                    accessibilityLabel={`${label}: ${candidate.stopLabel ?? 'delivery visit'}`}
                    disabled={disabled} onPress={() => { void respond(candidate, response); }}
                    style={[styles.button, disabled && styles.disabled]}>
                    <Text style={styles.buttonText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {candidate.status === 'inferred_completed' ? <Text style={styles.note}>If the location estimate is wrong, choose the actual result above to correct it.</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function statusLabel(candidate: CompletionCandidate, pending: boolean): string {
  if (pending) return 'Response saved · waiting to sync';
  if (candidate.status === 'inferred_completed') return 'Location inferred completion · 위치 추정 완료';
  if (candidate.status === 'responded') {
    return candidate.response === 'completed' ? 'Confirmed completed'
      : candidate.response === 'failed' ? 'Confirmed failed' : 'Confirmed not completed';
  }
  if (candidate.status === 'invalidated') return 'Assignment or delivery status changed · review closed';
  if (candidate.status === 'held') return 'Needs confirmation';
  return 'Completion candidate · waiting for your response';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Pending';
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  intro: { color: '#172b4d', fontSize: 20, fontWeight: '700' },
  note: { color: '#526173', fontSize: 14, lineHeight: 21 },
  refresh: { paddingVertical: 12 },
  link: { color: '#0b57d0', fontWeight: '600' },
  warning: { color: '#9a3412', fontSize: 14, lineHeight: 21 },
  row: { borderTopColor: '#d9e0e8', borderTopWidth: 1, paddingVertical: 18, gap: 8 },
  route: { color: '#526173', fontSize: 13 },
  title: { color: '#172b4d', fontSize: 17, fontWeight: '600' },
  status: { color: '#344054', fontSize: 14, fontWeight: '600' },
  inferred: { color: '#7a4b00', fontSize: 14, fontWeight: '700' },
  actions: { gap: 8, marginTop: 4 },
  button: { borderColor: '#b8c5d6', borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 12 },
  buttonText: { color: '#0b57d0', fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
