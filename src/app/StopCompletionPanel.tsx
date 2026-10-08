import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StopCompletion, StopCompletionInput, StopPayment } from '../domain/stop/stopCompletion';
import { formatCompletionAmount } from './kfoodSingleCompletion';

export function StopCompletionPanel({ payment, completion, pending }: {
  payment?: StopPayment | null;
  completion?: StopCompletion | null;
  pending?: { completion: StopCompletionInput; blocked: boolean } | null;
}) {
  if (completion != null) {
    const hasDifference = completion.differenceAmount !== null && !/^-?0(?:\.0+)?$/u.test(completion.differenceAmount);
    return <View style={styles.panel} accessibilityLabel="Recorded completion receipt">
      <Text style={styles.heading}>{completion.payment.methodTitle ?? 'Payment method unknown'}</Text>
      <Text style={styles.recorded}>Recorded by server</Text>
      <Text style={styles.label}>Expected at completion</Text>
      <Text style={[styles.amount, hasDifference && styles.strike]}>{formatCompletionAmount(completion.expectedAmount, completion.currencyCode, 'Amount unknown')}</Text>
      <Text style={styles.label}>Actually received</Text>
      <Text style={styles.actual}>{formatCompletionAmount(completion.actualAmount, completion.currencyCode)}</Text>
      <Text style={styles.label}>Difference: {formatCompletionAmount(completion.differenceAmount, completion.currencyCode, 'Unknown')}</Text>
      <Text style={styles.hint}>This receipt records collection. It is not settlement approval.</Text>
    </View>;
  }
  if (pending != null) return <View style={styles.panel} accessibilityLabel="Completion pending server confirmation">
    <Text style={styles.heading}>{payment?.methodTitle ?? 'Payment method unknown'}</Text>
    <Text style={styles.pending}>{pending.blocked ? 'Needs dispatch review' : 'Saved on this device · Awaiting server confirmation'}</Text>
    {pending.completion.cashReceived === undefined ? null : <>
      <Text style={styles.label}>Submitted cash</Text>
      <Text style={styles.amount}>{formatCompletionAmount(pending.completion.cashReceived.amount, pending.completion.cashReceived.currency)}</Text>
    </>}
    <Text style={styles.hint}>The original submission is preserved. Do not collect again.</Text>
  </View>;
  if (payment == null) return null;
  return <View style={styles.panel}>
    <Text style={styles.heading}>{payment.methodTitle ?? 'Payment method unknown'}</Text>
    <Text style={styles.amount}>{formatCompletionAmount(payment.expectedAmount, payment.currencyCode, 'Amount unknown')}</Text>
    <Text style={styles.hint}>{payment.requiresCashInput ? 'Enter actual cash received when completing delivery.' : 'No cash input required.'}</Text>
  </View>;
}

export function CashCompletionModal({ payment, amount, error, busy, onChangeAmount, onCancel, onConfirm }: {
  payment: StopPayment | null;
  amount: string;
  error: string | null;
  busy: boolean;
  onChangeAmount(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  return <Modal transparent animationType="fade" visible={payment !== null} onRequestClose={busy ? undefined : onCancel}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
      <View style={styles.dialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.heading}>Cash received</Text>
        <Text style={styles.label}>Expected: {payment === null ? '' : formatCompletionAmount(payment.expectedAmount, payment.currencyCode, 'Amount unknown')}</Text>
        <Text style={styles.hint}>{payment?.currencyCode ?? 'Currency unknown. Ask dispatch to correct it.'}</Text>
        <TextInput accessibilityLabel="Actual cash received" autoFocus editable={!busy} keyboardType="decimal-pad" onChangeText={onChangeAmount}
          placeholder="Enter amount, including 0" style={styles.input} value={amount} />
        {error === null ? null : <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Text style={styles.hint}>Confirm once to save the amount and complete this delivery.</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy || payment?.currencyCode == null} onPress={onConfirm}
            style={[styles.confirm, (busy || payment?.currencyCode == null) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmText}>Confirm & Complete</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  panel: { gap: 5, paddingVertical: 12 }, heading: { fontSize: 20, fontWeight: '700', color: '#152e48' },
  label: { fontSize: 15, color: '#42566c' }, amount: { fontSize: 22, fontWeight: '600', color: '#152e48' }, actual: { fontSize: 26, fontWeight: '700', color: '#146238' },
  strike: { textDecorationLine: 'line-through', color: '#68788b' }, hint: { fontSize: 13, color: '#586c82', lineHeight: 19 },
  recorded: { color: '#146238', fontSize: 14, fontWeight: '600' }, pending: { color: '#926200', fontSize: 15, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'center', padding: 22 }, dialog: { padding: 22, gap: 12, backgroundColor: 'white', borderRadius: 20 },
  input: { borderWidth: 1, borderColor: '#829bb7', borderRadius: 10, fontSize: 24, padding: 14, color: '#152e48' }, error: { color: '#b42318', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 }, cancel: { paddingVertical: 16, paddingHorizontal: 14, justifyContent: 'center' }, cancelText: { color: '#315b88', fontWeight: '600' },
  confirm: { flex: 1, borderRadius: 10, backgroundColor: '#0b57d0', padding: 16, alignItems: 'center', justifyContent: 'center' }, confirmText: { color: 'white', fontWeight: '700' }, disabled: { opacity: 0.5 },
});
