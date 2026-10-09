import { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { retainProofFile } from '../platform/expo/proof/durableProofFile';
import type { ProofSignaturePoint, ProofSignatureStroke } from '../domain/proof/proofSignatureCapture';

export function DeliverySignaturePad({ disabled, savedUri, onSave }: {
  disabled: boolean; savedUri?: string; onSave(uri: string): Promise<void>;
}) {
  const pad = useRef<View>(null);
  const strokesRef = useRef<ProofSignatureStroke[]>([]);
  const [strokes, setStrokes] = useState<ProofSignatureStroke[]>([]);
  const [width, setWidth] = useState(280);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const point = (event: GestureResponderEvent): ProofSignaturePoint => ({ x: Math.max(0, Math.min(width, event.nativeEvent.locationX)), y: Math.max(0, Math.min(160, event.nativeEvent.locationY)) });
  const start = (event: GestureResponderEvent) => { Keyboard.dismiss(); strokesRef.current = [...strokesRef.current, [point(event)]]; setStrokes(strokesRef.current); };
  const move = (event: GestureResponderEvent) => {
    if (strokesRef.current.reduce((total, stroke) => total + stroke.length, 0) >= 2000) return;
    const current = strokesRef.current.at(-1);
    if (current === undefined) return;
    strokesRef.current = [...strokesRef.current.slice(0, -1), [...current, point(event)]];
    setStrokes(strokesRef.current);
  };
  const save = async () => {
    if (busy || disabled || !strokes.some(stroke => stroke.length >= 2)) return;
    setBusy(true); setError(null);
    try {
      const uri = await captureRef(pad, { format: 'png', quality: 1, result: 'tmpfile' });
      await onSave(await retainProofFile(uri, 'signature'));
      strokesRef.current = []; setStrokes([]);
    } catch { setError('Signature could not be saved. Keep this screen open and try again.'); }
    finally { setBusy(false); }
  };
  if (savedUri !== undefined) return <Text style={styles.saved}>✓ Customer signature saved on this device</Text>;
  return <View style={styles.section}>
    <Text style={styles.label}>Customer signature required</Text>
    <View ref={pad} collapsable={false} accessibilityLabel="Draw customer signature" style={styles.pad}
      onLayout={event => setWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => !disabled && !busy}
      onMoveShouldSetResponder={() => !disabled && !busy} onResponderGrant={start} onResponderMove={move}>
      {strokes.flatMap((stroke, strokeIndex) => stroke.slice(1).map((end, index) => {
        const start = stroke[index]!; const dx = end.x - start.x; const dy = end.y - start.y;
        return <View key={`${strokeIndex}:${index}`} pointerEvents="none" style={[styles.line, {
          left: (start.x + end.x) / 2 - Math.hypot(dx, dy) / 2, top: (start.y + end.y) / 2 - 1.5,
          width: Math.max(2, Math.hypot(dx, dy)), transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        }]} />;
      }))}
    </View>
    {error === null ? null : <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => { strokesRef.current = []; setStrokes([]); }}><Text style={styles.button}>Clear</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => { void save(); }}>
        {busy ? <ActivityIndicator /> : <Text style={styles.button}>Save signature</Text>}
      </Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 8 }, label: { fontSize: 15, color: '#152e48', fontWeight: '600' },
  pad: { height: 160, backgroundColor: '#fff', borderColor: '#829bb7', borderWidth: 1, borderRadius: 6, overflow: 'hidden' },
  line: { position: 'absolute', height: 3, backgroundColor: '#172d45', borderRadius: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-between' }, button: { color: '#0b57d0', padding: 8, fontWeight: '600' },
  saved: { color: '#146238', fontSize: 15 }, error: { color: '#b42318' },
});
