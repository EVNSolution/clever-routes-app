import type { AssignedRoute, AssignedRouteAddress, AssignedRouteLngLat, AssignedRouteStop } from '../route/assignedRoute';

export type StopNavigationPlatform = 'android' | 'ios' | string;

export type StopNavigationResult =
  | {
      kind: 'opened';
      message: string;
      url: string;
    }
  | {
      kind: 'skipped';
      message: string;
      reason: 'missing_destination';
    }
  | {
      kind: 'failed';
      message: string;
      reason: 'open_failed';
      url: string;
    };

export type StopNavigationLinking = {
  openURL(url: string): Promise<unknown> | unknown;
};

export type RouteNavigationResult =
  | {
      kind: 'opened';
      message: string;
      url: string;
    }
  | {
      kind: 'skipped';
      message: string;
      reason: 'missing_destination';
    }
  | {
      kind: 'failed';
      message: string;
      reason: 'open_failed';
      url: string;
    };

type RouteNavigationTarget = {
  value: string;
};

const GOOGLE_MAPS_DIRECTIONS_URL = 'https://www.google.com/maps/dir/';
const GOOGLE_MAPS_MAX_WAYPOINTS = 3;

export function buildRouteNavigationUrl(input: {
  route: AssignedRoute;
}): string | null {
  const targets = buildRouteNavigationTargets(input.route);
  if (targets.length === 0) {
    return null;
  }

  const boundedTargets = targets.slice(0, GOOGLE_MAPS_MAX_WAYPOINTS + 1);
  const destination = boundedTargets[boundedTargets.length - 1]!;
  const waypoints = boundedTargets.slice(0, -1);
  const params = [
    'api=1',
    'travelmode=driving',
    'dir_action=navigate',
    `destination=${encodeURIComponent(destination.value)}`,
  ];

  if (waypoints.length > 0) {
    params.push(`waypoints=${waypoints.map((target) => encodeURIComponent(target.value)).join('%7C')}`);
  }

  return `${GOOGLE_MAPS_DIRECTIONS_URL}?${params.join('&')}`;
}

export async function openRouteNavigation(input: {
  linking: StopNavigationLinking;
  route: AssignedRoute;
}): Promise<RouteNavigationResult> {
  const url = buildRouteNavigationUrl({ route: input.route });
  if (url === null) {
    return {
      kind: 'skipped',
      message: 'Route has no destinations to open in maps.',
      reason: 'missing_destination',
    };
  }

  try {
    await input.linking.openURL(url);
    const targetCount = buildRouteNavigationTargets(input.route).length;
    const openedStopCount = Math.min(targetCount, GOOGLE_MAPS_MAX_WAYPOINTS + 1);
    return {
      kind: 'opened',
      message: targetCount > openedStopCount
        ? `Opened the first ${formatStopCount(openedStopCount)} in Google Maps. Mobile links support up to 3 waypoints and 1 destination.`
        : `Opened ${formatStopCount(openedStopCount)} in the map app.`,
      url,
    };
  } catch {
    return {
      kind: 'failed',
      message: 'Map app could not be opened for this route.',
      reason: 'open_failed',
      url,
    };
  }
}

export function buildStopNavigationUrl(input: {
  platform: StopNavigationPlatform;
  stop: AssignedRouteStop;
}): string | null {
  const target = buildStopNavigationTarget(input.stop);
  if (target === null) {
    return null;
  }

  const params = [
    'api=1',
    `destination=${encodeURIComponent(target.value)}`,
    'travelmode=driving',
    'dir_action=navigate',
  ];
  return `${GOOGLE_MAPS_DIRECTIONS_URL}?${params.join('&')}`;
}

export async function openStopNavigation(input: {
  linking: StopNavigationLinking;
  platform: StopNavigationPlatform;
  stop: AssignedRouteStop;
}): Promise<StopNavigationResult> {
  const url = buildStopNavigationUrl({ platform: input.platform, stop: input.stop });
  if (url === null) {
    return {
      kind: 'skipped',
      message: 'Stop has no coordinates or address to open in maps.',
      reason: 'missing_destination',
    };
  }

  try {
    await input.linking.openURL(url);
    const destination = buildStopNavigationTarget(input.stop)?.value ?? 'the stop location';
    return {
      kind: 'opened',
      message: `Google Maps navigation opened for ${destination}.`,
      url,
    };
  } catch {
    return {
      kind: 'failed',
      message: 'Google Maps navigation could not be opened for this stop.',
      reason: 'open_failed',
      url,
    };
  }
}

export function formatStopNavigationAddress(address: AssignedRouteAddress): string | null {
  if (address.address1.trim() === '') {
    return null;
  }

  const formatted = [
    address.address1,
    address.address2,
    address.city,
    address.province,
    normalizeCanadianPostalCode(address.postalCode, address.countryCode),
    address.countryCode,
  ]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');

  return formatted === '' ? null : formatted;
}

function normalizeCanadianPostalCode(postalCode: string, countryCode: string): string {
  const compact = postalCode.replace(/\s+/gu, '').toUpperCase();
  const country = countryCode.trim().toUpperCase();
  return (country === 'CA' || country === 'CAN') && /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/u.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : postalCode;
}

function formatCoordinatePair(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

function isValidCoordinatePair(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && (latitude !== 0 || longitude !== 0);
}

function buildRouteNavigationTargets(route: AssignedRoute): RouteNavigationTarget[] {
  const stopPointsById = new Map(
    route.routeStopPoints.map((point) => [point.deliveryStopId, point] as const),
  );

  return [...route.stops]
    .sort((left, right) => left.sequence - right.sequence)
    .map((stop) => {
      const stopPoint = stopPointsById.get(stop.deliveryStopId);
      const stopTarget = buildStopNavigationTarget(stop);
      if (stopTarget !== null) {
        return stopTarget;
      }

      const routeCoordinates = validLngLat(stopPoint?.inputCoordinates)
        ?? validLngLat(stopPoint?.snappedCoordinates);
      if (routeCoordinates !== null) {
        return { value: formatLngLatForDirections(routeCoordinates) };
      }

      return null;
    })
    .filter((target): target is RouteNavigationTarget => target !== null);
}

function buildStopNavigationTarget(stop: AssignedRouteStop): RouteNavigationTarget | null {
  const address = formatStopNavigationAddress(stop.address);
  const coordinates = stopCoordinatesToLngLat(stop.coordinates);
  const coordinateTarget = coordinates === null
    ? null
    : { value: formatLngLatForDirections(coordinates) };
  const addressTarget = address === null ? null : { value: address };

  return stop.navigationTarget === 'ADDRESS'
    ? addressTarget ?? coordinateTarget
    : coordinateTarget ?? addressTarget;
}

function stopCoordinatesToLngLat(coordinates: AssignedRouteStop['coordinates']): AssignedRouteLngLat | null {
  return coordinates !== null && isValidCoordinatePair(coordinates.latitude, coordinates.longitude)
    ? [coordinates.longitude, coordinates.latitude]
    : null;
}

function validLngLat(coordinates: AssignedRouteLngLat | null | undefined): AssignedRouteLngLat | null {
  return coordinates !== null
    && coordinates !== undefined
    && isValidCoordinatePair(coordinates[1], coordinates[0])
    ? coordinates
    : null;
}

function formatLngLatForDirections(coordinates: AssignedRouteLngLat): string {
  return formatCoordinatePair(coordinates[1], coordinates[0]);
}

function formatStopCount(stopCount: number): string {
  return `${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`;
}
