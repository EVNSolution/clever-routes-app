import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TRANSIENT_TOAST_ANDROID_ELEVATION,
  TRANSIENT_TOAST_BOTTOM_GAP,
  TRANSIENT_TOAST_Z_INDEX,
} from './transientToastBehavior';

export function TransientToast({ text }: { text: string }) {
  const { bottom: bottomInset } = useSafeAreaInsets();

  return (
    <View pointerEvents="none" style={[styles.toastOverlay, { bottom: bottomInset + TRANSIENT_TOAST_BOTTOM_GAP }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.toastSurface}>
        <Text numberOfLines={3} style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

const shadow = Platform.select({
  android: {
    elevation: TRANSIENT_TOAST_ANDROID_ELEVATION,
  },
  ios: {
    shadowColor: '#0f172a',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  default: {},
});

const styles = StyleSheet.create({
  toastOverlay: {
    left: 16,
    position: 'absolute',
    right: 16,
    zIndex: TRANSIENT_TOAST_Z_INDEX,
  },
  toastSurface: {
    backgroundColor: '#111827',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 13,
    ...shadow,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'left',
  },
});
