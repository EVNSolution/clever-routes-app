/** One fixed line in Settings; no popup. The setting itself cannot be read without a native module. */
export function getBatterySettingsCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        description: '설정에서 CLEVER Routes의 배터리를 "제한 없음"으로 바꿔 주세요. 삼성 휴대전화는 "절전 앱"에서도 제외해 주세요.',
        label: '배터리 설정이 필요합니다',
      }
    : {
        description: 'In Settings, set Battery to "Unrestricted" for CLEVER Routes. On Samsung phones also remove it from "Sleeping apps".',
        label: 'Battery setting needed',
      };
}
