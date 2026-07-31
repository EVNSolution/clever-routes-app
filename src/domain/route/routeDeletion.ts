export const ROUTE_DELETE_CONFIRMATION = {
  title: 'Delete active session?',
  message: 'Are you sure you want to delete this active session? The route will return to Ready.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Delete',
} as const;

type RouteDeletionConfirmationButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default' | 'destructive';
  text: string;
};

type RouteDeletionConfirmationAlert = {
  alert(
    title: string,
    message: string,
    buttons: RouteDeletionConfirmationButton[],
    options: { cancelable: boolean },
  ): void;
};

export function requestActiveRouteDeletionConfirmation(input: {
  alertApi: RouteDeletionConfirmationAlert;
  onConfirm(): void;
}): void {
  input.alertApi.alert(
    ROUTE_DELETE_CONFIRMATION.title,
    ROUTE_DELETE_CONFIRMATION.message,
    [
      { text: ROUTE_DELETE_CONFIRMATION.cancelLabel, style: 'cancel' },
      {
        text: ROUTE_DELETE_CONFIRMATION.confirmLabel,
        style: 'destructive',
        onPress: input.onConfirm,
      },
    ],
    { cancelable: true },
  );
}

export function createDriverReleasedRoutePayload(input: {
  deliveryDate: string;
  occurredAt: Date;
  routeName: string;
  routePlanId: string;
  shopDomain: string;
}): Record<string, unknown> {
  const routeName = input.routeName.trim() || 'Unnamed route';

  return {
    routeTermination: {
      action: 'RELEASE',
      reason: 'DRIVER_RELEASED',
      source: 'clever-routes-app',
    },
    shopifyAdminNotification: {
      channel: 'SHOPIFY_ADMIN',
      deliveryStatus: 'PENDING_INTEGRATION',
      eventType: 'DRIVER_ROUTE_RELEASED',
      message: `Driver released active route "${routeName}" scheduled for ${input.deliveryDate}. Route returned to Ready.`,
      occurredAt: input.occurredAt.toISOString(),
      routePlanId: input.routePlanId,
      shopDomain: input.shopDomain,
      version: 1,
    },
  };
}
