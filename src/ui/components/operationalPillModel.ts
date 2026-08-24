import type { GpsOperationalState } from '../../domain/location/gpsOperationalState';
import type { RouteProgressProjection } from '../../domain/route/routeProgressProjection';

export type OperationalPillValues = {
  alert: string;
  device: string;
  deviceConflict?: boolean;
  gap: string;
  gps: string;
  route: string;
  server: string;
  sync: string;
};

export function buildDriverOperationalPillValues(input: {
  activeRoutePlanId: string | null;
  backgroundLocationGranted: boolean;
  completionQueued: boolean;
  currentStopSequence: number | null;
  deviceConflict: boolean;
  gpsOperationalState: GpsOperationalState;
  hasDurablePendingRouteEnd: boolean;
  hasReconciliation: boolean;
  offlineQueueCount: number;
  offlineStorageState: 'READY' | 'STORAGE_DEGRADED';
  routeProgress: RouteProgressProjection;
  routeReconciliationCount: number;
  routeSyncReady: boolean;
}): OperationalPillValues {
  const hasRouteProgress = input.routeProgress.totalStops > 0;
  const localProgress = `${input.routeProgress.localCompletedCount}/${input.routeProgress.totalStops}`;
  const serverProgress = `${input.routeProgress.serverConfirmedCount}/${input.routeProgress.totalStops}`;
  const progressDelta = input.routeProgress.localCompletedCount - input.routeProgress.serverConfirmedCount;
  const progressGap = input.routeProgress.syncState === 'confirmed'
    ? '0 stops'
    : progressDelta > 0
      ? `${progressDelta} stops`
      : progressDelta < 0
        ? `Server ahead ${Math.abs(progressDelta)} ${Math.abs(progressDelta) === 1 ? 'stop' : 'stops'}`
        : 'Stop mismatch';
  return {
    alert: input.routeReconciliationCount > 0 ? 'Action needed' : 'None',
    device: hasRouteProgress
      ? input.deviceConflict ? `Conflict (${localProgress})` : localProgress
      : input.deviceConflict ? 'Conflict' : 'This device',
    deviceConflict: input.deviceConflict,
    gap: progressGap,
    gps: input.backgroundLocationGranted
      ? formatGpsOperationalPill(input.gpsOperationalState, input.currentStopSequence)
      : 'Unavailable',
    route: input.hasReconciliation
      ? 'Reconciliation'
      : input.hasDurablePendingRouteEnd || input.completionQueued
        ? 'Completion pending'
        : input.activeRoutePlanId === null ? 'Ready' : 'Active',
    server: hasRouteProgress ? serverProgress : input.routeSyncReady ? 'Connected' : 'Unavailable',
    sync: input.offlineStorageState === 'STORAGE_DEGRADED'
      ? 'Storage blocked'
      : input.routeProgress.syncState === 'blocked' ? 'Blocked' : `${input.offlineQueueCount} pending`,
  };
}

export function buildOperationalPills(values: OperationalPillValues) {
  return [
    { label: 'Alert', value: values.alert },
    { label: 'Route', value: values.route },
    { label: 'GPS', value: values.gps },
    { label: 'Device', value: values.device },
    { label: 'Server', value: values.server },
    { label: 'Sync', value: values.sync },
    { label: 'Gap', value: values.gap },
  ] as const;
}

function formatGpsOperationalPill(state: GpsOperationalState, currentStopSequence: number | null): string {
  if (state.freshness === 'unknown') return 'Waiting';
  if (state.freshness === 'stale') return 'Stale';
  if (state.accuracy === 'poor') return 'Low accuracy';
  if (state.proximity === 'within') {
    return currentStopSequence === null ? 'Near stop' : `Near stop ${currentStopSequence}`;
  }
  return state.freshness === 'aging' ? 'Aging' : 'Fresh';
}
