import {
  formatAssignedRouteEta,
  formatAssignedRoutePaymentSummary,
  isAssignedRoutePickupStop,
  type AssignedRoute,
  type AssignedRoutePaymentSummary,
  type AssignedRouteStop,
} from '../domain/route/assignedRoute';
import type { ContinuousLocationNotificationContent } from '../domain/location/continuousLocationStream';

const ACTIVE_ROUTE_NOTIFICATION_URL_PREFIX = 'clever-routes://route-stop?';
const CUSTOMER_NOTE_MAX_LENGTH = 72;
const EXPANDED_CUSTOMER_NOTE_MAX_LENGTH = 160;

export type ActiveRouteNotificationTarget = {
  action?: 'add_proof' | 'next_stop';
  deliveryStopId: string;
  routePlanId: string;
};

export type ActiveRouteNotificationOperationalState = {
  alert: string;
  device: string;
  gps: string;
  route: string;
  server: string;
  sync: string;
};

export function buildActiveRouteForegroundNotification(input: {
  currentStepIndex: number;
  operationalState: ActiveRouteNotificationOperationalState;
  route: AssignedRoute;
}): ContinuousLocationNotificationContent {
  if (input.currentStepIndex <= 0) {
    return {
      body: 'Open CLEVER Routes to confirm pickup before the first delivery stop.',
      expandedBody: formatOperationalNotificationLines(input.operationalState).join('\n'),
      title: 'Pickup & Start Route',
    };
  }

  const stopIndex = Math.max(0, input.currentStepIndex - 1);
  const stop = input.route.stops[stopIndex] ?? input.route.stops[0] ?? null;
  if (stop === null) {
    return {
      body: 'Open CLEVER Routes for route details.',
      expandedBody: formatOperationalNotificationLines(input.operationalState).join('\n'),
      title: 'Route in progress',
    };
  }

  const eta = formatAssignedRouteEta(stop.estimatedArrivalAt, input.route.timezone);
  const address = formatNotificationAddress(stop);
  const itemTypeCount = stop.items.length;
  const itemCount = stop.items.reduce((total, item) => total + item.quantity, 0);
  const itemSummary = formatItemSummary(itemTypeCount, itemCount);
  const customerNote = truncateNotificationText(stop.customerNote);
  const payment = formatAssignedRoutePaymentSummary(stop);
  const isPickupStop = isAssignedRoutePickupStop(stop);
  const paymentLines = isPickupStop
    ? ['Order type: Pickup']
    : [
      `Status: ${payment.status.label}`,
      `Total: ${payment.amountLabel}`,
    ];
  const body = [
    address,
    ...paymentLines,
    customerNote === null ? null : `Customer note: ${customerNote}`,
    `Items ${itemSummary}`,
  ].filter((value): value is string => value !== null).join('\n');

  return {
    body,
    expandedBody: [formatExpandedNotificationBody({
      address,
      customerNote: stop.customerNote,
      itemCount,
      itemTypeCount,
      isPickupStop,
      payment,
    }), ...formatOperationalNotificationLines(input.operationalState)].join('\n'),
    title: `Next stop ${stop.sequence}${eta === null ? '' : `  ETA ${eta}`}`,
    url: buildActiveRouteNotificationUrl({
      deliveryStopId: stop.deliveryStopId,
      routePlanId: input.route.id,
    }, true),
  };
}

function formatOperationalNotificationLines(state: ActiveRouteNotificationOperationalState): string[] {
  return [
    `Alert: ${state.alert}`,
    `Route: ${state.route}`,
    `GPS: ${state.gps}`,
    `Device: ${state.device}`,
    `Server: ${state.server}`,
    `Sync: ${state.sync}`,
  ];
}

export function buildActiveRouteNotificationUrl(target: ActiveRouteNotificationTarget, showStopActions = false): string {
  return `clever-routes://route-stop?routePlanId=${encodeURIComponent(target.routePlanId)}&deliveryStopId=${encodeURIComponent(target.deliveryStopId)}${showStopActions ? '&showStopActions=true' : ''}`;
}

export function parseActiveRouteNotificationUrl(value: string): ActiveRouteNotificationTarget | null {
  try {
    if (!value.startsWith(ACTIVE_ROUTE_NOTIFICATION_URL_PREFIX) || value.includes('#')) {
      return null;
    }
    const searchParams = new URLSearchParams(value.slice(ACTIVE_ROUTE_NOTIFICATION_URL_PREFIX.length));
    const routePlanId = searchParams.get('routePlanId')?.trim() ?? '';
    const deliveryStopId = searchParams.get('deliveryStopId')?.trim() ?? '';
    const action = searchParams.get('action');
    if (routePlanId === '' || deliveryStopId === '') {
      return null;
    }
    if (action !== null && action !== 'add_proof' && action !== 'next_stop') {
      return null;
    }
    return {
      ...(action === null ? {} : { action }),
      deliveryStopId,
      routePlanId,
    };
  } catch {
    return null;
  }
}

export function isActiveRouteNotificationTargetCurrent(input: {
  activeRoutePlanId: string | null;
  completedStopIds: string[];
  currentStepIndex: number;
  route: Pick<AssignedRoute, 'id' | 'stops'> | null;
  target: ActiveRouteNotificationTarget;
}): boolean {
  if (
    input.route === null
    || input.currentStepIndex <= 0
    || input.activeRoutePlanId !== input.target.routePlanId
    || input.route.id !== input.target.routePlanId
    || input.completedStopIds.includes(input.target.deliveryStopId)
  ) {
    return false;
  }

  return input.route.stops[input.currentStepIndex - 1]?.deliveryStopId === input.target.deliveryStopId;
}

function formatItemSummary(itemTypeCount: number, itemCount: number): string {
  return `${itemTypeCount} ${itemTypeCount === 1 ? 'type' : 'types'}, ${itemCount} EA`;
}

function formatNotificationAddress(stop: AssignedRouteStop): string {
  const street = stop.address.address1.trim();
  const city = stop.address.city.trim();
  if (street === '') {
    return city || 'Address unavailable';
  }
  if (city === '' || street.toLocaleLowerCase().includes(city.toLocaleLowerCase())) {
    return street;
  }
  return `${street}, ${city}`;
}

function formatExpandedNotificationBody(input: {
  address: string;
  customerNote: string | null | undefined;
  itemCount: number;
  itemTypeCount: number;
  isPickupStop: boolean;
  payment: AssignedRoutePaymentSummary;
}): string {
  const note = truncateNotificationText(input.customerNote, EXPANDED_CUSTOMER_NOTE_MAX_LENGTH) ?? 'None';
  return [
    input.address,
    ...(input.isPickupStop
      ? ['Order type', 'Pickup']
      : [
        'Status',
        input.payment.status.label,
        'Total',
        input.payment.amountLabel,
      ]),
    'Customer note',
    note,
    'Items',
    formatItemSummary(input.itemTypeCount, input.itemCount),
  ].join('\n');
}

function truncateNotificationText(
  value: string | null | undefined,
  maxLength = CUSTOMER_NOTE_MAX_LENGTH,
): string | null {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const clipped = normalized.slice(0, maxLength - 1).trimEnd();
  const lastSpaceIndex = clipped.lastIndexOf(' ');
  const wordSafeClip = lastSpaceIndex >= Math.floor(maxLength * 0.6)
    ? clipped.slice(0, lastSpaceIndex)
    : clipped;
  return `${wordSafeClip}…`;
}
