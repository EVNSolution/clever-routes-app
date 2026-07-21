import {
  formatAssignedRouteItemLine,
  type AssignedRoute,
  type AssignedRouteCoordinates,
  type AssignedRouteStop,
} from '../route/assignedRoute';

export const STOP_ARRIVAL_NOTIFICATION_TYPE = 'stop_arrival';
export const DEFAULT_STOP_ARRIVAL_RADIUS_METERS = 50;

export type StopArrivalNotificationData = {
  deliveryStopId: string;
  routePlanId: string;
  type: typeof STOP_ARRIVAL_NOTIFICATION_TYPE;
};

export type StopArrivalNotificationCandidate = {
  data: StopArrivalNotificationData;
  distanceMeters: number;
  radiusMeters: number;
  stop: AssignedRouteStop;
};

export type StopArrivalNotificationContent = {
  body: string;
  title: string;
};

export type StopArrivalLocation = {
  latitude: number;
  longitude: number;
};

export type StopArrivalNotificationRegistrationResult =
  | {
      devicePushToken: string | null;
      kind: 'registered';
    }
  | {
      kind: 'permission_denied' | 'unavailable';
      message: string;
    };

export type StopArrivalNotificationService = {
  addStopArrivalResponseListener(listener: (data: StopArrivalNotificationData) => Promise<void> | void): () => void;
  getLastStopArrivalResponse(): Promise<StopArrivalNotificationData | null>;
  registerForStopArrivalNotifications(): Promise<StopArrivalNotificationRegistrationResult>;
  scheduleStopArrivalNotification(input: StopArrivalNotificationCandidate): Promise<void>;
};

export function getStopArrivalNotificationCandidate(input: {
  completedStopIds: string[];
  currentStepIndex: number;
  isActiveRoute: boolean;
  lastLocation: StopArrivalLocation | null;
  notifiedStopIds: string[];
  radiusMeters?: number;
  route: AssignedRoute | null;
}): StopArrivalNotificationCandidate | null {
  const radiusMeters = input.radiusMeters ?? DEFAULT_STOP_ARRIVAL_RADIUS_METERS;
  if (!input.isActiveRoute || input.route === null || input.lastLocation === null || input.currentStepIndex <= 0) {
    return null;
  }

  const stop = input.route.stops[input.currentStepIndex - 1] ?? null;
  if (stop === null || input.completedStopIds.includes(stop.deliveryStopId) || input.notifiedStopIds.includes(stop.deliveryStopId)) {
    return null;
  }

  const destination = resolveStopCoordinates(input.route, stop);
  if (destination === null) {
    return null;
  }

  const distanceMeters = getDistanceMeters(input.lastLocation, destination);
  if (distanceMeters > radiusMeters) {
    return null;
  }

  return {
    data: {
      deliveryStopId: stop.deliveryStopId,
      routePlanId: input.route.id,
      type: STOP_ARRIVAL_NOTIFICATION_TYPE,
    },
    distanceMeters,
    radiusMeters,
    stop,
  };
}

export function parseStopArrivalNotificationData(data: Record<string, unknown> | null | undefined): StopArrivalNotificationData | null {
  if (data === null || data === undefined) {
    return null;
  }

  if (
    data.type !== STOP_ARRIVAL_NOTIFICATION_TYPE ||
    typeof data.routePlanId !== 'string' ||
    data.routePlanId.trim().length === 0 ||
    typeof data.deliveryStopId !== 'string' ||
    data.deliveryStopId.trim().length === 0
  ) {
    return null;
  }

  return {
    deliveryStopId: data.deliveryStopId,
    routePlanId: data.routePlanId,
    type: STOP_ARRIVAL_NOTIFICATION_TYPE,
  };
}

export function formatStopArrivalNotificationContent(candidate: StopArrivalNotificationCandidate): StopArrivalNotificationContent {
  const itemLines = candidate.stop.items.map(formatAssignedRouteItemLine);
  return {
    body: [
      `You have arrived near the destination: ${formatStopArrivalAddress(candidate.stop)}.`,
      ...itemLines,
    ].join('\n'),
    title: `Arrived near Stop ${candidate.stop.sequence}`,
  };
}

function resolveStopCoordinates(route: AssignedRoute, stop: AssignedRouteStop): AssignedRouteCoordinates | null {
  if (stop.coordinates !== null) {
    return stop.coordinates;
  }

  const stopPoint = route.routeStopPoints.find((point) => point.deliveryStopId === stop.deliveryStopId);
  if (stopPoint?.snappedCoordinates !== null && stopPoint?.snappedCoordinates !== undefined) {
    const [longitude, latitude] = stopPoint.snappedCoordinates;
    return { latitude, longitude };
  }

  return null;
}

function formatStopArrivalAddress(stop: AssignedRouteStop): string {
  return [
    stop.address.address1,
    stop.address.address2,
    stop.address.city,
    stop.address.province,
    stop.address.postalCode,
  ]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

function getDistanceMeters(a: StopArrivalLocation, b: StopArrivalLocation): number {
  const earthRadiusMeters = 6_371_000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
