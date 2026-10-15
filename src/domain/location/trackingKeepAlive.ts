import type { ContinuousLocationTaskResult } from './continuousLocationTask';

/** A route the server ended keeps the service running this long for the driver to confirm. */
export const SERVER_ENDED_ACK_GRACE_MS = 30 * 60 * 1000;

/**
 * After Start tracking is never turned off by the app on its own: when the server ended or revoked
 * the route, the service keeps running, says so in its notification and stops after the driver confirms.
 */
export function decideServiceAfterTaskResult(input: {
  now: number;
  result: ContinuousLocationTaskResult;
  serverEndedAt: number | null;
}): { action: 'keep' | 'stop_if_inactive'; notifyServerEnded: boolean; serverEndedAt: number | null } {
  const { now, result, serverEndedAt } = input;
  if (result.kind === 'processed') return { action: 'keep', notifyServerEnded: false, serverEndedAt: null };
  if (result.kind === 'deactivated' && result.reason !== 'pre_start_ended') {
    return { action: 'keep', notifyServerEnded: serverEndedAt === null, serverEndedAt: serverEndedAt ?? now };
  }
  if (serverEndedAt !== null && now - serverEndedAt < SERVER_ENDED_ACK_GRACE_MS) {
    return { action: 'keep', notifyServerEnded: false, serverEndedAt };
  }
  return { action: 'stop_if_inactive', notifyServerEnded: false, serverEndedAt: null };
}
