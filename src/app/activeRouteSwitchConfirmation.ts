type ActiveRouteSwitchButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default' | 'destructive';
  text: string;
};

type ActiveRouteSwitchAlert = {
  alert(
    title: string,
    message: string,
    buttons: ActiveRouteSwitchButton[],
    options: { cancelable: boolean },
  ): void;
};

/** A route of another delivery date is stopped at once; the same date asks first. */
export function decideActiveRouteSwitch(input: {
  activeDeliveryDate: string;
  targetDeliveryDate: string;
}): 'confirm' | 'switch_now' {
  return input.activeDeliveryDate === input.targetDeliveryDate ? 'confirm' : 'switch_now';
}

export function getActiveRouteSwitchCopy(locale: string) {
  return locale.toLowerCase().startsWith('ko')
    ? {
        backLabel: '취소',
        message: '새 경로를 시작하면 현재 경로는 중단됩니다.',
        stopAndStartLabel: '중단하고 시작',
        title: '진행 중인 경로가 있습니다',
      }
    : {
        backLabel: 'Go Back',
        message: 'Starting this route stops the route in progress.',
        stopAndStartLabel: 'Stop and Start',
        title: 'Route in progress',
      };
}

export function requestActiveRouteSwitchConfirmation(input: {
  alertApi: ActiveRouteSwitchAlert;
  locale: string;
  onStopActiveRoute(): void;
}): void {
  const copy = getActiveRouteSwitchCopy(input.locale);
  input.alertApi.alert(
    copy.title,
    copy.message,
    [
      { style: 'cancel', text: copy.backLabel },
      { onPress: input.onStopActiveRoute, style: 'destructive', text: copy.stopAndStartLabel },
    ],
    { cancelable: true },
  );
}
