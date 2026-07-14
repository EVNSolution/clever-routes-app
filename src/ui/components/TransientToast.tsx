import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  TRANSIENT_TOAST_ANDROID_ELEVATION,
  TRANSIENT_TOAST_ANDROID_TOP_OFFSET,
  TRANSIENT_TOAST_BORDER_ALPHA,
  TRANSIENT_TOAST_SURFACE_ALPHA,
  TRANSIENT_TOAST_Z_INDEX,
} from './transientToastBehavior';

export function TransientToast({ text }: { text: string }) {
  return (
    <View pointerEvents="none" style={styles.toastOverlay}>
      <Text numberOfLines={3} style={styles.toastText}>{text}</Text>
    </View>
  );
}

const shadow = Platform.select({
  android: {
    elevation: TRANSIENT_TOAST_ANDROID_ELEVATION,
  },
  ios: {
    shadowColor: '#0f172a',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  default: {},
});

const styles = StyleSheet.create({
  toastOverlay: {
    left: 22,
    position: 'absolute',
    right: 22,
    top: Platform.select({ android: TRANSIENT_TOAST_ANDROID_TOP_OFFSET, default: 32, ios: 18 }),
    zIndex: TRANSIENT_TOAST_Z_INDEX,
    ...shadow,
  },
  toastText: {
    backgroundColor: `rgba(239, 246, 255, ${TRANSIENT_TOAST_SURFACE_ALPHA})`,
    borderColor: `rgba(191, 219, 254, ${TRANSIENT_TOAST_BORDER_ALPHA})`,
    borderRadius: 999,
    borderWidth: 1,
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 11,
    textAlign: 'center',
  },
});
