import type { AssignedRoute, AssignedRouteStop } from './assignedRoute';

export const ROUTE_COMPANY_STEP_INDEX = 0;

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
