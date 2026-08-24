import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import {
  buildActiveRouteForegroundNotification,
  isActiveRouteNotificationTargetCurrent,
  parseActiveRouteNotificationUrl,
} from './activeRouteNotification';

const operationalLines = 'Alert: None\nRoute: In progress\nGPS: Monitoring\nDevice: This device\nServer: Checking\nSync: Active';

describe('active route foreground notification', () => {
  it('shows the server ETA, drop items, and customer note for the current stop', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop) => stop.sequence === 2
        ? { ...stop, customerNote: 'Please leave the order beside the loading entrance.' }
        : stop),
    };

    assert.deepEqual(buildActiveRouteForegroundNotification({ currentStepIndex: 2, route }), {
      body: '200 Queen St W, Toronto\nStatus: Transfer pending\nTotal: CAD 52.00\nCustomer note: Please leave the order beside the loading entrance.\nItems 1 type, 1 EA',
      expandedBody: `200 Queen St W, Toronto\nStatus\nTransfer pending\nTotal\nCAD 52.00\nCustomer note\nPlease leave the order beside the loading entrance.\nItems\n1 type, 1 EA\n${operationalLines}`,
      title: 'Next stop 2  ETA 7:19 AM',
      url: 'clever-routes://route-stop?routePlanId=11111111-1111-4111-8111-111111111111&deliveryStopId=33333333-3333-4333-8333-333333333333&showStopActions=true',
    });
    assert.doesNotMatch(buildActiveRouteForegroundNotification({ currentStepIndex: 2, route }).body, /Payment/u);
    assert.doesNotMatch(buildActiveRouteForegroundNotification({ currentStepIndex: 2, route }).expandedBody ?? '', /Payment/u);
  });

  it('keeps Store Pickup distinct from Stop 1 in the foreground notification', () => {
    assert.deepEqual(buildActiveRouteForegroundNotification({ currentStepIndex: 0, route: sampleAssignedRoute }), {
      body: 'Open CLEVER Routes to confirm pickup before the first delivery stop.',
      expandedBody: operationalLines,
      title: 'Pickup & Start Route',
    });
  });

  it('labels an incorrectly assigned pickup order without showing a payment review warning', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: [{
        ...sampleAssignedRoute.stops[0]!,
        deliverySession: 'PICKUP',
        normalizedPaymentStatus: 'UNKNOWN_REVIEW' as const,
        serviceType: 'PICKUP',
      }],
    };

    const notification = buildActiveRouteForegroundNotification({ currentStepIndex: 1, route });

    assert.match(notification.body, /Order type: Pickup/u);
    assert.doesNotMatch(notification.body, /Review payment|Payment:/u);
    assert.match(notification.expandedBody ?? '', /^100 King St W, Toronto\nOrder type\nPickup\n/u);
  });

  it('shows item type and total quantity counts without product names', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: [{
        ...sampleAssignedRoute.stops[0],
        customerNote: 'Call on arrival.',
        items: [
          {
            ...sampleAssignedRoute.stops[0]!.items[0]!,
            name: 'An unnecessarily long product name with several selected options',
            quantity: 5,
          },
          {
            ...sampleAssignedRoute.stops[0]!.items[0]!,
            name: 'Another unnecessarily long product name',
            productId: 102,
            quantity: 2,
          },
        ],
      }],
    };

    assert.deepEqual(buildActiveRouteForegroundNotification({ currentStepIndex: 1, route }), {
      body: '100 King St W, Toronto\nStatus: Collect cash\nTotal: CAD 84.50\nCustomer note: Call on arrival.\nItems 2 types, 7 EA',
      expandedBody: `100 King St W, Toronto\nStatus\nCollect cash\nTotal\nCAD 84.50\nCustomer note\nCall on arrival.\nItems\n2 types, 7 EA\n${operationalLines}`,
      title: 'Next stop 1  ETA 7:08 AM',
      url: 'clever-routes://route-stop?routePlanId=11111111-1111-4111-8111-111111111111&deliveryStopId=22222222-2222-4222-8222-222222222222&showStopActions=true',
    });
    assert.doesNotMatch(buildActiveRouteForegroundNotification({ currentStepIndex: 1, route }).expandedBody ?? '', /unnecessarily long product/u);
  });

  it('does not tell a driver to collect cash when the server amount is missing', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: [{
        ...sampleAssignedRoute.stops[0],
        currencyCode: null,
        paymentMethodTitle: null,
        totalPriceAmount: null,
      }],
    };

    const notification = buildActiveRouteForegroundNotification({ currentStepIndex: 1, route });
    assert.match(notification.body, /Status: Amount unavailable\nTotal: Amount unavailable/u);
    assert.doesNotMatch(notification.body, /Method:/u);
    assert.doesNotMatch(notification.body, /Collect cash/u);
    assert.match(notification.expandedBody ?? '', /Total\nAmount unavailable/u);
  });

  it('omits the generic payment fallback when the server has no method title', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: [{
        ...sampleAssignedRoute.stops[0],
        normalizedPaymentStatus: 'PAID_CONFIRMED' as const,
        paymentMethodTitle: null,
      }],
    };

    const notification = buildActiveRouteForegroundNotification({ currentStepIndex: 1, route });

    assert.match(notification.body, /Status: Paid confirmed\nTotal: CAD 84.50/u);
    assert.doesNotMatch(notification.body, /Method:|Payment/u);
    assert.doesNotMatch(notification.expandedBody ?? '', /Method\n|Payment/u);
  });

  it('parses only complete CLEVER Routes route-stop links without the React Native URL hostname', () => {
    assert.deepEqual(parseActiveRouteNotificationUrl(
      'clever-routes://route-stop?routePlanId=route%201&deliveryStopId=stop%202',
    ), {
      deliveryStopId: 'stop 2',
      routePlanId: 'route 1',
    });
    assert.equal(parseActiveRouteNotificationUrl('clever-routes://route-stop?routePlanId=route-1'), null);
    assert.equal(parseActiveRouteNotificationUrl('https://example.com/route-stop?routePlanId=route-1&deliveryStopId=stop-2'), null);

    const source = readFileSync(new URL('./activeRouteNotification.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new URL\(/u);
  });

  it('always exposes direct actions for the current delivery stop', () => {
    const notification = buildActiveRouteForegroundNotification({
      currentStepIndex: 1,
      route: sampleAssignedRoute,
    });

    assert.match(notification.url ?? '', /showStopActions=true/u);
    assert.deepEqual(parseActiveRouteNotificationUrl(`${notification.url}&action=add_proof`), {
      action: 'add_proof',
      deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
      routePlanId: sampleAssignedRoute.id,
    });
    assert.deepEqual(parseActiveRouteNotificationUrl(`${notification.url}&action=next_stop`), {
      action: 'next_stop',
      deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
      routePlanId: sampleAssignedRoute.id,
    });
    assert.equal(parseActiveRouteNotificationUrl(`${notification.url}&action=unknown`), null);
  });

  it('exposes direct actions again when the current delivery stop changes', () => {
    const notification = buildActiveRouteForegroundNotification({
      currentStepIndex: 2,
      route: sampleAssignedRoute,
    });

    assert.match(notification.url ?? '', /showStopActions=true/u);
  });

  it('opens a notification target only when it is the exact active route and current stop', () => {
    const target = {
      deliveryStopId: sampleAssignedRoute.stops[1]!.deliveryStopId,
      routePlanId: sampleAssignedRoute.id,
    };

    assert.equal(isActiveRouteNotificationTargetCurrent({
      activeRoutePlanId: sampleAssignedRoute.id,
      completedStopIds: [],
      currentStepIndex: 2,
      route: sampleAssignedRoute,
      target,
    }), true);
    assert.equal(isActiveRouteNotificationTargetCurrent({
      activeRoutePlanId: 'another-route',
      completedStopIds: [],
      currentStepIndex: 2,
      route: sampleAssignedRoute,
      target,
    }), false);
    assert.equal(isActiveRouteNotificationTargetCurrent({
      activeRoutePlanId: sampleAssignedRoute.id,
      completedStopIds: [],
      currentStepIndex: 1,
      route: sampleAssignedRoute,
      target,
    }), false);
    assert.equal(isActiveRouteNotificationTargetCurrent({
      activeRoutePlanId: sampleAssignedRoute.id,
      completedStopIds: [target.deliveryStopId],
      currentStepIndex: 2,
      route: sampleAssignedRoute,
      target,
    }), false);
    assert.equal(isActiveRouteNotificationTargetCurrent({
      activeRoutePlanId: sampleAssignedRoute.id,
      completedStopIds: [],
      currentStepIndex: 0,
      route: sampleAssignedRoute,
      target,
    }), false);
  });
});
