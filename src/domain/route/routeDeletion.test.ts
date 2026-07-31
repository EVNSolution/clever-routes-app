import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverReleasedRoutePayload,
  requestActiveRouteDeletionConfirmation,
  ROUTE_DELETE_CONFIRMATION,
} from './routeDeletion';

describe('active route deletion', () => {
  it('requires an explicit destructive confirmation before deleting an active route', () => {
    let confirmed = false;
    let alertPayload: Parameters<
      Parameters<typeof requestActiveRouteDeletionConfirmation>[0]['alertApi']['alert']
    > | null = null;

    requestActiveRouteDeletionConfirmation({
      alertApi: {
        alert: (...args) => {
          alertPayload = args;
        },
      },
      onConfirm: () => {
        confirmed = true;
      },
    });

    assert.notEqual(alertPayload, null);
    const [title, message, buttons, options] = alertPayload!;
    assert.equal(title, ROUTE_DELETE_CONFIRMATION.title);
    assert.equal(message, 'Are you sure you want to delete this active session? The route will return to Ready.');
    assert.deepEqual(options, { cancelable: true });
    assert.deepEqual(buttons.map(({ style, text }) => ({ style, text })), [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Delete' },
    ]);

    buttons[0]?.onPress?.();
    assert.equal(confirmed, false);
    buttons[1]?.onPress?.();
    assert.equal(confirmed, true);
  });

  it('prepares a versioned route-release notification JSON without sending it', () => {
    assert.deepEqual(createDriverReleasedRoutePayload({
      deliveryDate: '2026-07-16',
      occurredAt: new Date('2026-07-20T02:30:00.000Z'),
      routeName: '#1',
      routePlanId: 'route-1',
      shopDomain: 'k-food.myshopify.com',
    }), {
      routeTermination: {
        action: 'RELEASE',
        reason: 'DRIVER_RELEASED',
        source: 'clever-routes-app',
      },
      shopifyAdminNotification: {
        channel: 'SHOPIFY_ADMIN',
        deliveryStatus: 'PENDING_INTEGRATION',
        eventType: 'DRIVER_ROUTE_RELEASED',
        message: 'Driver released active route "#1" scheduled for 2026-07-16. Route returned to Ready.',
        occurredAt: '2026-07-20T02:30:00.000Z',
        routePlanId: 'route-1',
        shopDomain: 'k-food.myshopify.com',
        version: 1,
      },
    });
  });
});
