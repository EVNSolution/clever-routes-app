export const DETAILED_ACTIVE_ROUTE_NOTIFICATION_STORAGE_KEY = 'clever.detailedActiveRouteNotification.v1';

type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type DetailedActiveRouteNotificationStore = {
  load(): Promise<boolean>;
  save(enabled: boolean): Promise<void>;
};

export function createDetailedActiveRouteNotificationStore(
  storage: PreferenceStorage,
): DetailedActiveRouteNotificationStore {
  return {
    async load() {
      return (await storage.getItem(DETAILED_ACTIVE_ROUTE_NOTIFICATION_STORAGE_KEY)) !== 'disabled';
    },
    save(enabled) {
      return storage.setItem(
        DETAILED_ACTIVE_ROUTE_NOTIFICATION_STORAGE_KEY,
        enabled ? 'enabled' : 'disabled',
      );
    },
  };
}

export function getDetailedActiveRouteNotificationCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        description: '진행 중 알림에 결제, 상품, 고객 메모와 동기화 상태를 표시합니다.',
        label: '경로 알림 상세 표시',
      }
    : {
        description: 'Show payment, item, customer note, and sync details in the ongoing notification.',
        label: 'Detailed active-route notification',
      };
}
