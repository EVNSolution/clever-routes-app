import type { AssignedRoute, AssignedRouteOrderItem } from '../domain/route/assignedRoute';

export type RouteInventoryGroup = {
  deliveryStopId: string;
  items: AssignedRouteOrderItem[];
  orderName: string;
  stopSequence: number;
};

export type RouteInventory = {
  groups: RouteInventoryGroup[];
  totalQuantity: number;
};

export function buildRouteInventory(route: AssignedRoute): RouteInventory {
  const groups = route.stops
    .filter((stop) => stop.items.length > 0)
    .map((stop) => ({
      deliveryStopId: stop.deliveryStopId,
      items: stop.items,
      orderName: stop.orderName,
      stopSequence: stop.sequence,
    }));

  return {
    groups,
    totalQuantity: groups.reduce(
      (total, group) => total + group.items.reduce((groupTotal, item) => groupTotal + item.quantity, 0),
      0,
    ),
  };
}
