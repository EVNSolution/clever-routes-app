export const ROUTE_RECONCILIATION_CLEAR_CONFIRMATION = {
  title: 'Clear saved delivery record?',
  cancelLabel: 'Cancel',
  confirmLabel: 'Clear Record',
} as const;

type RouteReconciliationClearConfirmationButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default' | 'destructive';
  text: string;
};

type RouteReconciliationClearConfirmationAlert = {
  alert(
    title: string,
    message: string,
    buttons: RouteReconciliationClearConfirmationButton[],
    options: { cancelable: boolean },
  ): void;
};

export function requestRouteReconciliationClearConfirmation(input: {
  alertApi: RouteReconciliationClearConfirmationAlert;
  count: number;
  onConfirm(): void;
}): void {
  const itemLabel = input.count === 1
    ? '1 unsynced delivery result or proof item'
    : `${input.count} unsynced delivery results or proof items`;

  input.alertApi.alert(
    ROUTE_RECONCILIATION_CLEAR_CONFIRMATION.title,
    `This removes ${itemLabel} only from this device. The server Route and its Ready status stay unchanged. This cannot be undone.`,
    [
      { text: ROUTE_RECONCILIATION_CLEAR_CONFIRMATION.cancelLabel, style: 'cancel' },
      {
        text: ROUTE_RECONCILIATION_CLEAR_CONFIRMATION.confirmLabel,
        style: 'destructive',
        onPress: input.onConfirm,
      },
    ],
    { cancelable: true },
  );
}
