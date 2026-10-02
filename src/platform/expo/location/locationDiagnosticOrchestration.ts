import type { ContinuousLocationTaskResult } from '../../../domain/location/continuousLocationTask';
import { runBoundedAsyncOperation } from '../../../domain/async/boundedAsyncOperation';
import type { DriverDiagnosticEmitter } from '../../../domain/diagnostics/driverDiagnosticObservation';

export type LocationDiagnosticObservation =
  | {
      callbackAt: string;
      collectedAt?: string;
      type: 'LOCATION_TASK_CALLBACK';
    }
  | {
      operation: 'ENSURE' | 'START' | 'STOP';
      phase: 'ATTEMPT' | 'ERROR' | 'SUCCESS';
      type: 'LOCATION_TASK_OPERATION';
    }
  | {
      reason: 'COMPLETION_PENDING' | 'INACTIVE_ROUTE';
      type: 'LOCATION_TASK_EXPECTED_STOP';
    }
  | {
      reason: 'ROUTE_NOT_IN_PROGRESS' | 'ROUTE_REVOKED';
      routePlanId: string;
      sessionGeneration: string;
      type: 'LOCATION_TASK_CONTEXT_BLOCKED';
    }
  | {
      queuedCount?: number;
      recordedCount: number;
      routePlanId: string;
      type: 'LOCATION_TASK_PROCESSED';
    }
  | { type: 'LOCATION_TASK_PROCESSING_TIMEOUT' };

type ObserveLocationDiagnostic = (observation: LocationDiagnosticObservation) => void;

const LOCATION_DIAGNOSTIC_PROBE_TIMEOUT_MS = 5_000;

export async function probeLocationDiagnosticStates(input: {
  emit: DriverDiagnosticEmitter;
  getBackgroundPermission(): Promise<{ granted: boolean }>;
  getForegroundPermission(): Promise<{ granted: boolean }>;
  getServicesEnabled(): Promise<boolean>;
  getTaskStarted(): Promise<boolean>;
}): Promise<void> {
  const bounded = <T>(operation: () => Promise<T>) => runBoundedAsyncOperation(
    operation,
    { timeoutMs: LOCATION_DIAGNOSTIC_PROBE_TIMEOUT_MS },
  );
  const [permission, service, task] = await Promise.allSettled([
    bounded(async () => {
      const [foreground, background] = await Promise.all([
        input.getForegroundPermission(),
        input.getBackgroundPermission(),
      ]);
      return { background, foreground };
    }),
    bounded(input.getServicesEnabled),
    bounded(input.getTaskStarted),
  ]);

  if (permission.status === 'fulfilled') {
    const status = permission.value.background.granted
      ? 'GRANTED_ALWAYS'
      : permission.value.foreground.granted
        ? 'GRANTED_FOREGROUND'
        : 'DENIED';
    input.emit({
      ...(status === 'DENIED'
        ? { blocker: { reasonCode: 'LOCATION_PERMISSION_DENIED' as const, stage: 'LOCATION' as const } }
        : {}),
      clearReasonCodes: status === 'DENIED'
        ? ['LOCATION_PERMISSION_STATUS_FAILED']
        : ['LOCATION_PERMISSION_DENIED', 'LOCATION_PERMISSION_STATUS_FAILED'],
      kind: 'STATE',
      patch: { locationPermission: status },
    });
  } else {
    input.emit({
      blocker: { reasonCode: 'LOCATION_PERMISSION_STATUS_FAILED', stage: 'LOCATION' },
      kind: 'STATE',
      patch: { locationPermission: 'UNKNOWN' },
    });
  }

  if (service.status === 'fulfilled') {
    input.emit({
      ...(service.value
        ? {}
        : { blocker: { reasonCode: 'LOCATION_SERVICES_DISABLED' as const, stage: 'LOCATION' as const } }),
      clearReasonCodes: service.value
        ? ['LOCATION_SERVICES_DISABLED', 'LOCATION_SERVICE_STATUS_FAILED']
        : ['LOCATION_SERVICE_STATUS_FAILED'],
      kind: 'STATE',
      patch: { locationService: service.value ? 'ENABLED' : 'DISABLED' },
    });
  } else {
    input.emit({
      blocker: { reasonCode: 'LOCATION_SERVICE_STATUS_FAILED', stage: 'LOCATION' },
      kind: 'STATE',
      patch: { locationService: 'UNKNOWN' },
    });
  }

  if (task.status === 'fulfilled') {
    input.emit({
      clearReasonCodes: ['LOCATION_TASK_ERROR', 'LOCATION_TASK_STATUS_FAILED'],
      kind: 'STATE',
      patch: { locationTask: task.value ? 'STARTED' : 'STOPPED' },
    });
  } else {
    input.emit({
      blocker: { reasonCode: 'LOCATION_TASK_STATUS_FAILED', stage: 'LOCATION' },
      kind: 'STATE',
      patch: { locationTask: 'UNKNOWN' },
    });
  }
}

export function observeLocationTaskCallback(input: {
  callbackAt: Date;
  locationTimestamps: readonly number[];
  observe: ObserveLocationDiagnostic;
}): void {
  const validTimestamps = input.locationTimestamps.filter((value) => (
    Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
  ));
  const newestTimestamp = validTimestamps.length === 0 ? undefined : Math.max(...validTimestamps);
  input.observe({
    callbackAt: input.callbackAt.toISOString(),
    ...(newestTimestamp === undefined ? {} : { collectedAt: new Date(newestTimestamp).toISOString() }),
    type: 'LOCATION_TASK_CALLBACK',
  });
}

export async function runObservedLocationOperation<T>(input: {
  execute: () => Promise<T>;
  observe: ObserveLocationDiagnostic;
  operation: 'ENSURE' | 'START' | 'STOP';
}): Promise<T> {
  input.observe({ operation: input.operation, phase: 'ATTEMPT', type: 'LOCATION_TASK_OPERATION' });
  try {
    const result = await input.execute();
    input.observe({ operation: input.operation, phase: 'SUCCESS', type: 'LOCATION_TASK_OPERATION' });
    return result;
  } catch (error) {
    input.observe({ operation: input.operation, phase: 'ERROR', type: 'LOCATION_TASK_OPERATION' });
    throw error;
  }
}

export function startLocationTaskProcessingWatchdog(input: {
  cancel?: (handle: unknown) => void;
  observe: ObserveLocationDiagnostic;
  schedule?: (run: () => void, timeoutMs: number) => unknown;
  timeoutMs?: number;
}): { complete(): void } {
  const cancel = input.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const schedule = input.schedule ?? ((run, timeoutMs) => setTimeout(run, timeoutMs));
  let completed = false;
  const handle = schedule(() => {
    if (!completed) input.observe({ type: 'LOCATION_TASK_PROCESSING_TIMEOUT' });
  }, input.timeoutMs ?? 15_000);
  return {
    complete: () => {
      if (completed) return;
      completed = true;
      cancel(handle);
    },
  };
}

export function observeLocationTaskResult(
  result: ContinuousLocationTaskResult,
  observe: ObserveLocationDiagnostic,
): void {
  if (result.kind === 'processed') {
    observe({
      ...(result.queuedCount === undefined ? {} : { queuedCount: result.queuedCount }),
      recordedCount: result.recordedCount,
      routePlanId: result.routePlanId,
      type: 'LOCATION_TASK_PROCESSED',
    });
    return;
  }
  if (result.kind === 'ignored') {
    observe({
      reason: result.reason === 'completion_pending' ? 'COMPLETION_PENDING' : 'INACTIVE_ROUTE',
      type: 'LOCATION_TASK_EXPECTED_STOP',
    });
    return;
  }
  observe({
    reason: result.reason === 'route_not_in_progress' ? 'ROUTE_NOT_IN_PROGRESS' : 'ROUTE_REVOKED',
    routePlanId: result.routePlanId,
    sessionGeneration: result.sessionGeneration,
    type: 'LOCATION_TASK_CONTEXT_BLOCKED',
  });
}
