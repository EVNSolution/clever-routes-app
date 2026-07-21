import { CONTINUOUS_LOCATION_TASK_NAME, type ContinuousLocationStreamService } from '../location/continuousLocationStream';
import type { DeliveryStartResult } from './deliveryStart';
import { formatDriverApiErrorForDriver, getDriverApiRequiresRouteLookup } from '../../api/deliveryServer/driverApiError';
import type { DriverEventService } from '../events/driverEvents';
import type { DriverFlowState } from '../driverFlow/driverFlow';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

export type DeliveryFinishResult =
  | {
      flowState: Exclude<DriverFlowState, 'delivery_finished'>;
      kind: 'blocked';
      message: string;
      reason: 'delivery_not_active';
    }
  | {
      discardedQueuedItems: number;
      duplicate: boolean;
      eventId: string;
      flowState: 'delivery_finished';
      kind: 'recorded';
      message: string;
      stoppedTaskName: string;
    }
  | {
      flowState: 'delivery_finished';
      kind: 'queued';
      message: string;
      queueItemId: string;
      reason: 'record_failed';
      requiresRouteLookup?: true;
      stoppedTaskName: string;
    };

export async function finishDeliveryAfterActive(input: {
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

  const taskName = input.taskName ?? CONTINUOUS_LOCATION_TASK_NAME;
  await input.streamService.stopLocationUpdates(taskName);

  const occurredAt = input.now ?? new Date();
  const routeReleased = input.routeEnd === 'released';
  const event = {
    clientEventId: createRouteEndClientEventId(occurredAt, routeReleased),
    eventType: routeReleased ? 'ROUTE_PAUSED' as const : 'ROUTE_COMPLETED' as const,
    occurredAt,
    ...(input.eventPayload === undefined ? {} : { payload: input.eventPayload }),
    routePlanId: input.routePlanId,
  };

  try {
    const result = await input.driverEventService.recordDriverEvent(event);
    const discardedQueuedItems = input.routePlanId === null || input.offlineQueue === undefined
      ? 0
      : input.offlineQueue.discardRouteSubmissions(input.routePlanId);

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
      stoppedTaskName: taskName,
    };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    if (routeReleased && input.routePlanId !== null) {
      input.offlineQueue.discardRouteSubmissions(input.routePlanId);
    }
    const queued = input.offlineQueue.enqueueDriverEvent(event);
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
      stoppedTaskName: taskName,
    };
  }
}

function createRouteEndClientEventId(occurredAt: Date, released: boolean): string {
  return `route-${released ? 'released' : 'completed'}-${occurredAt.getTime().toString(36)}`;
}
