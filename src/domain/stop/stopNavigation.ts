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

export function buildRouteNavigationUrl(input: {
  route: AssignedRoute;
}): string | null {
  const targets = buildRouteNavigationTargets(input.route);
  if (targets.length === 0) {
    return null;
  }

  const destination = targets[targets.length - 1]!;
  const waypoints = targets.slice(0, -1);
  const params = [
    'api=1',
    'travelmode=driving',
    'dir_action=navigate',
    `destination=${encodeURIComponent(destination.value)}`,
  ];

  if (waypoints.length > 0) {
    params.push(`waypoints=${waypoints.map((target) => encodeURIComponent(target.value)).join('%7C')}`);
  }

  return `https://www.google.com/maps/dir/?${params.join('&')}`;
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
    return {
      kind: 'opened',
      message: `Opened ${formatStopCount(input.route.stops.length)} in the map app.`,
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
  const address = formatStopNavigationAddress(input.stop.address);
  if (address !== null) {
    const encodedAddress = encodeURIComponent(address);
    if (input.platform === 'android') {
      return `geo:0,0?q=${encodedAddress}`;
    }

    if (input.platform === 'ios') {
      return `http://maps.apple.com/?q=${encodedAddress}`;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  }

  const coordinates = input.stop.coordinates;
  if (coordinates === null) {
    return null;
  }

  const coordinatePair = formatCoordinatePair(coordinates.latitude, coordinates.longitude);
  if (input.platform === 'android') {
    return `geo:${coordinatePair}?q=${encodeURIComponent(coordinatePair)}`;
  }

  if (input.platform === 'ios') {
    return `http://maps.apple.com/?ll=${coordinatePair}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinatePair)}`;
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
    const destination = formatStopNavigationAddress(input.stop.address)
      ?? (input.stop.coordinates === null
        ? 'the stop location'
        : formatCoordinatePair(input.stop.coordinates.latitude, input.stop.coordinates.longitude));
    return {
      kind: 'opened',
      message: `Map search opened for ${destination}.`,
      url,
    };
  } catch {
    return {
      kind: 'failed',
      message: 'Map search could not be opened for this address.',
      reason: 'open_failed',
      url,
    };
  }
}

export function formatStopNavigationAddress(address: AssignedRouteAddress): string | null {
  const formatted = [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.postalCode,
    address.countryCode,
  ]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');

  return formatted === '' ? null : formatted;
}

function formatCoordinatePair(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

function buildRouteNavigationTargets(route: AssignedRoute): RouteNavigationTarget[] {
  const stopPointsById = new Map(
    route.routeStopPoints.map((point) => [point.deliveryStopId, point] as const),
  );

  return [...route.stops]
    .sort((left, right) => left.sequence - right.sequence)
    .map((stop) => {
      const address = formatStopNavigationAddress(stop.address);
      if (address !== null) {
        return { value: address };
      }

      const stopPoint = stopPointsById.get(stop.deliveryStopId);
      const coordinates = stopPoint?.snappedCoordinates ?? stopPoint?.inputCoordinates ?? stopCoordinatesToLngLat(stop.coordinates);
      if (coordinates !== null) {
        return { value: formatLngLatForDirections(coordinates) };
      }

      return null;
    })
    .filter((target): target is RouteNavigationTarget => target !== null);
}

function stopCoordinatesToLngLat(coordinates: AssignedRouteStop['coordinates']): AssignedRouteLngLat | null {
  return coordinates === null ? null : [coordinates.longitude, coordinates.latitude];
}

function formatLngLatForDirections(coordinates: AssignedRouteLngLat): string {
  return formatCoordinatePair(coordinates[1], coordinates[0]);
}

function formatStopCount(stopCount: number): string {
  return `${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`;
}
