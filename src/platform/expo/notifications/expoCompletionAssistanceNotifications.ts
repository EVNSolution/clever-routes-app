import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { CompletionCandidate } from '../../../domain/completion/completionAssistance';

const CHANNEL = 'delivery-confirmations';
const TYPE = 'completion_candidate';

export async function showCompletionCandidateNotification(candidate: CompletionCandidate, accountOwnerHash: string): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Delivery confirmations',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  await Notifications.scheduleNotificationAsync({
    identifier: `completion:${candidate.candidateId}`,
    content: {
      title: '방금 배송을 완료하셨나요?',
      body: '앱에서 완료 · 실패 · 아직 미완료를 확인해 주세요.',
      data: { type: TYPE, candidateId: candidate.candidateId, accountOwnerHash },
      sound: true,
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

export function listenForCompletionCandidatePress(
  onPress: (candidateId: string, accountOwnerHash: string) => Promise<boolean>,
): () => void {
  let active = true;
  const handle = async (response: Notifications.NotificationResponse | null) => {
    if (!active || response?.notification.request.content.data?.type !== TYPE) return;
    const { candidateId, accountOwnerHash } = response.notification.request.content.data;
    if (typeof candidateId !== 'string' || typeof accountOwnerHash !== 'string') return;
    if (await onPress(candidateId, accountOwnerHash) && active) {
      await Notifications.clearLastNotificationResponseAsync();
    }
  };
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    void handle(response).catch(() => undefined);
  });
  void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  return () => { active = false; subscription.remove(); };
}
