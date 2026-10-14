/** Start is blocked only when the OS says battery optimization is on; an unknown state never blocks. */
export function shouldBlockStartForBattery(input: {
  optimizationEnabled: boolean | null;
  platform: string;
}): boolean {
  return input.platform === 'android' && input.optimizationEnabled === true;
}

export function getBatteryGateCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        message: '배터리를 "제한 없음"으로 바꾼 뒤 다시 시작해 주세요.',
        settingsDescription: '배터리를 "제한 없음"으로 바꿔 주세요. 삼성 휴대전화는 "절전 앱"에서도 제외해 주세요.',
        settingsLabel: '배터리 설정이 필요합니다',
      }
    : {
        message: 'Set Battery to "Unrestricted", then start again.',
        settingsDescription: 'Set Battery to "Unrestricted". On Samsung phones also remove it from "Sleeping apps".',
        settingsLabel: 'Battery setting needed',
      };
}
