export const CONVENIENCE_NOTICES_STORAGE_KEY = 'clever.convenienceNotices.v1';

type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type ConvenienceNoticesStore = {
  load(): Promise<boolean>;
  save(enabled: boolean): Promise<void>;
};

export function createConvenienceNoticesStore(storage: PreferenceStorage): ConvenienceNoticesStore {
  return {
    async load() {
      return (await storage.getItem(CONVENIENCE_NOTICES_STORAGE_KEY)) !== 'disabled';
    },
    save(enabled) {
      return storage.setItem(CONVENIENCE_NOTICES_STORAGE_KEY, enabled ? 'enabled' : 'disabled');
    },
  };
}

export function getConvenienceNoticesCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        description: '배송지 근처에서 도착 안내를 표시합니다.',
        label: '근처 배송지 알림',
        section: '알림',
      }
    : {
        description: 'Show an arrival reminder when you are near the current stop.',
        label: 'Nearby stop reminders',
        section: 'NOTIFICATIONS',
      };
}
