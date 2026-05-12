import type { DeliveryStartResult } from './deliveryStart';

export type DriverEventType =
  | 'LOCATION_UPDATED'
  | 'ROUTE_COMPLETED'
  | 'ROUTE_PAUSED'
  | 'ROUTE_STARTED'
  | 'STOP_ARRIVED'
  | 'STOP_DELIVERED'
  | 'STOP_FAILED';

export type DriverEventInput = {
  clientEventId: string;
  deliveryStopId?: string | null;
  eventType: DriverEventType;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt: Date;
  payload?: Record<string, unknown>;
  routePlanId?: string | null;
};

export type DriverEventRecordResult = {
  duplicate: boolean;
  eventId: string;
  status: 'recorded';
};

export type DriverEventService = {
  recordDriverEvent(input: DriverEventInput): Promise<DriverEventRecordResult>;
};

export type MockDriverEventService = DriverEventService & {
  recordedEvents: DriverEventInput[];
};

export type RouteStartedRecordResult =
  | DriverEventRecordResult & { kind: 'recorded' }
  | { kind: 'blocked'; message: string; reason: 'delivery_not_active' };

export type FetchLike = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
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
  fetchImpl?: FetchLike;
}): DriverEventService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  return {
    recordDriverEvent: async (event) => {
      const response = await fetchImpl(`${baseUrl}/driver/events`, {
        body: JSON.stringify(toDriverEventRequestBody(event)),
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Driver event record failed with HTTP ${response.status ?? 'unknown'}`);
      }

      return readDriverEventRecordEnvelope(payload);
    },
  };
}

export async function recordRouteStartedAfterDeliveryStart(input: {
  deliveryStart: DeliveryStartResult;
  driverEventService: DriverEventService;
  routePlanId: string | null;
}): Promise<RouteStartedRecordResult> {
  if (input.deliveryStart.kind !== 'delivery_active') {
    return {
      kind: 'blocked',
      reason: 'delivery_not_active',
      message: 'Route started event is recorded only after delivery_active.',
    };
  }

  const result = await input.driverEventService.recordDriverEvent({
    clientEventId: createClientEventId('route-started'),
    eventType: 'ROUTE_STARTED',
    occurredAt: new Date(),
    routePlanId: input.routePlanId,
  });

  return { ...result, kind: 'recorded' };
}

function createClientEventId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function toDriverEventRequestBody(event: DriverEventInput): Record<string, unknown> {
  return {
    clientEventId: event.clientEventId,
    ...(event.deliveryStopId === undefined ? {} : { deliveryStopId: event.deliveryStopId }),
    eventType: event.eventType,
    ...(event.latitude === undefined ? {} : { latitude: event.latitude }),
    ...(event.longitude === undefined ? {} : { longitude: event.longitude }),
    occurredAt: event.occurredAt.toISOString(),
    ...(event.payload === undefined ? {} : event.payload),
    ...(event.routePlanId === undefined ? {} : { routePlanId: event.routePlanId }),
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
    eventId: data.eventId,
    status: 'recorded',
  };
}

function isDriverEventRecordData(value: unknown): value is { duplicate: boolean; eventId: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return typeof data.duplicate === 'boolean' && typeof data.eventId === 'string' && data.eventId.trim() !== '';
}
