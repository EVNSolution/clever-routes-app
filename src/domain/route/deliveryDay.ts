/** True when the route's delivery date is today's calendar date in the route's timezone (device timezone when unknown). */
export function isDeliveryDateToday(deliveryDate: string, timezone: string | null | undefined, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(deliveryDate)) return false;
  return formatCalendarDate(now, timezone) === deliveryDate;
}

function formatCalendarDate(date: Date, timezone: string | null | undefined): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
      year: 'numeric',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? '';
    const formatted = `${part('year')}-${part('month')}-${part('day')}`;
    return /^\d{4}-\d{2}-\d{2}$/u.test(formatted) ? formatted : null;
  } catch {
    return null;
  }
}
