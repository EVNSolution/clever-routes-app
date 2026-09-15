export function getCompanyReturnCopy(locale: string, returnRequired = true) {
  if (!returnRequired) {
    return locale.toLowerCase().startsWith('ko')
      ? {
          body: '모든 배송을 완료했습니다. 경로 종료를 누르면 위치 추적이 종료됩니다.',
          continueReturn: '계속 복귀',
          finish: '경로 종료',
          finishUnverified: '복귀 미확인으로 종료',
          missingDepot: '',
          navigate: '',
          title: '경로 완료',
          unverifiedBody: '',
          unverifiedTitle: '',
        }
      : {
          body: 'All delivery stops are complete. Finish the route to stop location tracking.',
          continueReturn: 'Continue Return',
          finish: 'Finish Route',
          finishUnverified: 'Finish Unverified',
          missingDepot: '',
          navigate: '',
          title: 'Route Complete',
          unverifiedBody: '',
          unverifiedTitle: '',
        };
  }

  return locale.toLowerCase().startsWith('ko')
    ? {
        body: '모든 배송을 완료했습니다. 회사로 복귀해 경로를 종료할 때까지 위치 추적이 계속됩니다.',
        continueReturn: '계속 복귀',
        finish: '경로 종료',
        finishUnverified: '복귀 미확인으로 종료',
        missingDepot: '회사 복귀 위치를 확인할 수 없습니다. 경로를 종료하기 전에 배차 담당자에게 문의하세요.',
        navigate: '회사로 길안내',
        title: '회사로 복귀',
        unverifiedBody: '현재 위치가 회사 도착 범위 안인지 확인되지 않았습니다. 계속 복귀하거나, 필요한 경우 위치 미확인 상태로 경로를 종료하세요.',
        unverifiedTitle: '회사 복귀 미확인',
      }
    : {
        body: 'All delivery stops are complete. Tracking stays active until you return and finish the route.',
        continueReturn: 'Continue Return',
        finish: 'Finish Route',
        finishUnverified: 'Finish Unverified',
        missingDepot: 'Company return coordinates are unavailable. Contact dispatch before finishing.',
        navigate: 'Navigate to Company',
        title: 'Return to Company',
        unverifiedBody: 'Your current location could not be confirmed inside the company arrival area. Continue returning, or finish the route as unverified if necessary.',
        unverifiedTitle: 'Company Return Unconfirmed',
      };
}
