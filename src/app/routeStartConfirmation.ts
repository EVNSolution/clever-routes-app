export const ROUTE_START_SESSION_CONFIRMATION = {
  title: 'Start this session?',
  baseMessage:
    'This opens the route session for the selected delivery. Pickup completion stays inside the session workflow.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Start Session',
} as const;

export type RouteStartConfirmationRoute = {
  deliveryDate: string;
  timezone: string;
};

type RouteStartConfirmationButton = {
  onPress?: () => void;
  style?: 'cancel' | 'default';
  text: string;
};

type RouteStartConfirmationAlert = {
  alert(
    title: string,
    message: string,
    buttons: RouteStartConfirmationButton[],
    options: { cancelable: boolean },
  ): void;
};

export function requestRouteStartSessionConfirmation(input: {
  alertApi: RouteStartConfirmationAlert;
  now?: Date;
  onConfirm(): void;
  route: RouteStartConfirmationRoute;
}): void {
  input.alertApi.alert(
    ROUTE_START_SESSION_CONFIRMATION.title,
    buildRouteStartSessionConfirmationMessage(
      input.route,
      input.now ?? new Date(),
    ),
    [
      { text: ROUTE_START_SESSION_CONFIRMATION.cancelLabel, style: 'cancel' },
      {
        text: ROUTE_START_SESSION_CONFIRMATION.confirmLabel,
        style: 'default',
        onPress: input.onConfirm,
      },
    ],
    { cancelable: true },
  );
}

export function buildRouteStartSessionConfirmationMessage(
  route: RouteStartConfirmationRoute,
  now: Date,
): string {
  const warning = getRouteDateWarning(route, now);
  return warning === null
    ? ROUTE_START_SESSION_CONFIRMATION.baseMessage
    : `${ROUTE_START_SESSION_CONFIRMATION.baseMessage}\n\n${warning}`;
}

function getRouteDateWarning(
  route: RouteStartConfirmationRoute,
  now: Date,
): string | null {
  const routeDateKey = normalizeDeliveryDateKey(route.deliveryDate);
  if (routeDateKey === null) {
    return null;
  }

  const todayKey = getTodayKeyForRoute(route.timezone, now);
  if (routeDateKey < todayKey) {
    return `Warning: this route date has already passed (${route.deliveryDate}). Start only if dispatch asked you to continue this session.`;
  }

  if (routeDateKey > todayKey) {
    return `Warning: this delivery is scheduled for a different day (${route.deliveryDate}). Start only if dispatch asked you to begin this session now.`;
  }

  return null;
}

function normalizeDeliveryDateKey(deliveryDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(deliveryDate.trim());
  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getTodayKeyForRoute(timezone: string, now: Date): string {
  const trimmedTimezone = timezone.trim();
  if (trimmedTimezone.length > 0) {
    const timezoneKey = toTimezoneDateKey(now, trimmedTimezone);
    if (timezoneKey !== null) {
      return timezoneKey;
    }
  }

  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function toTimezoneDateKey(date: Date, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone,
      year: 'numeric',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (year === undefined || month === undefined || day === undefined) {
      return null;
    }

    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}
