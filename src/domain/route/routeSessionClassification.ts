export type RouteSessionStatus = 'active' | 'completed' | 'ready';

export type RouteSessionClassificationRoute = {
  deliveryDate: string;
  id: string;
  timezone: string;
};

export type RouteSessionClassificationInput = {
  now: Date;
  route: RouteSessionClassificationRoute;
  selectedRouteId: string | null;
  selectedRouteStatus: RouteSessionStatus;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function classifyAssignedRouteSession(input: RouteSessionClassificationInput): RouteSessionStatus {
  if (
    input.route.id === input.selectedRouteId &&
    (input.selectedRouteStatus === 'active' || input.selectedRouteStatus === 'completed')
  ) {
    return input.selectedRouteStatus;
  }

  if (isRouteLocalPastDate({
    deliveryDate: input.route.deliveryDate,
    now: input.now,
    timezone: input.route.timezone,
  })) {
    return 'ready';
  }

  return 'ready';
}

export function filterVisibleAssignedRouteSessions<T extends { route: RouteSessionClassificationRoute }>(
  sessions: T[],
  input: Omit<RouteSessionClassificationInput, 'route'> & { selectedTab: RouteSessionStatus },
): T[] {
  return sessions.filter((session) => classifyAssignedRouteSession({
    now: input.now,
    route: session.route,
    selectedRouteId: input.selectedRouteId,
    selectedRouteStatus: input.selectedRouteStatus,
  }) === input.selectedTab);
}

export function getInitialAssignedRouteTab(input: {
  now: Date;
  route: RouteSessionClassificationRoute;
}): RouteSessionStatus {
  return classifyAssignedRouteSession({
    now: input.now,
    route: input.route,
    selectedRouteId: null,
    selectedRouteStatus: 'ready',
  });
}

function isRouteLocalPastDate(input: { deliveryDate: string; now: Date; timezone: string }): boolean {
  if (!DATE_ONLY_PATTERN.test(input.deliveryDate)) {
    return false;
  }

  return input.deliveryDate < getDateKeyInTimezone(input.now, input.timezone);
}

function getDateKeyInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const year = findDatePart(parts, 'year');
  const month = findDatePart(parts, 'month');
  const day = findDatePart(parts, 'day');
  return `${year}-${month}-${day}`;
}

function findDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '00';
}
