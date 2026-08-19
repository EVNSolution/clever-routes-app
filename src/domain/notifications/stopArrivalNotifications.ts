import {
  type AssignedRoute,
  type AssignedRouteCoordinates,
  type AssignedRouteStop,
} from '../route/assignedRoute';

export const STOP_ARRIVAL_NOTIFICATION_TYPE = 'stop_arrival';
export const DRIVER_ROUTE_NOTIFICATION_TYPE = 'driver_route_changed';
export const DEFAULT_STOP_ARRIVAL_RADIUS_METERS = 50;

export type DriverRouteNotificationAction = 'assigned' | 'cancelled' | 'changed' | 'released';

export type DriverRouteNotificationData = {
  action: DriverRouteNotificationAction;
  childVersion: number;
  routeGroupingId: string;
  routePlanId: string;
  type: typeof DRIVER_ROUTE_NOTIFICATION_TYPE;
};

export type DriverRouteNotificationNavigation =
  | 'active_route_protected'
  | 'open_route'
  | 'refresh_only'
  | 'target_unavailable';

export type StopArrivalNotificationData = {
  deliveryStopId: string;
  routePlanId: string;
  type: typeof STOP_ARRIVAL_NOTIFICATION_TYPE;
};

export type StopArrivalNotificationAction = 'add_proof' | 'next_stop';

export type StopArrivalNotificationResponse = {
  action: StopArrivalNotificationAction;
  data: StopArrivalNotificationData;
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

export type StopArrivalProximityEvidence = {
  distanceMeters: number;
  isWithinRadius: boolean;
  radiusMeters: number;
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
  addDriverRouteNotificationReceivedListener(listener: (data: DriverRouteNotificationData) => Promise<void> | void): () => void;
  addDriverRouteNotificationResponseListener(listener: (data: DriverRouteNotificationData) => Promise<void> | void): () => void;
  consumePendingDriverRouteNotification(): Promise<DriverRouteNotificationData | null>;
  getDevicePushToken(): Promise<string | null>;
  getLastDriverRouteNotificationResponse(): Promise<DriverRouteNotificationData | null>;
  registerForStopArrivalNotifications(): Promise<StopArrivalNotificationRegistrationResult>;
  scheduleStopArrivalNotification(input: StopArrivalNotificationCandidate): Promise<void>;
};

export function parseDriverRouteNotificationData(
  data: Record<string, unknown> | null | undefined,
): DriverRouteNotificationData | null {
  if (data === null || data === undefined || data.type !== DRIVER_ROUTE_NOTIFICATION_TYPE) {
    return null;
  }
  if (
    !isDriverRouteNotificationAction(data.action)
    || typeof data.routeGroupingId !== 'string'
    || data.routeGroupingId.trim() === ''
    || typeof data.routePlanId !== 'string'
    || data.routePlanId.trim() === ''
  ) {
    return null;
  }
  const childVersion = typeof data.childVersion === 'number'
    ? data.childVersion
    : typeof data.childVersion === 'string'
      ? Number(data.childVersion)
      : Number.NaN;
  if (!Number.isInteger(childVersion) || childVersion <= 0) {
    return null;
  }

  return {
    action: data.action,
    childVersion,
    routeGroupingId: data.routeGroupingId,
    routePlanId: data.routePlanId,
    type: DRIVER_ROUTE_NOTIFICATION_TYPE,
  };
}

export function getDriverRouteNotificationNavigation(input: {
  action: DriverRouteNotificationAction;
  activeRoutePlanId: string | null;
  availableRoutePlanIds: string[];
  openRequested: boolean;
  routePlanId: string;
}): DriverRouteNotificationNavigation {
  if (!input.openRequested || input.action === 'cancelled' || input.action === 'released') {
    return 'refresh_only';
  }
  if (input.activeRoutePlanId !== null && input.activeRoutePlanId !== input.routePlanId) {
    return 'active_route_protected';
  }
  return input.availableRoutePlanIds.includes(input.routePlanId)
    ? 'open_route'
    : 'target_unavailable';
}

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

  const proximity = getStopArrivalProximityEvidence({
    location: input.lastLocation,
    radiusMeters,
    route: input.route,
    stop,
  });
  if (proximity === null || !proximity.isWithinRadius) {
    return null;
  }

  return {
    data: {
      deliveryStopId: stop.deliveryStopId,
      routePlanId: input.route.id,
      type: STOP_ARRIVAL_NOTIFICATION_TYPE,
    },
    distanceMeters: proximity.distanceMeters,
    radiusMeters,
    stop,
  };
}

export function getStopArrivalProximityEvidence(input: {
  location: StopArrivalLocation;
  radiusMeters?: number;
  route: AssignedRoute;
  stop: AssignedRouteStop;
}): StopArrivalProximityEvidence | null {
  const destination = resolveStopCoordinates(input.route, input.stop);
  if (destination === null) {
    return null;
  }

  const radiusMeters = input.radiusMeters ?? DEFAULT_STOP_ARRIVAL_RADIUS_METERS;
  const distanceMeters = getDistanceMeters(input.location, destination);
  return {
    distanceMeters,
    isWithinRadius: distanceMeters <= radiusMeters,
    radiusMeters,
  };
}

export function formatStopArrivalNotificationContent(candidate: StopArrivalNotificationCandidate): StopArrivalNotificationContent {
  return {
    body: formatStopArrivalAddress(candidate.stop),
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
  return stop.address.address1.trim() || stop.address.city.trim() || 'Address unavailable';
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

function isDriverRouteNotificationAction(value: unknown): value is DriverRouteNotificationAction {
  return value === 'assigned' || value === 'cancelled' || value === 'changed' || value === 'released';
}
