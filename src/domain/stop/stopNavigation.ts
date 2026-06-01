import type { AssignedRouteAddress, AssignedRouteStop } from '../route/assignedRoute';

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

export function buildStopNavigationUrl(input: {
  platform: StopNavigationPlatform;
  stop: AssignedRouteStop;
}): string | null {
  const label = buildStopNavigationLabel(input.stop);
  const encodedLabel = encodeURIComponent(label);
  const coordinates = input.stop.coordinates;

  if (coordinates !== null) {
    const coordinatePair = formatCoordinatePair(coordinates.latitude, coordinates.longitude);
    if (input.platform === 'android') {
      return `geo:${coordinatePair}?q=${encodeURIComponent(coordinatePair)}(${encodedLabel})`;
    }

    if (input.platform === 'ios') {
      return `http://maps.apple.com/?ll=${coordinatePair}&q=${encodedLabel}`;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinatePair)}`;
  }

  const address = formatStopNavigationAddress(input.stop.address);
  if (address === null) {
    return null;
  }

  const encodedAddress = encodeURIComponent(address);
  if (input.platform === 'android') {
    return `geo:0,0?q=${encodedAddress}(${encodedLabel})`;
  }

  if (input.platform === 'ios') {
    return `http://maps.apple.com/?q=${encodedAddress}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
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
    return {
      kind: 'opened',
      message: `Map opened for ${buildStopNavigationLabel(input.stop)}.`,
      url,
    };
  } catch {
    return {
      kind: 'failed',
      message: `Map could not be opened for ${buildStopNavigationLabel(input.stop)}.`,
      reason: 'open_failed',
      url,
    };
  }
}

export function buildStopNavigationLabel(stop: AssignedRouteStop): string {
  return [`Stop ${stop.sequence}`, stop.orderName.trim()].filter(Boolean).join(' ');
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
