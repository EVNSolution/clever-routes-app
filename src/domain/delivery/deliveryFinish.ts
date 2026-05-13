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
  now?: Date;
  offlineQueue?: OfflineSubmissionQueue;
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
  const event = {
    clientEventId: createRouteCompletedClientEventId(occurredAt),
    eventType: 'ROUTE_COMPLETED' as const,
    occurredAt,
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
      message: discardedQueuedItems > 0
        ? `Delivery finished. ${discardedQueuedItems} queued route submission${discardedQueuedItems === 1 ? '' : 's'} discarded after route completion was recorded.`
        : 'Delivery finished and route completion was recorded.',
      stoppedTaskName: taskName,
    };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const queued = input.offlineQueue.enqueueDriverEvent(event);
    return {
      flowState: 'delivery_finished',
      kind: 'queued',
      message: `Delivery finished locally and route completion was queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
      stoppedTaskName: taskName,
    };
  }
}

function createRouteCompletedClientEventId(occurredAt: Date): string {
  return `route-completed-${occurredAt.getTime().toString(36)}`;
}
