import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteInventory } from './routeInventory';

describe('route inventory', () => {
  it('keeps items grouped in route order and totals assigned quantities', () => {
    const inventory = buildRouteInventory(sampleAssignedRoute);

    assert.equal(inventory.totalQuantity, 3);
    assert.deepEqual(inventory.groups.map((group) => ({
      itemCount: group.items.length,
      orderName: group.orderName,
      stopSequence: group.stopSequence,
    })), [
      { itemCount: 1, orderName: '#1001', stopSequence: 1 },
      { itemCount: 1, orderName: '#1002', stopSequence: 2 },
    ]);
  });

  it('omits empty orders without losing the truthful zero total', () => {
    const inventory = buildRouteInventory({
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop) => ({ ...stop, items: [] })),
    });

    assert.deepEqual(inventory, { groups: [], totalQuantity: 0 });
  });
});
