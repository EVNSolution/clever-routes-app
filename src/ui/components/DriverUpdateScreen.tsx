import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function DriverUpdateScreen({
  currentVersionName,
  isRequired,
  latestVersionName,
  onLater,
  onUpdate,
}: {
  currentVersionName: string;
  isRequired: boolean;
  latestVersionName: string;
  onLater(): void;
  onUpdate(): void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.icon}>
        <Ionicons color="#0b57d0" name="arrow-up-circle" size={46} />
      </View>
      <Text style={styles.title}>Update Clever Driver</Text>
      <Text style={styles.body}>
        {isRequired
          ? 'Install the latest version before starting another route.'
          : 'A newer version is ready with the latest delivery improvements.'}
      </Text>
      <View style={styles.versionRow}>
        <View style={styles.versionColumn}>
          <Text style={styles.versionLabel}>Current</Text>
          <Text style={styles.versionValue}>{currentVersionName}</Text>
        </View>
        <Ionicons color="#9ca3af" name="arrow-forward" size={20} />
        <View style={styles.versionColumn}>
          <Text style={styles.versionLabel}>Latest</Text>
          <Text style={styles.versionValue}>{latestVersionName}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onUpdate}
        style={({ pressed }) => [styles.updateButton, pressed && styles.pressed]}
      >
        <Text style={styles.updateButtonText}>Update</Text>
      </Pressable>
      {!isRequired ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLater}
          style={({ pressed }) => [styles.laterButton, pressed && styles.pressed]}
        >
          <Text style={styles.laterButtonText}>Later</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#4b5563',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 32,
    maxWidth: 330,
    textAlign: 'center',
  },
  icon: {
    alignItems: 'center',
    backgroundColor: '#e8f0fe',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    marginBottom: 22,
    width: 72,
  },
  laterButton: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 14,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center',
    marginTop: 10,
    width: '100%',
  },
  laterButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  updateButton: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    marginTop: 34,
    width: '100%',
  },
  updateButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  versionColumn: {
    alignItems: 'center',
    flex: 1,
  },
  versionLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  versionRow: {
    alignItems: 'center',
    backgroundColor: '#f6f8fb',
    borderRadius: 16,
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 18,
    width: '100%',
  },
  versionValue: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
});
