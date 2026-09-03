import { CONTINUOUS_LOCATION_TASK_NAME, type ContinuousLocationStreamService } from '../location/continuousLocationStream';
import type { DeliveryStartResult } from './deliveryStart';
import {
  formatDriverApiErrorForDriver,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import { prepareDriverEventForPersistence, type DriverEventService } from '../events/driverEvents';
import type { DriverFlowState } from '../driverFlow/driverFlow';
import type {
  OfflineCompletionClearOutboxEntry,
  OfflineSubmissionQueue,
} from '../offline/offlineSubmissionQueue';
import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';

export type DeliveryFinishResult =
  | {
      flowState: Exclude<DriverFlowState, 'delivery_finished'>;
      kind: 'blocked';
      message: string;
      reason: 'active_session_changed' | 'delivery_not_active';
    }
  | {
      discardedQueuedItems: number;
      duplicate: boolean;
      eventId: string;
      flowState: 'delivery_finished';
      kind: 'recorded';
      message: string;
      monitoringMode: 'stopped' | 'stopping';
      stoppedTaskName: string;
    }
  | {
      flowState: 'delivery_finished';
      kind: 'queued';
      message: string;
      queueItemId: string;
      reason: 'record_failed';
      requiresRouteLookup?: true;
      requiresRouteReconciliation?: true;
      stoppedTaskName: string;
      monitoringMode: 'reduced' | 'stopped' | 'stopping';
    };

export type DeliveryFinishPhaseTiming = {
  elapsedMs: number;
  phase:
    | 'event_persisted'
    | 'finish_resolved'
    | 'live_attempt_failed'
    | 'location_stop_failed'
    | 'location_stop_requested'
    | 'location_stopped'
    | 'route_session_deactivated'
    | 'server_acknowledged';
};

const ROUTE_END_LIVE_ATTEMPT_TIMEOUT_MS = 10_000;

export async function finishDeliveryAfterActive(input: {
  deactivateActiveRouteSession?: (completion: {
    clientEventId: string;
    occurredAt: string;
    routeEnd: 'completed' | 'released';
  }) => Promise<boolean>;
  deliveryStart: DeliveryStartResult;
  driverEventAttemptCancelTimeout?: (handle: unknown) => void;
  driverEventAttemptScheduleTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  driverEventAttemptTimeoutMs?: number;
  driverEventService: DriverEventService;
  eventPayload?: Record<string, unknown>;
  now?: Date;
  offlineQueue?: OfflineSubmissionQueue;
  onServerAcknowledged?: (
    entry: OfflineCompletionClearOutboxEntry,
    signal: AbortSignal,
  ) => Promise<void>;
  onPhaseTiming?: (timing: DeliveryFinishPhaseTiming) => void;
  onServerAcknowledgedCancelTimeout?: (handle: unknown) => void;
  onServerAcknowledgedScheduleTimeout?: (expire: () => void, timeoutMs: number) => unknown;
  onServerAcknowledgedTimeoutMs?: number;
  routeEnd?: 'completed' | 'released';
  routePlanId: string | null;
  streamService: ContinuousLocationStreamService;
  taskName?: string;
}): Promise<DeliveryFinishResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      flowState: input.deliveryStart.flowState as Exclude<DriverFlowState, 'delivery_finished'>,
      kind: 'blocked',
      message: 'Delivery can be finished only after delivery_active.',
      reason: 'delivery_not_active',
    };
  }

  const occurredAt = input.now ?? new Date();
  const startedAtMs = Date.now();
  const reportPhase = (phase: DeliveryFinishPhaseTiming['phase']) => {
    try {
      input.onPhaseTiming?.({ elapsedMs: Math.max(0, Date.now() - startedAtMs), phase });
    } catch {
      // Diagnostic timing must never affect the durable route-end workflow.
    }
  };
  const routeReleased = input.routeEnd === 'released';
  const event = prepareDriverEventForPersistence(input.driverEventService, {
    clientEventId: createRouteEndClientEventId(occurredAt, routeReleased),
    eventType: routeReleased ? 'ROUTE_PAUSED' as const : 'ROUTE_COMPLETED' as const,
    occurredAt,
    ...(input.eventPayload === undefined ? {} : { payload: input.eventPayload }),
    routePlanId: input.routePlanId,
  });
  const preparedQueueItem = input.offlineQueue?.enqueueDriverEvent(event);
  if (preparedQueueItem !== undefined) {
    await input.offlineQueue?.whenPersisted();
  }
  reportPhase('event_persisted');

  if (
    input.deactivateActiveRouteSession !== undefined
    && !await input.deactivateActiveRouteSession({
      clientEventId: event.clientEventId,
      occurredAt: occurredAt.toISOString(),
      routeEnd: routeReleased ? 'released' : 'completed',
    })
  ) {
    if (preparedQueueItem !== undefined) {
      input.offlineQueue?.discard(preparedQueueItem.queueItemId);
      await input.offlineQueue?.whenPersisted();
    }
    return {
      flowState: input.deliveryStart.flowState,
      kind: 'blocked',
      message: 'This route is no longer the active tracking session. Refresh routes before finishing.',
      reason: 'active_session_changed',
    };
  }
  reportPhase('route_session_deactivated');

  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  const releaseLocationStop = {
    state: 'stopping' as 'failed' | 'stopped' | 'stopping',
  };
  if (routeReleased) {
    reportPhase('location_stop_requested');
    void (async () => {
      try {
        await input.streamService.stopLocationUpdates(taskName);
        releaseLocationStop.state = 'stopped';
        reportPhase('location_stopped');
      } catch {
        releaseLocationStop.state = 'failed';
        reportPhase('location_stop_failed');
      }
    })();
  }
  try {
    const result = await runBoundedAsyncOperation(
      (signal) => input.driverEventService.recordDriverEvent(event, { signal }),
      {
        ...(input.driverEventAttemptCancelTimeout === undefined
          ? {}
          : { cancel: input.driverEventAttemptCancelTimeout }),
        ...(input.driverEventAttemptScheduleTimeout === undefined
          ? {}
          : { schedule: input.driverEventAttemptScheduleTimeout }),
        timeoutMs: input.driverEventAttemptTimeoutMs ?? ROUTE_END_LIVE_ATTEMPT_TIMEOUT_MS,
      },
    );
    reportPhase('server_acknowledged');
    if (preparedQueueItem !== undefined) {
      input.offlineQueue?.acknowledge(preparedQueueItem.queueItemId);
    }
    const discardedQueuedItems = input.routePlanId === null || input.offlineQueue === undefined
      ? 0
      : input.offlineQueue.discardRouteSubmissions(input.routePlanId);
    await input.offlineQueue?.whenPersisted();
    if (!routeReleased && input.routePlanId !== null && preparedQueueItem !== undefined) {
      try {
        if (input.onServerAcknowledged !== undefined) {
          const completionClearEntry: OfflineCompletionClearOutboxEntry = {
            accountOwnerHash: preparedQueueItem.accountOwnerHash,
            assignmentGeneration: preparedQueueItem.event.assignmentGeneration ?? null,
            completionClientEventId: preparedQueueItem.event.clientEventId,
            driverContractVersion: preparedQueueItem.event.driverContractVersion ?? null,
            routePlanId: input.routePlanId,
          };
          await runBoundedAsyncOperation(
            (signal) => input.onServerAcknowledged!(completionClearEntry, signal),
            {
              ...(input.onServerAcknowledgedCancelTimeout === undefined
                ? {}
                : { cancel: input.onServerAcknowledgedCancelTimeout }),
              ...(input.onServerAcknowledgedScheduleTimeout === undefined
                ? {}
                : { schedule: input.onServerAcknowledgedScheduleTimeout }),
              timeoutMs: input.onServerAcknowledgedTimeoutMs ?? 15_000,
            },
          );
        }
      } catch {
        // The durable completion-clear outbox retries independently of route-session cleanup.
      }
    }
    if (!routeReleased) {
      await input.streamService.stopLocationUpdates(taskName);
      reportPhase('location_stopped');
    }
    reportPhase('finish_resolved');

    return {
      discardedQueuedItems,
      duplicate: result.duplicate,
      eventId: result.eventId,
      flowState: 'delivery_finished',
      kind: 'recorded',
      message: routeReleased
        ? 'Route session ended and the route returned to Ready.'
        : discardedQueuedItems > 0
        ? `Delivery finished. ${discardedQueuedItems} queued route submission${discardedQueuedItems === 1 ? '' : 's'} discarded after route completion was recorded.`
        : 'Delivery finished and route completion was recorded.',
      monitoringMode: routeReleased && releaseLocationStop.state !== 'stopped' ? 'stopping' : 'stopped',
      stoppedTaskName: taskName,
    };
  } catch (error) {
    reportPhase('live_attempt_failed');
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const requiresRouteReconciliation = getDriverApiRequiresRouteReconciliation(error);
    if (routeReleased && input.routePlanId !== null && requiresRouteReconciliation === undefined) {
      input.offlineQueue.discardRouteSubmissions(input.routePlanId);
    }
    const queued = input.offlineQueue.enqueueDriverEvent(event);
    if (input.routePlanId !== null && requiresRouteReconciliation === true) {
      input.offlineQueue.blockRouteSubmissionsForReconciliation(input.routePlanId);
    }
    await input.offlineQueue.whenPersisted();
    reportPhase('finish_resolved');
    return {
      flowState: 'delivery_finished',
      kind: 'queued',
      message: routeReleased
        ? `Route session ended locally and returning the route to Ready was queued for retry: ${formatDriverApiErrorForDriver(error)}`
        : `Delivery finished locally and route completion was queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
      ...(requiresRouteReconciliation === undefined
        ? {}
        : { requiresRouteReconciliation: true as const }),
      stoppedTaskName: taskName,
      monitoringMode: routeReleased
        ? releaseLocationStop.state === 'stopped'
          ? 'stopped'
          : releaseLocationStop.state === 'failed'
            ? 'reduced'
            : 'stopping'
        : 'reduced',
    };
  }
}

function createRouteEndClientEventId(occurredAt: Date, released: boolean): string {
  return `route-${released ? 'released' : 'completed'}-${occurredAt.getTime().toString(36)}`;
}
