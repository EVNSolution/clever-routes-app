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
