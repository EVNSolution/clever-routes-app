import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type FixedScreenHeaderProps = {
  onBack?(): void;
  onRightPress?(): void;
  overlay?: boolean;
  rightAccessibilityLabel?: string;
  rightIcon?: 'settings';
  title: string;
  topInset: number;
};

export function FixedScreenHeader({
  onBack,
  onRightPress,
  overlay = false,
  rightAccessibilityLabel,
  rightIcon,
  title,
  topInset,
}: FixedScreenHeaderProps) {
  return (
    <View style={[styles.safeFrame, overlay && styles.safeFrameOverlay, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <View style={styles.sideSlot}>
          {onBack === undefined ? null : (
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onBack}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            >
              <Ionicons color="#111827" name="chevron-back" size={30} />
            </Pressable>
          )}
        </View>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <View style={styles.sideSlot}>
          {rightIcon === undefined || onRightPress === undefined ? null : (
            <Pressable
              accessibilityLabel={rightAccessibilityLabel}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onRightPress}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            >
              <Ionicons color="#111827" name={rightIcon} size={28} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeFrame: {
    backgroundColor: '#f7f9fc',
    borderBottomColor: '#e4e7ec',
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  safeFrameOverlay: {
    backgroundColor: 'rgba(247, 249, 252, 0.96)',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 10,
  },
  sideSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonPressed: {
    backgroundColor: '#e9eef5',
  },
  title: {
    color: '#111827',
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
});
