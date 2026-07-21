import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import {
  buildActiveRouteForegroundNotification,
  parseActiveRouteNotificationUrl,
} from './activeRouteNotification';

describe('active route foreground notification', () => {
  it('shows the server ETA, drop items, and customer note for the current stop', () => {
    const route = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop) => stop.sequence === 2
        ? { ...stop, customerNote: 'Please leave the order beside the loading entrance.' }
        : stop),
    };

    assert.deepEqual(buildActiveRouteForegroundNotification({ currentStepIndex: 2, route }), {
      body: '200 Queen St W, Toronto\nNote: Please leave the order beside the loading entrance.\nItems 1 type, 1 EA',
      expandedBody: 'Address\n200 Queen St W, Toronto\nCustomer note\nPlease leave the order beside the loading entrance.\nItems\n1 type, 1 EA',
      title: 'Next stop 2  ETA 7:19 AM',
      url: 'clever-driver://route-stop?routePlanId=11111111-1111-4111-8111-111111111111&deliveryStopId=33333333-3333-4333-8333-333333333333',
    });
  });

  it('keeps Store Pickup distinct from Stop 1 in the foreground notification', () => {
    assert.deepEqual(buildActiveRouteForegroundNotification({ currentStepIndex: 0, route: sampleAssignedRoute }), {
      body: 'Open Clever Driver to confirm pickup before the first delivery stop.',
      title: 'Pickup & Start Route',
    });
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
      body: '100 King St W, Toronto\nNote: Call on arrival.\nItems 2 types, 7 EA',
      expandedBody: 'Address\n100 King St W, Toronto\nCustomer note\nCall on arrival.\nItems\n2 types, 7 EA',
      title: 'Next stop 1  ETA 7:08 AM',
      url: 'clever-driver://route-stop?routePlanId=11111111-1111-4111-8111-111111111111&deliveryStopId=22222222-2222-4222-8222-222222222222',
    });
    assert.doesNotMatch(buildActiveRouteForegroundNotification({ currentStepIndex: 1, route }).expandedBody ?? '', /unnecessarily long product/u);
  });

  it('parses only complete Clever Driver route-stop links without the React Native URL hostname', () => {
    assert.deepEqual(parseActiveRouteNotificationUrl(
      'clever-driver://route-stop?routePlanId=route%201&deliveryStopId=stop%202',
    ), {
      deliveryStopId: 'stop 2',
      routePlanId: 'route 1',
    });
    assert.equal(parseActiveRouteNotificationUrl('clever-driver://route-stop?routePlanId=route-1'), null);
    assert.equal(parseActiveRouteNotificationUrl('https://example.com/route-stop?routePlanId=route-1&deliveryStopId=stop-2'), null);

    const source = readFileSync(new URL('./activeRouteNotification.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new URL\(/u);
  });
});
