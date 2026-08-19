import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
  formatStopArrivalNotificationContent,
  parseDriverRouteNotificationData,
  type StopArrivalNotificationService,
} from '../../../domain/notifications/stopArrivalNotifications';

const STOP_ARRIVAL_CHANNEL_ID = 'stop-arrivals-v2';
const DRIVER_ROUTE_CHANNEL_ID = 'route-updates';
const DRIVER_NOTIFICATION_BACKGROUND_TASK = 'clever-driver-route-notification';
const PENDING_DRIVER_ROUTE_NOTIFICATION_KEY = 'clever.pendingDriverRouteNotification.v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

if (!TaskManager.isTaskDefined(DRIVER_NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    DRIVER_NOTIFICATION_BACKGROUND_TASK,
    async ({ data, error }) => {
      if (error !== undefined) {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
      const routeNotification = parseDriverRouteNotificationData(readBackgroundNotificationData(data));
      if (routeNotification === null) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }
      await AsyncStorage.setItem(
        PENDING_DRIVER_ROUTE_NOTIFICATION_KEY,
        JSON.stringify(routeNotification),
      );
      return Notifications.BackgroundNotificationTaskResult.NewData;
    },
  );
}
void Notifications.registerTaskAsync(DRIVER_NOTIFICATION_BACKGROUND_TASK).catch(() => undefined);

export function createExpoStopArrivalNotificationService(): StopArrivalNotificationService {
  return {
    addDriverRouteNotificationReceivedListener: (listener) => {
      const subscription = Notifications.addNotificationReceivedListener((notification) => {
        const data = parseDriverRouteNotificationData(notification.request.content.data);
        if (data !== null) {
          void Promise.resolve(listener(data)).catch(() => undefined);
        }
      });

      return () => subscription.remove();
    },
    addDriverRouteNotificationResponseListener: (listener) => {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = parseDriverRouteNotificationData(response.notification.request.content.data);
        if (data !== null) {
          void Promise.resolve(listener(data)).catch(() => undefined);
        }
      });

      return () => subscription.remove();
    },
    consumePendingDriverRouteNotification: async () => {
      const raw = await AsyncStorage.getItem(PENDING_DRIVER_ROUTE_NOTIFICATION_KEY);
      if (raw === null) {
        return null;
      }
      await AsyncStorage.removeItem(PENDING_DRIVER_ROUTE_NOTIFICATION_KEY);
      try {
        return parseDriverRouteNotificationData(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        return null;
      }
    },
    getDevicePushToken: readDevicePushToken,
    getLastDriverRouteNotificationResponse: async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      const data = parseDriverRouteNotificationData(response?.notification.request.content.data);
      if (data !== null) {
        await Notifications.clearLastNotificationResponseAsync();
      }
      return data;
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
        trigger: Platform.OS === 'android'
          ? { channelId: STOP_ARRIVAL_CHANNEL_ID }
          : null,
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
    enableVibrate: true,
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    name: 'Stop arrival alerts',
    vibrationPattern: [0, 400, 200, 400, 200, 700],
  });
  await Notifications.setNotificationChannelAsync(DRIVER_ROUTE_CHANNEL_ID, {
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    name: 'Route updates',
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

function readBackgroundNotificationData(
  payload: Notifications.NotificationTaskPayload,
): Record<string, unknown> | null {
  if ('actionIdentifier' in payload) {
    return payload.notification.request.content.data ?? null;
  }
  const dataString = payload.data.dataString;
  if (typeof dataString === 'string') {
    try {
      const parsed: unknown = JSON.parse(dataString);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return payload.data;
}
