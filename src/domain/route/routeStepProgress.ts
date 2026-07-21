import type { AssignedRoute, AssignedRouteStop } from './assignedRoute';

export const ROUTE_COMPANY_STEP_INDEX = 0;
const TERMINAL_STOP_STATUSES = new Set(['CANCELLED', 'DELIVERED', 'FAILED', 'SKIPPED']);

export type StopDetailsProgressState =
  | {
      canMarkArrived: true;
      kind: 'current_stop';
      stop: AssignedRouteStop;
    }
  | {
      canMarkArrived: false;
      kind: 'preview_stop';
      stop: AssignedRouteStop;
    };

export function getCurrentRouteStop(input: {
  navigationStepIndex: number;
  route: Pick<AssignedRoute, 'stops'>;
}): AssignedRouteStop | null {
  return input.route.stops[input.navigationStepIndex - 1] ?? null;
}

export function getAssignedRouteServerProgress(route: Pick<AssignedRoute, 'stops'>): {
  completedStopIds: string[];
  navigationStepIndex: number;
} {
  const completedStopIds = route.stops
    .filter((stop) => TERMINAL_STOP_STATUSES.has(stop.status))
    .map((stop) => stop.deliveryStopId);
  if (completedStopIds.length === 0) {
    const arrivedStopIndex = route.stops.findIndex((stop) => stop.status === 'ARRIVED');
    return {
      completedStopIds,
      navigationStepIndex: arrivedStopIndex < 0 ? ROUTE_COMPANY_STEP_INDEX : arrivedStopIndex + 1,
    };
  }

  const nextStopIndex = route.stops.findIndex((stop) => !TERMINAL_STOP_STATUSES.has(stop.status));
  return {
    completedStopIds,
    navigationStepIndex: nextStopIndex < 0 ? route.stops.length : nextStopIndex + 1,
  };
}

export function getStopDetailsProgressState(input: {
  navigationStepIndex: number;
  route: Pick<AssignedRoute, 'stops'>;
  selectedStopDetailsId: string | null;
}): StopDetailsProgressState | null {
  const currentStop = getCurrentRouteStop({
    navigationStepIndex: input.navigationStepIndex,
    route: input.route,
  });
  const selectedStop = input.selectedStopDetailsId === null
    ? null
    : input.route.stops.find((stop) => stop.deliveryStopId === input.selectedStopDetailsId) ?? null;
  const stop = selectedStop ?? currentStop;

  if (stop === null) {
    return null;
  }

  if (currentStop?.deliveryStopId === stop.deliveryStopId) {
    return {
      canMarkArrived: true,
      kind: 'current_stop',
      stop,
    };
  }

  return {
    canMarkArrived: false,
    kind: 'preview_stop',
    stop,
  };
}
