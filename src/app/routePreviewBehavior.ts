import type { AssignedRoute, AssignedRouteStop } from '../domain/route/assignedRoute';

export const ROUTE_PREVIEW_LABELS = {
  date: 'Date',
  distance: 'Distance',
  map: 'Map',
  region: 'Region',
  sequence: 'Sequence',
  stops: 'Stops',
  time: 'Time',
} as const;

export const ROUTE_PREVIEW_COPY = {
  mapAccessibilityLabel: 'Open large route map preview',
  title: 'Route Details',
} as const;

export const ROUTE_PREVIEW_ALLOWED_ACTIONS = [
  'Back',
  'Open large route map preview',
] as const;

export const ROUTE_PREVIEW_PROHIBITED_ACTION_LABELS = [
  'Start Session',
  'Continue Session',
  'Open in Map',
  'Arrived',
  'Find Next Stop',
  'Finish Route',
  'View Stop Details',
  'Map Preview',
  'Photo Proof',
  'Complete Stop',
  'Menu',
] as const;

export const ROUTE_PREVIEW_REQUIRED_FIELDS = [
  ROUTE_PREVIEW_LABELS.date,
  ROUTE_PREVIEW_LABELS.map,
  ROUTE_PREVIEW_LABELS.region,
  ROUTE_PREVIEW_LABELS.stops,
  ROUTE_PREVIEW_LABELS.distance,
  ROUTE_PREVIEW_LABELS.time,
  ROUTE_PREVIEW_LABELS.sequence,
] as const;

export const ROUTE_PREVIEW_SEQUENCE_LIMIT = 6;

export type RoutePreviewSequenceItem = {
  address: string;
  deliveryStopId: string;
  marker: string;
};

export type RoutePreviewSequence = {
  items: RoutePreviewSequenceItem[];
  overflowCount: number;
};

export function buildRoutePreviewRegionItems(route: Pick<AssignedRoute, 'stops' | 'timezone'>): string[] {
  const areas = uniqueNonEmpty(
    route.stops.map((stop) => formatRoutePreviewArea(stop)),
  );

  return areas.length === 0 ? [route.timezone] : areas;
}

export function buildRoutePreviewSequence(
  route: Pick<AssignedRoute, 'stops'>,
  limit = ROUTE_PREVIEW_SEQUENCE_LIMIT,
): RoutePreviewSequence {
  const safeLimit = Math.max(0, Math.floor(limit));
  const visibleStops = route.stops.slice(0, safeLimit);

  return {
    items: visibleStops.map((stop) => ({
      address: formatRoutePreviewStopAddress(stop),
      deliveryStopId: stop.deliveryStopId,
      marker: String(stop.sequence),
    })),
    overflowCount: Math.max(route.stops.length - visibleStops.length, 0),
  };
}

function formatRoutePreviewArea(stop: AssignedRouteStop): string {
  return [stop.address.city, stop.address.province]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

function formatRoutePreviewStopAddress(stop: AssignedRouteStop): string {
  const street = [stop.address.address1, stop.address.address2]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(', ');

  return street || `Stop ${stop.sequence}`;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
