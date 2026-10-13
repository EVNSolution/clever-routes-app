export const GPS_CHECK_PUSH_TYPE = 'driver_gps_check';
/** Handling the same silent gap again sooner than this is skipped. */
export const GPS_CHECK_MIN_INTERVAL_MS = 15_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type GpsCheckPush = {
  pushId: string;
  routePlanId: string;
  sentAt: string;
  severity: 'CRITICAL' | 'WARNING';
  silentSeconds: number;
};

export function parseGpsCheckPush(data: Record<string, unknown> | null | undefined): GpsCheckPush | null {
  if (data === null || data === undefined || data.type !== GPS_CHECK_PUSH_TYPE) return null;
  const { pushId, routePlanId, sentAt, severity, silentSeconds } = data;
  if (typeof pushId !== 'string' || !UUID_PATTERN.test(pushId)) return null;
  if (typeof routePlanId !== 'string' || routePlanId.trim() === '') return null;
  if (typeof sentAt !== 'string' || Number.isNaN(Date.parse(sentAt))) return null;
  if (severity !== 'WARNING' && severity !== 'CRITICAL') return null;
  const seconds = typeof silentSeconds === 'string' && /^\d+$/u.test(silentSeconds) ? Number(silentSeconds) : null;
  if (seconds === null) return null;
  return { pushId, routePlanId, sentAt, severity, silentSeconds: seconds };
}

export type GpsCheckDecision =
  | { action: 'ignore'; reason: 'duplicate' | 'no_active_route' | 'no_consent' | 'route_mismatch' | 'too_soon' }
  | { action: 'restart_task' }
  | { action: 'send_location_now' };

export function decideGpsCheck(input: {
  activeRoutePlanId: string | null;
  backgroundGranted: boolean;
  lastHandled: { at: number; pushId: string } | null;
  nowMs: number;
  push: GpsCheckPush;
  taskStarted: boolean;
}): GpsCheckDecision {
  if (input.activeRoutePlanId === null) return { action: 'ignore', reason: 'no_active_route' };
  if (input.activeRoutePlanId !== input.push.routePlanId) return { action: 'ignore', reason: 'route_mismatch' };
  if (!input.backgroundGranted) return { action: 'ignore', reason: 'no_consent' };
  if (input.lastHandled?.pushId === input.push.pushId) return { action: 'ignore', reason: 'duplicate' };
  if (input.lastHandled !== null && input.nowMs - input.lastHandled.at < GPS_CHECK_MIN_INTERVAL_MS) {
    return { action: 'ignore', reason: 'too_soon' };
  }
  return input.taskStarted ? { action: 'send_location_now' } : { action: 'restart_task' };
}
