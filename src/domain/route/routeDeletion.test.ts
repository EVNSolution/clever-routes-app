import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverReleasedRoutePayload,
} from './routeDeletion';

describe('active route deletion', () => {
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
