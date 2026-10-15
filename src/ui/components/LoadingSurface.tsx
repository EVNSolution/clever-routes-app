import { BlurTargetView, BlurView } from 'expo-blur';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/** Covers a foreground request without replacing or remounting its screen. */
export function LoadingSurface({ children, loading }: { children: ReactNode; loading: boolean }) {
  const target = useRef<View | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  if (!loading && timedOut) setTimedOut(false);
  useEffect(() => {
    if (!loading) return;
    // Release the screen without cancelling or duplicating the underlying work.
    const timer = setTimeout(() => setTimedOut(true), 20_000);
    return () => clearTimeout(timer);
  }, [loading]);
  const covered = loading && !timedOut;

  return (
    <View style={styles.frame}>
      <BlurTargetView
        ref={target}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        pointerEvents={covered ? 'none' : 'auto'}
        style={styles.frame}
      >
        {children}
      </BlurTargetView>
      {covered ? (
        <BlurView
          accessibilityLabel="Loading"
          accessibilityRole="progressbar"
          accessibilityState={{ busy: true }}
          accessibilityViewIsModal
          accessible
          blurMethod="dimezisBlurViewSdk31Plus"
          blurTarget={target}
          intensity={35}
          style={styles.overlay}
          tint="light"
        >
          <ActivityIndicator accessibilityElementsHidden importantForAccessibility="no" color="#0b57d0" size="large" />
        </BlurView>
      ) : null}
      {loading && timedOut ? (
        <View accessibilityLiveRegion="polite" style={styles.slowRequest}>
          <ActivityIndicator color="#0b57d0" size="small" />
          <Text style={styles.slowRequestText}>Taking longer than usual.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  slowRequest: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center', padding: 12 },
  slowRequestText: { color: '#526173', fontSize: 14 },
});
