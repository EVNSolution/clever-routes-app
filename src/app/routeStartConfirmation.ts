export const ROUTE_START_PICKUP_CONFIRMATION = {
  title: 'Confirm pickup',
  message: 'Have you received all delivery items at the depot/pickup point? Start the route only after pickup is complete.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Confirm',
} as const;

type RouteStartConfirmationButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default';
  text: string;
};

type RouteStartConfirmationAlert = {
  alert(
    title: string,
    message: string,
    buttons: RouteStartConfirmationButton[],
    options: { cancelable: boolean },
  ): void;
};

export function requestRouteStartPickupConfirmation(input: {
  alertApi: RouteStartConfirmationAlert;
  onConfirm(): void;
}): void {
  input.alertApi.alert(
    ROUTE_START_PICKUP_CONFIRMATION.title,
    ROUTE_START_PICKUP_CONFIRMATION.message,
    [
      { text: ROUTE_START_PICKUP_CONFIRMATION.cancelLabel, style: 'cancel' },
      { text: ROUTE_START_PICKUP_CONFIRMATION.confirmLabel, style: 'default', onPress: input.onConfirm },
    ],
    { cancelable: true },
  );
}
