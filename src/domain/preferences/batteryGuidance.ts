export const BATTERY_GUIDANCE_STORAGE_KEY = 'clever.batteryGuidance.v1';

type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type BatteryGuidanceStore = {
  isShown(): Promise<boolean>;
  markShown(): Promise<void>;
};

export function createBatteryGuidanceStore(storage: PreferenceStorage): BatteryGuidanceStore {
  return {
    async isShown() {
      return (await storage.getItem(BATTERY_GUIDANCE_STORAGE_KEY)) === 'shown';
    },
    markShown() {
      return storage.setItem(BATTERY_GUIDANCE_STORAGE_KEY, 'shown');
    },
  };
}

export function getBatteryGuidanceCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        laterLabel: '나중에',
        message: '경로가 끝날 때까지 위치 추적이 꺼지지 않게 하려면 설정에서 CLEVER Routes의 배터리를 "제한 없음"으로 바꾸세요. 삼성 휴대전화는 "절전 앱"에서도 제외해 주세요.',
        openSettingsLabel: '설정 열기',
        title: '위치 추적을 유지하세요',
      }
    : {
        laterLabel: 'Later',
        message: 'To keep location tracking on until you finish the route, set Battery to "Unrestricted" for CLEVER Routes in Settings. On Samsung phones also remove it from "Sleeping apps".',
        openSettingsLabel: 'Open Settings',
        title: 'Keep tracking on',
      };
}
