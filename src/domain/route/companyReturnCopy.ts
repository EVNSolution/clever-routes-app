export function getCompanyReturnCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        body: '모든 배송을 완료했습니다. 회사로 복귀해 경로를 종료할 때까지 위치 추적이 계속됩니다.',
        finish: '경로 종료',
        missingDepot: '회사 복귀 위치를 확인할 수 없습니다. 경로를 종료하기 전에 배차 담당자에게 문의하세요.',
        navigate: '회사로 길안내',
        title: '회사로 복귀',
      }
    : {
        body: 'All delivery stops are complete. Tracking stays active until you return and finish the route.',
        finish: 'Finish Route',
        missingDepot: 'Company return coordinates are unavailable. Contact dispatch before finishing.',
        navigate: 'Navigate to Company',
        title: 'Return to Company',
      };
}
