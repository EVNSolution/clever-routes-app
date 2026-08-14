import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type OperationalDialogButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default' | 'destructive';
  text: string;
};

export type OperationalDialogState = {
  buttons: OperationalDialogButton[];
  cancelable: boolean;
  message: string;
  title: string;
};

const ACTION_ORDER = {
  default: 0,
  destructive: 1,
  cancel: 2,
} as const;

export function OperationalDialog({
  dialog,
  onDismiss,
  onSelect,
}: {
  dialog: OperationalDialogState | null;
  onDismiss(): void;
  onSelect(button: OperationalDialogButton): void;
}) {
  if (dialog === null) {
    return null;
  }

  const orderedButtons = [...dialog.buttons].sort((left, right) => (
    ACTION_ORDER[left.style ?? 'default'] - ACTION_ORDER[right.style ?? 'default']
  ));

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={dialog.cancelable ? onDismiss : undefined}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={!dialog.cancelable}
          importantForAccessibility="no-hide-descendants"
          onPress={onDismiss}
          style={styles.backdrop}
        />
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={styles.card}
        >
          <View style={styles.copy}>
            <Text style={styles.title}>{dialog.title}</Text>
            <Text style={styles.message}>{dialog.message}</Text>
          </View>
          <View style={styles.actions}>
            {orderedButtons.map((button) => {
              const tone = button.style ?? 'default';
              return (
                <Pressable
                  accessibilityRole="button"
                  key={`${tone}:${button.text}`}
                  onPress={() => onSelect(button)}
                  style={({ pressed }) => [
                    styles.action,
                    tone === 'default' && styles.primaryAction,
                    tone === 'destructive' && styles.destructiveAction,
                    tone === 'cancel' && styles.cancelAction,
                    pressed && styles.actionPressed,
                  ]}
                >
                  <Text style={[
                    styles.actionText,
                    tone === 'default' && styles.primaryActionText,
                    tone === 'destructive' && styles.destructiveActionText,
                    tone === 'cancel' && styles.cancelActionText,
                  ]}>
                    {button.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e4e7ec',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 12,
    gap: 24,
    maxWidth: 420,
    padding: 22,
    shadowColor: '#0f172a',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    width: '100%',
  },
  copy: {
    gap: 10,
  },
  title: {
    color: '#111827',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 28,
  },
  message: {
    color: '#667085',
    fontSize: 15,
    lineHeight: 23,
  },
  actions: {
    gap: 10,
  },
  action: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  actionPressed: {
    opacity: 0.72,
  },
  primaryAction: {
    backgroundColor: '#0b57d0',
    borderColor: '#0b57d0',
  },
  destructiveAction: {
    backgroundColor: '#fff1f0',
    borderColor: '#fda29b',
  },
  cancelAction: {
    backgroundColor: '#f2f4f7',
    borderColor: '#d0d5dd',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryActionText: {
    color: '#ffffff',
  },
  destructiveActionText: {
    color: '#b42318',
  },
  cancelActionText: {
    color: '#344054',
  },
});
