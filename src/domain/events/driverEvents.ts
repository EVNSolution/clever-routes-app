import type { DeliveryStartResult } from '../delivery/deliveryStart';
import {
  createDriverApiHttpError,
  formatDriverApiErrorForDriver,
  getDriverApiRequiresRouteLookup,
  readDriverApiErrorCode,
} from '../../api/deliveryServer/driverApiError';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import { isAssignedRouteEtaSnapshot } from '../route/assignedRoute';
import type {
  AssignedRoute,
  AssignedRouteEtaRemaining,
  AssignedRouteEtaSnapshot,
  AssignedRouteEtaSnapshotStatus,
  AssignedRouteEtaSnapshotStop,
} from '../route/assignedRoute';

export type DriverEventType =
  | 'LOCATION_UPDATED'
  | 'ROUTE_COMPLETED'
  | 'ROUTE_PAUSED'
  | 'ROUTE_STARTED'
  | 'PICKUP_COMPLETED'
  | 'STOP_ARRIVED'
  | 'STOP_DELIVERED'
  | 'STOP_FAILED';

export type DriverEventInput = {
  accuracyMeters?: number | null;
  appVersion?: string;
  assignmentGeneration?: string;
  clientEventId: string;
  deliveryStopId?: string | null;
  driverContractVersion?: 2;
  eventType: DriverEventType;
  expectedRouteVersionId?: string;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt: Date;
  payload?: Record<string, unknown>;
  routePlanId?: string | null;
  versionCode?: number;
};

export type DriverOrderedEventContract = {
  appVersion: string;
  assignmentGeneration: string;
  driverContractVersion: 2;
  expectedRouteVersionId: string;
  versionCode: number;
};

export type DriverEventRecordResult = {
  duplicate: boolean;
  etaSnapshot?: DriverRouteEtaSnapshot;
  etaUpdate?: DriverRouteEtaUpdate;
  eventId: string;
  status: 'recorded';
};

export type DriverRouteEtaSnapshotStop = AssignedRouteEtaSnapshotStop;
export type DriverRouteEtaRemaining = AssignedRouteEtaRemaining;
export type DriverRouteEtaSnapshotStatus = AssignedRouteEtaSnapshotStatus;
export type DriverRouteEtaSnapshot = AssignedRouteEtaSnapshot;

export type DriverRouteEtaStopUpdate = {
  deliveryStopId: string;
  estimatedArrivalAt: string | null;
  sequence: number;
};

export type DriverRouteEtaUpdate = {
  actualArrivalAt: string | null;
  deliveryStopId: string | null;
  delaySeconds: number | null;
  previousEstimatedArrivalAt: string | null;
  serverReceivedAt: string;
  trigger: 'ROUTE_STARTED' | 'STOP_ARRIVED' | 'STOP_DELIVERED' | 'STOP_FAILED' | 'PICKUP_COMPLETED';
  updatedStops: DriverRouteEtaStopUpdate[];
  etaStatus?: 'FAILED' | 'READY';
  etaFailureCode?: string | null;
  etaFailureMessage?: string | null;
  etaCalculatedAt?: string | null;
};

export type DriverEventService = {
  prepareDriverEvent?(input: DriverEventInput): DriverEventInput;
  recordDriverEvent(input: DriverEventInput, options?: { signal?: AbortSignal }): Promise<DriverEventRecordResult>;
};

export function prepareDriverEventForPersistence(
  service: DriverEventService,
  event: DriverEventInput,
): DriverEventInput {
  return service.prepareDriverEvent?.(event) ?? event;
}

export type MockDriverEventService = DriverEventService & {
  recordedEvents: DriverEventInput[];
};

export type RouteStartedRecordResult =
  | DriverEventRecordResult & { kind: 'recorded' }
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' }
  | { kind: 'queued'; message: string; queueItemId: string; reason: 'record_failed'; requiresRouteLookup?: true };

export type StopArrivedRecordResult =
  | DriverEventRecordResult & { kind: 'recorded' }
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' }
  | { kind: 'queued'; message: string; queueItemId: string; reason: 'record_failed'; requiresRouteLookup?: true };

export type StopArrivalEvidence = {
  distanceToPlannedStopMeters?: number;
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

export type PickupCompletedRecordResult =
  | DriverEventRecordResult & { kind: 'recorded' }
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' }
  | { kind: 'queued'; message: string; queueItemId: string; reason: 'record_failed'; requiresRouteLookup?: true };

export type FetchLike = (
  input: string,
  init?: {
    body?: string;
    cache?: 'no-store';
    credentials?: 'omit';
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status?: number;
}>;

export function createMockDriverEventService(): MockDriverEventService {
  const recordedEvents: DriverEventInput[] = [];
  return {
    recordedEvents,
    recordDriverEvent: async (event) => {
      recordedEvents.push(event);
      return {
        duplicate: false,
        eventId: event.clientEventId,
        status: 'recorded',
      };
    },
  };
}

export function createDriverEventsApiClient(input: {
  accessToken: string;
  baseUrl: string;
  orderedEventContract?: DriverOrderedEventContract;
  fetchImpl?: FetchLike;
}): DriverEventService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const prepareDriverEvent = (event: DriverEventInput): DriverEventInput => {
    if (
      event.eventType !== 'LOCATION_UPDATED'
      && input.orderedEventContract !== undefined
      && !hasCompleteOrderedEventContract(event)
    ) {
      return { ...event, ...input.orderedEventContract };
    }
    return event;
  };

  return {
    prepareDriverEvent,
    recordDriverEvent: async (event, options) => {
      const preparedEvent = prepareDriverEvent(event);
      const response = await fetchImpl(`${baseUrl}/driver/events`, withNoStoreDriverApiRequest({
        body: JSON.stringify(toDriverEventRequestBody(preparedEvent)),
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: options?.signal,
      }));
      const payload = await response.json();
      if (!response.ok) {
        throw createDriverApiHttpError({
          code: readDriverApiErrorCode(payload),
          endpoint: 'Driver event record',
          status: response.status,
        });
      }

      return readDriverEventRecordEnvelope(payload);
    },
  };
}

function hasCompleteOrderedEventContract(event: DriverEventInput): boolean {
  return typeof event.appVersion === 'string' && event.appVersion.trim() !== ''
    && typeof event.assignmentGeneration === 'string' && /^\d+$/u.test(event.assignmentGeneration)
    && event.driverContractVersion === 2
    && typeof event.expectedRouteVersionId === 'string' && event.expectedRouteVersionId.trim() !== ''
    && Number.isSafeInteger(event.versionCode) && (event.versionCode ?? 0) > 0;
}

export async function recordRouteStartedAfterDeliveryStart(input: {
  clientEventId?: string;
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  occurredAt?: Date;
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string | null;
}): Promise<RouteStartedRecordResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      reason: 'delivery_not_active',
      message: 'Route started event is recorded only after delivery_active.',
    };
  }

  const event = prepareDriverEventForPersistence(
    input.driverEventService,
    createRouteStartedDriverEvent({
      ...(input.clientEventId === undefined ? {} : { clientEventId: input.clientEventId }),
      occurredAt: input.occurredAt ?? new Date(),
      routePlanId: input.routePlanId,
    }),
  );

  try {
    const result = await input.driverEventService.recordDriverEvent(event);

    return { ...result, kind: 'recorded' };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const queued = input.offlineQueue.enqueueDriverEvent(event);
    return {
      kind: 'queued',
      message: `Route started event queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
    };
  }
}

export function createRouteStartedDriverEvent(input: {
  clientEventId?: string;
  occurredAt: Date;
  routePlanId: string | null;
}): DriverEventInput {
  return {
    clientEventId: input.clientEventId ?? createRouteStartedClientEventId(input.occurredAt),
    eventType: 'ROUTE_STARTED',
    occurredAt: input.occurredAt,
    routePlanId: input.routePlanId,
  };
}

export function createRouteStartedClientEventId(occurredAt: Date): string {
  return `route-started-${occurredAt.getTime().toString(36)}`;
}

export async function recordStopArrivedAfterDeliveryStart(input: {
  arrivalEvidence?: StopArrivalEvidence;
  clientEventId?: string;
  deliveryStart: DeliveryStartResult;
  deliveryStopId: string;
  driverEventService: DriverEventService;
  occurredAt?: Date;
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string;
}): Promise<StopArrivedRecordResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Stop arrival is recorded only while the route is active.',
      reason: 'delivery_not_active',
    };
  }

  const occurredAt = input.arrivalEvidence?.recordedAt ?? input.occurredAt ?? new Date();
  const event = prepareDriverEventForPersistence(input.driverEventService, {
    clientEventId: input.clientEventId ?? `stop-arrived-${input.deliveryStopId}-${occurredAt.getTime().toString(36)}`,
    deliveryStopId: input.deliveryStopId,
    eventType: 'STOP_ARRIVED',
    ...(input.arrivalEvidence === undefined ? {} : {
      latitude: input.arrivalEvidence.latitude,
      longitude: input.arrivalEvidence.longitude,
    }),
    occurredAt,
    ...(input.arrivalEvidence?.distanceToPlannedStopMeters === undefined ? {} : {
      payload: { distanceToPlannedStopMeters: input.arrivalEvidence.distanceToPlannedStopMeters },
    }),
    routePlanId: input.routePlanId,
  });

  try {
    const result = await input.driverEventService.recordDriverEvent(event);
    return { ...result, kind: 'recorded' };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const queued = input.offlineQueue.enqueueDriverEvent(event);
    return {
      kind: 'queued',
      message: `Stop arrival queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
    };
  }
}

export async function recordPickupCompletedAfterDeliveryStart(input: {
  clientEventId?: string;
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  occurredAt?: Date;
  offlineQueue?: OfflineSubmissionQueue;
  routePlanId: string;
}): Promise<PickupCompletedRecordResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      message: 'Pickup completion is recorded only while the route is active.',
      reason: 'delivery_not_active',
    };
  }

  const occurredAt = input.occurredAt ?? new Date();
  const event = prepareDriverEventForPersistence(
    input.driverEventService,
    createPickupCompletedDriverEvent({
      clientEventId: input.clientEventId,
      occurredAt,
      routePlanId: input.routePlanId,
    }),
  );

  try {
    const result = await input.driverEventService.recordDriverEvent(event);
    if (result.etaSnapshot === undefined) {
      throw new Error('Pickup completion response did not include an ETA snapshot.');
    }
    return { ...result, kind: 'recorded' };
  } catch (error) {
    if (input.offlineQueue === undefined) {
      throw error;
    }

    const queued = input.offlineQueue.enqueueDriverEvent(event);
    return {
      kind: 'queued',
      message: `Pickup event queued for retry: ${formatDriverApiErrorForDriver(error)}`,
      queueItemId: queued.queueItemId,
      reason: 'record_failed',
      ...(getDriverApiRequiresRouteLookup(error) === undefined ? {} : { requiresRouteLookup: true as const }),
    };
  }
}

export function createPickupCompletedDriverEvent(input: {
  clientEventId?: string;
  occurredAt: Date;
  routePlanId: string;
}): DriverEventInput {
  return {
    clientEventId: input.clientEventId ?? createPickupCompletedClientEventId(input.occurredAt),
    eventType: 'PICKUP_COMPLETED',
    occurredAt: input.occurredAt,
    routePlanId: input.routePlanId,
  };
}

export function createPickupCompletedClientEventId(occurredAt: Date): string {
  return `pickup-completed-${occurredAt.getTime().toString(36)}`;
}

export function applyDriverRouteEtaUpdate(route: AssignedRoute, etaUpdate: DriverRouteEtaUpdate): AssignedRoute {
  const updatedEtaByStopId = new Map(
    etaUpdate.updatedStops.map((stop) => [stop.deliveryStopId, stop.estimatedArrivalAt]),
  );

  return {
    ...route,
    stops: route.stops.map((stop) => ({
      ...stop,
      ...(updatedEtaByStopId.has(stop.deliveryStopId)
        ? { estimatedArrivalAt: updatedEtaByStopId.get(stop.deliveryStopId) ?? null }
        : {}),
      ...(etaUpdate.trigger === 'STOP_ARRIVED' && stop.deliveryStopId === etaUpdate.deliveryStopId
        ? { status: 'ARRIVED' }
        : {}),
    })),
  };
}

function toDriverEventRequestBody(event: DriverEventInput): Record<string, unknown> {
  return {
    ...(event.accuracyMeters === undefined ? {} : { accuracyMeters: event.accuracyMeters }),
    ...(event.appVersion === undefined ? {} : { appVersion: event.appVersion }),
    ...(event.assignmentGeneration === undefined ? {} : { assignmentGeneration: event.assignmentGeneration }),
    clientEventId: event.clientEventId,
    ...(event.deliveryStopId === undefined ? {} : { deliveryStopId: event.deliveryStopId }),
    ...(event.driverContractVersion === undefined ? {} : { driverContractVersion: event.driverContractVersion }),
    eventType: event.eventType,
    ...(event.expectedRouteVersionId === undefined ? {} : { expectedRouteVersionId: event.expectedRouteVersionId }),
    ...(event.latitude === undefined ? {} : { latitude: event.latitude }),
    ...(event.longitude === undefined ? {} : { longitude: event.longitude }),
    occurredAt: event.occurredAt.toISOString(),
    ...(event.payload === undefined ? {} : event.payload),
    ...(event.routePlanId === undefined ? {} : { routePlanId: event.routePlanId }),
    ...(event.versionCode === undefined ? {} : { versionCode: event.versionCode }),
  };
}

function readDriverEventRecordEnvelope(payload: unknown): DriverEventRecordResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver event response');
  }

  const data = (payload as { data?: unknown }).data;
  if (!isDriverEventRecordData(data)) {
    throw new Error('Invalid driver event response');
  }

  return {
    duplicate: data.duplicate,
    ...(data.etaUpdate === undefined ? {} : { etaUpdate: data.etaUpdate }),
    ...(data.etaSnapshot === undefined ? {} : { etaSnapshot: data.etaSnapshot }),
    eventId: data.eventId,
    status: 'recorded',
  };
}

function isDriverEventRecordData(value: unknown): value is {
  duplicate: boolean;
  etaUpdate?: DriverRouteEtaUpdate;
  etaSnapshot?: DriverRouteEtaSnapshot;
  eventId: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    typeof data.duplicate === 'boolean'
    && (data.etaUpdate === undefined || isDriverRouteEtaUpdate(data.etaUpdate))
    && (data.etaSnapshot === undefined || isAssignedRouteEtaSnapshot(data.etaSnapshot))
    && typeof data.eventId === 'string'
    && data.eventId.trim() !== ''
  );
}

function isDriverRouteEtaUpdate(value: unknown): value is DriverRouteEtaUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const update = value as Record<string, unknown>;
  return (
    nullableString(update.actualArrivalAt)
    && nullableString(update.deliveryStopId)
    && nullableFiniteNumber(update.delaySeconds)
    && nullableString(update.previousEstimatedArrivalAt)
    && typeof update.serverReceivedAt === 'string'
    && (
      update.trigger === 'ROUTE_STARTED'
      || update.trigger === 'STOP_ARRIVED'
      || update.trigger === 'STOP_DELIVERED'
      || update.trigger === 'STOP_FAILED'
      || update.trigger === 'PICKUP_COMPLETED'
    )
    && Array.isArray(update.updatedStops)
    && update.updatedStops.every(isDriverRouteEtaStopUpdate)
  );
}

function isDriverRouteEtaStopUpdate(value: unknown): value is DriverRouteEtaStopUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const update = value as Record<string, unknown>;
  return (
    typeof update.deliveryStopId === 'string'
    && nullableString(update.estimatedArrivalAt)
    && typeof update.sequence === 'number'
    && Number.isFinite(update.sequence)
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}
