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
  const arrivedStopIndex = route.stops.findIndex((stop) => stop.status === 'ARRIVED');
  if (arrivedStopIndex >= 0) {
    return {
      completedStopIds,
      navigationStepIndex: arrivedStopIndex + 1,
    };
  }
  if (completedStopIds.length === 0) {
    return {
      completedStopIds,
      navigationStepIndex: ROUTE_COMPANY_STEP_INDEX,
    };
  }

  const nextStopIndex = route.stops.findIndex((stop) => !TERMINAL_STOP_STATUSES.has(stop.status));
  return {
    completedStopIds,
    navigationStepIndex: nextStopIndex < 0 ? route.stops.length : nextStopIndex + 1,
  };
}

export function buildOutOfOrderStopArrivalWarning(input: {
  completedStopIds: string[];
  navigationStepIndex: number;
  route: Pick<AssignedRoute, 'stops'>;
  selectedStopId: string;
}): { message: string; title: string } | null {
  if (input.navigationStepIndex === ROUTE_COMPANY_STEP_INDEX) {
    return null;
  }

  const selectedStop = input.route.stops.find((stop) => stop.deliveryStopId === input.selectedStopId);
  const currentStop = getCurrentRouteStop({
    navigationStepIndex: input.navigationStepIndex,
    route: input.route,
  });
  if (
    selectedStop === undefined
    || currentStop === null
    || selectedStop.deliveryStopId === currentStop.deliveryStopId
    || isStopCompleted(selectedStop, input.completedStopIds)
  ) {
    return null;
  }

  const incompleteBeforeSelection = input.route.stops.filter((stop) => (
    stop.sequence < selectedStop.sequence
    && stop.deliveryStopId !== selectedStop.deliveryStopId
    && !isStopCompleted(stop, input.completedStopIds)
  ));
  if (incompleteBeforeSelection.length === 0) {
    return null;
  }
  const remainingLabel = formatRemainingStopLabel(incompleteBeforeSelection.map((stop) => stop.sequence));
  const incompleteVerb = incompleteBeforeSelection.length === 1 ? 'remains' : 'remain';

  return {
    message: `Stop ${selectedStop.sequence} is not the current planned stop. ${remainingLabel} ${incompleteVerb} incomplete. Confirming arrival will update live ETAs and notify the administrator.`,
    title: 'Arrive out of order?',
  };
}

export function getNextIncompleteRouteStepIndex(input: {
  completedStopIds: string[];
  currentStopId: string;
  route: Pick<AssignedRoute, 'stops'>;
}): number | null {
  const currentIndex = input.route.stops.findIndex((stop) => stop.deliveryStopId === input.currentStopId);
  if (currentIndex < 0) {
    return null;
  }

  const candidateIndexes = [
    ...input.route.stops.keys(),
  ].filter((index) => index > currentIndex).concat(
    [...input.route.stops.keys()].filter((index) => index < currentIndex),
  );
  const nextIndex = candidateIndexes.find((index) => {
    const stop = input.route.stops[index];
    return stop !== undefined && !isStopCompleted(stop, input.completedStopIds);
  });

  return nextIndex === undefined ? null : nextIndex + 1;
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

export function isStopCompleted(stop: AssignedRouteStop, completedStopIds: string[]): boolean {
  return completedStopIds.includes(stop.deliveryStopId) || TERMINAL_STOP_STATUSES.has(stop.status);
}

function formatRemainingStopLabel(sequences: number[]): string {
  const labels = [...new Set(sequences)].sort((left, right) => left - right).map((sequence) => `Stop ${sequence}`);
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}
