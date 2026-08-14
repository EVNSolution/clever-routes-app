export const ACTIVE_ROUTE_SWITCH_CONFIRMATION = {
  title: 'Delivery in progress',
  message: 'A delivery is already in progress. Cancel or complete the current delivery before starting a new route.',
  backLabel: 'Go Back',
  cancelDeliveryLabel: 'Cancel Delivery',
  completeDeliveryLabel: 'Complete Delivery',
} as const;

type ActiveRouteSwitchConfirmationButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default' | 'destructive';
  text: string;
};

type ActiveRouteSwitchConfirmationAlert = {
  alert(
    title: string,
    message: string,
    buttons: ActiveRouteSwitchConfirmationButton[],
    options: { cancelable: boolean },
  ): void;
};

export function requestActiveRouteSwitchConfirmation(input: {
  alertApi: ActiveRouteSwitchConfirmationAlert;
  onCancelCurrentDelivery(): void;
  onCompleteCurrentDelivery(): void;
}): void {
  input.alertApi.alert(
    ACTIVE_ROUTE_SWITCH_CONFIRMATION.title,
    ACTIVE_ROUTE_SWITCH_CONFIRMATION.message,
    [
      { style: 'cancel', text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.backLabel },
      {
        onPress: input.onCancelCurrentDelivery,
        style: 'destructive',
        text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.cancelDeliveryLabel,
      },
      {
        onPress: input.onCompleteCurrentDelivery,
        style: 'default',
        text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.completeDeliveryLabel,
      },
    ],
    { cancelable: true },
  );
}
