import { CONTINUOUS_LOCATION_TASK_NAME, type ContinuousLocationStreamService } from '../location/continuousLocationStream';
import type { DeliveryStartResult } from './deliveryStart';
import {
  formatDriverApiErrorForDriver,
  getDriverApiRequiresRouteLookup,
  getDriverApiRequiresRouteReconciliation,
} from '../../api/deliveryServer/driverApiError';
import type { DriverEventService } from '../events/driverEvents';
import type { DriverFlowState } from '../driverFlow/driverFlow';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

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
      monitoringMode: 'stopped';
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
      monitoringMode: 'reduced';
    };

export async function finishDeliveryAfterActive(input: {
  deactivateActiveRouteSession?: (completion: {
    clientEventId: string;
    occurredAt: string;
    routeEnd: 'completed' | 'released';
  }) => Promise<boolean>;
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  eventPayload?: Record<string, unknown>;
  now?: Date;
  offlineQueue?: OfflineSubmissionQueue;
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
  const routeReleased = input.routeEnd === 'released';
  const event = {
    clientEventId: createRouteEndClientEventId(occurredAt, routeReleased),
    eventType: routeReleased ? 'ROUTE_PAUSED' as const : 'ROUTE_COMPLETED' as const,
    occurredAt,
    ...(input.eventPayload === undefined ? {} : { payload: input.eventPayload }),
    routePlanId: input.routePlanId,
  };
  const preparedQueueItem = input.offlineQueue?.enqueueDriverEvent(event);
  if (preparedQueueItem !== undefined) {
    await input.offlineQueue?.whenPersisted();
  }

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

  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  try {
    const result = await input.driverEventService.recordDriverEvent(event);
    if (preparedQueueItem !== undefined) {
      input.offlineQueue?.acknowledge(preparedQueueItem.queueItemId);
    }
    const discardedQueuedItems = input.routePlanId === null || input.offlineQueue === undefined
      ? 0
      : input.offlineQueue.discardRouteSubmissions(input.routePlanId);
    await input.offlineQueue?.whenPersisted();
    await input.streamService.stopLocationUpdates(taskName);

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
      monitoringMode: 'stopped',
      stoppedTaskName: taskName,
    };
  } catch (error) {
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
      monitoringMode: 'reduced',
    };
  }
}

function createRouteEndClientEventId(occurredAt: Date, released: boolean): string {
  return `route-${released ? 'released' : 'completed'}-${occurredAt.getTime().toString(36)}`;
}
