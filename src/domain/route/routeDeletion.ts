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
