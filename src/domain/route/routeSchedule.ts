export type RouteScheduleSession = {
  route: {
    deliveryDate: string;
    timezone?: string | null;
  };
};

type RouteScheduleEntry<Session extends RouteScheduleSession> = {
  deliveryDateKey: string;
  originalIndex: number;
  session: Session;
};

export function getCurrentAndFutureRouteSessions<Session extends RouteScheduleSession>(
  sessions: readonly Session[],
  input: { now: Date },
): Session[] {
  return sessions
    .map((session, originalIndex): RouteScheduleEntry<Session> | null => {
      const deliveryDateKey = normalizeDeliveryDateKey(session.route.deliveryDate);
      if (deliveryDateKey === null) {
        return null;
      }

      const todayKey = getTodayKeyForRoute(session, input.now);
      if (deliveryDateKey < todayKey) {
        return null;
      }

      return {
        deliveryDateKey,
        originalIndex,
        session,
      };
    })
    .filter((entry): entry is RouteScheduleEntry<Session> => entry !== null)
    .sort((left, right) => left.deliveryDateKey.localeCompare(right.deliveryDateKey) || left.originalIndex - right.originalIndex)
    .map((entry) => entry.session);
}

function getTodayKeyForRoute(session: RouteScheduleSession, now: Date): string {
  const timezone = session.route.timezone?.trim();
  if (timezone === undefined || timezone.length === 0) {
    return toLocalDateKey(now);
  }

  return toTimezoneDateKey(now, timezone) ?? toLocalDateKey(now);
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

function toLocalDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
