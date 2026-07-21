import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  formatStopArrivalNotificationContent,
  parseStopArrivalNotificationData,
  type StopArrivalNotificationService,
} from '../../../domain/notifications/stopArrivalNotifications';

const STOP_ARRIVAL_CHANNEL_ID = 'stop-arrivals';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function createExpoStopArrivalNotificationService(): StopArrivalNotificationService {
  return {
    addStopArrivalResponseListener: (listener) => {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = parseStopArrivalNotificationData(response.notification.request.content.data);
        if (data !== null) {
          void Promise.resolve(listener(data)).catch(() => undefined);
        }
      });

      return () => subscription.remove();
    },
    getLastStopArrivalResponse: async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      return parseStopArrivalNotificationData(response?.notification.request.content.data);
    },
    registerForStopArrivalNotifications: async () => {
      try {
        await ensureStopArrivalNotificationChannel();
        const existingPermission = await Notifications.getPermissionsAsync();
        const finalPermission = existingPermission.status === 'granted'
          ? existingPermission
          : await Notifications.requestPermissionsAsync();

        if (finalPermission.status !== 'granted') {
          return {
            kind: 'permission_denied',
            message: 'Notification permission is required for automatic arrival alerts.',
          };
        }

        const devicePushToken = await readDevicePushToken();
        return {
          devicePushToken,
          kind: 'registered',
        };
      } catch {
        return {
          kind: 'unavailable',
          message: 'Arrival notifications are unavailable on this build or device.',
        };
      }
    },
    scheduleStopArrivalNotification: async (candidate) => {
      await ensureStopArrivalNotificationChannel();
      const content = formatStopArrivalNotificationContent(candidate);
      await Notifications.scheduleNotificationAsync({
        content: {
          body: content.body,
          data: candidate.data,
          sound: true,
          title: content.title,
        },
        trigger: null,
      });
      void candidate.distanceMeters;
      void candidate.radiusMeters;
    },
  };
}

async function ensureStopArrivalNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(STOP_ARRIVAL_CHANNEL_ID, {
    importance: Notifications.AndroidImportance.HIGH,
    name: 'Stop arrival alerts',
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function readDevicePushToken(): Promise<string | null> {
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    if (typeof token.data === 'string') {
      return token.data;
    }
    return JSON.stringify(token.data);
  } catch {
    return null;
  }
}
