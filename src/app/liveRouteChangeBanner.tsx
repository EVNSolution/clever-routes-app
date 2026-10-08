import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export function LiveRouteChangeBanner({ busy, disabled, error, recovery, acknowledgementOnly, routeName, onApply }: {
  busy: boolean;
  routeName: string;
  disabled: boolean;
  error: string | null;
  recovery: boolean;
  acknowledgementOnly: boolean;
  onApply(): void;
}) {
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.routeName} numberOfLines={1}>{routeName}</Text>
        <Text style={styles.title}>{acknowledgementOnly ? 'Route update saved' : 'Delivery list changed'}</Text>
        <Text style={styles.body}>{error ?? (recovery
          ? 'Load and apply the office update before continuing this route.'
          : acknowledgementOnly ? 'The updated route is saved on this device. Confirming with the office.'
            : 'Apply the office update when your current delivery action is finished.')}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={acknowledgementOnly ? 'Retry route update confirmation' : 'Apply delivery list changes'}
        disabled={disabled || busy} onPress={onApply} style={[styles.button, (disabled || busy) && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{acknowledgementOnly ? 'Retry' : 'Apply'}</Text>}
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginVertical: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff4db', borderColor: '#e3ae42', borderWidth: 1 },
  routeName: { fontSize: 12, fontWeight: '600', color: '#533b00', marginBottom: 3 },
  copy: { flex: 1 }, title: { fontSize: 16, fontWeight: '700', color: '#533b00' }, body: { fontSize: 13, lineHeight: 18, color: '#533b00', marginTop: 4 },
  button: { backgroundColor: '#0b57d0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.5 },
});
