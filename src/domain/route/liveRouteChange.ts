import {
  createDriverApiHttpError,
  readDriverApiErrorCode,
} from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import type { AssignedRoute } from './assignedRoute';

export type LiveRouteStopSnapshot = Readonly<{
  routePlanStopId: string;
  deliveryStopId: string;
  orderId: string;
  sourceOrderId: string | null;
  sequence: number;
  recipientName: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  countryCode: string | null;
  instructions: string | null;
  latitude: string | null;
  longitude: string | null;
  serviceMinutes: number;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
}>;

export type LiveRouteSnapshot = Readonly<{
  schemaVersion: 1;
  initialRouteVersionId?: string;
  stops: readonly LiveRouteStopSnapshot[];
}>;

export type LiveRoutePublication = Readonly<{
  routePlanId: string;
  publicationVersionId: string;
  assignmentGeneration: string;
  sequence: number;
  publishedAt: string;
  appliedVersionId: string | null;
  pending: boolean;
  snapshot: LiveRouteSnapshot;
}>;

export type LiveRouteChangeRequestOptions = { signal?: AbortSignal };
export type LiveRouteChangeIdentity = { routePlanId: string };
export type LiveRouteChangeAcknowledgement = LiveRouteChangeIdentity & {
  publicationVersionId: string;
  assignmentGeneration: string;
};
export type LiveRouteChangeService = {
  getLiveRouteChange(input: LiveRouteChangeIdentity, options?: LiveRouteChangeRequestOptions): Promise<LiveRoutePublication | null>;
  acknowledgeLiveRouteChange(input: LiveRouteChangeAcknowledgement, options?: LiveRouteChangeRequestOptions): Promise<LiveRoutePublication>;
};

export type LiveRouteChangeFetchLike = (
  input: string,
  init?: {
    body?: string;
    cache?: 'no-store';
    credentials?: 'omit';
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  },
) => Promise<{ json(): Promise<unknown>; ok: boolean; status?: number }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const terminalStatuses = new Set(['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED']);

function invalid(field: string): never {
  throw new Error(`Invalid live route publication: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) invalid(field);
  return value;
}

function generation(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n) {
    invalid('assignmentGeneration');
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== 'string') invalid(field);
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) invalid(field);
  return value;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function coordinate(value: unknown, max: number, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(value)
    || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > max) invalid(field);
  return value;
}

function parseStop(value: unknown): LiveRouteStopSnapshot {
  const stop = record(value, 'snapshot stop');
  const latitude = coordinate(stop.latitude, 90, 'latitude');
  const longitude = coordinate(stop.longitude, 180, 'longitude');
  if ((latitude === null) !== (longitude === null)) invalid('coordinate pair');
  return Object.freeze({
    routePlanStopId: uuid(stop.routePlanStopId, 'routePlanStopId'),
    deliveryStopId: uuid(stop.deliveryStopId, 'deliveryStopId'),
    orderId: uuid(stop.orderId, 'orderId'),
    sourceOrderId: nullableString(stop.sourceOrderId, 'sourceOrderId'),
    sequence: integer(stop.sequence, 'stop sequence'),
    recipientName: nullableString(stop.recipientName, 'recipientName'),
    phone: nullableString(stop.phone, 'phone'),
    address1: nullableString(stop.address1, 'address1'),
    address2: nullableString(stop.address2, 'address2'),
    city: nullableString(stop.city, 'city'),
    province: nullableString(stop.province, 'province'),
    postalCode: nullableString(stop.postalCode, 'postalCode'),
    countryCode: nullableString(stop.countryCode, 'countryCode'),
    instructions: nullableString(stop.instructions, 'instructions'),
    latitude,
    longitude,
    serviceMinutes: integer(stop.serviceMinutes, 'serviceMinutes'),
    timeWindowStart: nullableTimestamp(stop.timeWindowStart, 'timeWindowStart'),
    timeWindowEnd: nullableTimestamp(stop.timeWindowEnd, 'timeWindowEnd'),
  });
}

/** Validate and detach the immutable publication before storing or applying it. */
export function parseLiveRoutePublication(value: unknown): LiveRoutePublication {
  const input = record(value, 'data');
  const snapshot = record(input.snapshot, 'snapshot');
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.stops)) invalid('snapshot schema');
  const stops = snapshot.stops.map(parseStop);
  const stopIds = new Set(stops.map((stop) => stop.deliveryStopId));
  const routeStopIds = new Set(stops.map((stop) => stop.routePlanStopId));
  if (stopIds.size !== stops.length || routeStopIds.size !== stops.length) invalid('duplicate stop');
  if (stops.some((stop, index) => index > 0 && stop.sequence <= stops[index - 1]!.sequence)) invalid('stop order');
  if (typeof input.pending !== 'boolean') invalid('pending');
  return Object.freeze({
    routePlanId: uuid(input.routePlanId, 'routePlanId'),
    publicationVersionId: uuid(input.publicationVersionId, 'publicationVersionId'),
    assignmentGeneration: generation(input.assignmentGeneration),
    sequence: integer(input.sequence, 'sequence'),
    publishedAt: timestamp(input.publishedAt, 'publishedAt'),
    appliedVersionId: input.appliedVersionId === null ? null : uuid(input.appliedVersionId, 'appliedVersionId'),
    pending: input.pending,
    snapshot: Object.freeze({
      schemaVersion: 1 as const,
      ...(snapshot.initialRouteVersionId === undefined ? {} : {
        initialRouteVersionId: uuid(snapshot.initialRouteVersionId, 'initialRouteVersionId'),
      }),
      stops: Object.freeze(stops),
    }),
  });
}

function requireSameMembership(route: AssignedRoute, incoming: readonly { deliveryStopId: string }[]): void {
  const localIds = new Set(route.stops.map((stop) => stop.deliveryStopId));
  const incomingIds = new Set(incoming.map((stop) => stop.deliveryStopId));
  if (localIds.size !== route.stops.length || incomingIds.size !== incoming.length
    || localIds.size !== incomingIds.size || incoming.some((stop) => !localIds.has(stop.deliveryStopId))) {
    throw new Error('Live route stop membership changed; reload route access before applying');
  }
}

/** Apply N from N itself, even if an assigned-route GET already contains N+1. */
export function applyLiveRoutePublication(route: AssignedRoute, publication: LiveRoutePublication): AssignedRoute {
  const value = parseLiveRoutePublication(publication);
  if (route.id !== value.routePlanId) throw new Error('Live route publication belongs to another route');
  requireSameMembership(route, value.snapshot.stops);
  const localStops = new Map(route.stops.map((stop) => [stop.deliveryStopId, stop]));
  let protectedIndex = route.stops.findIndex((stop) => !terminalStatuses.has(stop.status));
  if (protectedIndex < 0) protectedIndex = route.stops.length - 1;
  route.stops.forEach((stop, index) => {
    if (stop.status === 'ARRIVED' || stop.status === 'EN_ROUTE') protectedIndex = Math.max(protectedIndex, index);
  });
  const protectedIds = new Set(route.stops.slice(0, protectedIndex + 1).map((stop) => stop.deliveryStopId));
  return {
    ...route,
    routeGeometry: null,
    routeMapPreview: null,
    routeMetrics: null,
    routeStopPoints: [],
    etaSnapshot: null,
    stops: value.snapshot.stops.map((stop) => ({
      ...localStops.get(stop.deliveryStopId)!,
      address: {
        address1: stop.address1 ?? '', address2: stop.address2, city: stop.city ?? '',
        province: stop.province ?? '', postalCode: stop.postalCode ?? '', countryCode: stop.countryCode ?? '',
      },
      coordinates: stop.latitude === null || stop.longitude === null ? null : {
        latitude: Number(stop.latitude), longitude: Number(stop.longitude),
      },
      navigationTarget: stop.latitude === null ? 'ADDRESS' : 'COORDINATES',
      recipientName: stop.recipientName,
      phone: stop.phone,
      sequence: stop.sequence,
      ...(protectedIds.has(stop.deliveryStopId) ? {} : {
        estimatedArrivalAt: null, distanceFromPreviousMeters: null, durationFromPreviousSeconds: null,
      }),
    })),
  };
}

/** Refresh execution without silently accepting unacknowledged operational content. */
export function mergeLiveRouteExecutionState(appliedRoute: AssignedRoute, refreshedRoute: AssignedRoute): AssignedRoute {
  if (appliedRoute.id !== refreshedRoute.id) throw new Error('Cannot merge execution from another route');
  requireSameMembership(appliedRoute, refreshedRoute.stops);
  const refreshedStops = new Map(refreshedRoute.stops.map((stop) => [stop.deliveryStopId, stop]));
  return {
    ...appliedRoute,
    stops: appliedRoute.stops.map((stop) => {
      const refreshedStatus = refreshedStops.get(stop.deliveryStopId)!.status;
      // A queued completion can reach the device before it reaches the server.
      const status = terminalStatuses.has(stop.status) && !terminalStatuses.has(refreshedStatus)
        ? stop.status : refreshedStatus;
      return { ...stop, status };
    }),
  };
}

export function createLiveRouteChangeApiClient(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: LiveRouteChangeFetchLike;
}): LiveRouteChangeService {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl.replace(/\/+$/u, '');

  async function request(
    routePlanId: string,
    acknowledgement?: Omit<LiveRouteChangeAcknowledgement, 'routePlanId'>,
    options?: LiveRouteChangeRequestOptions,
  ): Promise<LiveRoutePublication | null> {
    uuid(routePlanId, 'routePlanId');
    const endpoint = acknowledgement === undefined ? 'Live route change lookup' : 'Live route change acknowledgement';
    const path = `/driver/routes/${encodeURIComponent(routePlanId)}/live-change${acknowledgement === undefined ? '' : '/applied'}`;
    const response = await fetchImpl(`${baseUrl}${path}`, withNoStoreDriverApiRequest({
      method: acknowledgement === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, ...(acknowledgement === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(acknowledgement === undefined ? {} : { body: JSON.stringify(acknowledgement) }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    }));
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw createDriverApiHttpError({ endpoint, status: response.status, code: readDriverApiErrorCode(payload) });
    }
    const envelope = record(payload, 'response envelope');
    if (envelope.error !== null) {
      throw createDriverApiHttpError({ endpoint, status: response.status, code: readDriverApiErrorCode(payload) });
    }
    if (envelope.data === null && acknowledgement === undefined) return null;
    const publication = parseLiveRoutePublication(envelope.data);
    if (publication.routePlanId !== routePlanId) throw new Error('Live route response belongs to another route');
    if (acknowledgement !== undefined && publication.assignmentGeneration !== acknowledgement.assignmentGeneration) {
      throw new Error('Live route acknowledgement belongs to another assignment');
    }
    return publication;
  }

  return {
    getLiveRouteChange: (identity, options) => request(identity.routePlanId, undefined, options),
    acknowledgeLiveRouteChange: async (identity, options) => {
      const publication = await request(identity.routePlanId, {
        publicationVersionId: uuid(identity.publicationVersionId, 'publicationVersionId'),
        assignmentGeneration: generation(identity.assignmentGeneration),
      }, options);
      if (publication === null) invalid('acknowledgement');
      return publication;
    },
  };
}
