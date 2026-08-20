import type { DriverFlowState } from '../driverFlow/driverFlow';
import {
  createDriverApiHttpError,
  DRIVER_ACCESS_EXPIRED_MESSAGE,
  isDriverApiUnauthorizedError,
} from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';

export type AssignedRouteAddress = {
  address1: string;
  address2: string | null;
  city: string;
  countryCode: string;
  postalCode: string;
  province: string;
};

export type AssignedRouteCoordinates = {
  latitude: number;
  longitude: number;
};

export type AssignedRouteNavigationTarget = 'ADDRESS' | 'COORDINATES';

export type AssignedRouteLngLat = [number, number];

export type AssignedRouteGeometry = {
  coordinates: AssignedRouteLngLat[];
  type: 'LineString';
};

export type AssignedRouteMetrics = {
  distanceMeters: number | null;
  durationSeconds: number | null;
};

export type AssignedRouteMapPreview = {
  altText: string;
  contentType: 'image/png';
  expiresAt: string;
  generatedAt: string;
  height: number;
  imageUrl: string;
  kind: 'static_route_map';
  routeSequenceChecksum: string;
  width: number;
};

export type RouteMapPreviewLoadStatus = 'idle' | 'failed';

export type RouteMapPreviewState =
  | {
      accessibilityLabel: string;
      imageUrl: string;
      kind: 'available';
    }
  | {
      kind: 'expired' | 'failed' | 'missing';
      message: string;
    };

export const NORMALIZED_PAYMENT_STATUSES = [
  'PAID_CONFIRMED',
  'CASH_COLLECT_REQUIRED',
  'TRANSFER_CHECK_PENDING',
  'ONLINE_PAYMENT_PENDING_OR_FAILED',
  'NOT_DELIVERABLE_OR_EXCEPTION',
  'UNKNOWN_REVIEW',
] as const;

export type NormalizedPaymentStatus = (typeof NORMALIZED_PAYMENT_STATUSES)[number];

export type AssignedRouteOrderItemOption = {
  key: string;
  value: string;
};

export type AssignedRouteOrderItem = {
  name: string;
  options: AssignedRouteOrderItemOption[];
  productId: number;
  quantity: number;
  sku: string | null;
  variationId: number;
};

export type AssignedRoutePaymentCopy = {
  detail: string;
  label: string;
  tone: 'green' | 'neutral' | 'warning';
};

export type AssignedRoutePaymentSummary = {
  amountLabel: string;
  detail: string;
  methodLabel: string;
  notificationLabel: string;
  status: AssignedRoutePaymentCopy;
};

export type AssignedRouteStop = {
  address: AssignedRouteAddress;
  coordinates: AssignedRouteCoordinates | null;
  currencyCode?: string | null;
  customerNote?: string | null;
  deliverySession?: string | null;
  deliveryStopId: string;
  durationFromPreviousSeconds?: number | null;
  distanceFromPreviousMeters?: number | null;
  estimatedArrivalAt?: string | null;
  items: AssignedRouteOrderItem[];
  navigationTarget?: AssignedRouteNavigationTarget;
  normalizedPaymentStatus: NormalizedPaymentStatus | null;
  orderName: string;
  paymentMethodTitle?: string | null;
  phone: string | null;
  recipientName: string | null;
  sequence: number;
  serviceType?: string | null;
  status: string;
  totalPriceAmount?: string | null;
};

export type AssignedRouteEtaRemaining = {
  distanceMeters: number | null;
  estimatedCompletionAt: string | null;
};

export type AssignedRouteEtaSnapshotStop = {
  deliveryStopId: string | null;
  distanceFromPreviousMeters: number | null;
  estimatedArrivalAt: string | null;
  sequence: number;
};

export type AssignedRouteEtaSnapshotStatus = 'PRE_PICKUP' | 'READY' | 'FAILED';

export type AssignedRouteStopPoint = {
  deliveryStopId: string;
  inputCoordinates: AssignedRouteLngLat | null;
  name: string | null;
  sequence: number;
  snapDistanceMeters: number | null;
  snappedCoordinates: AssignedRouteLngLat | null;
};

const DEFAULT_ASSIGNED_ROUTE_TIMEZONE = 'America/Toronto';

export type AssignedRoute = {
  deliveryDate: string;
  id: string;
  name: string;
  routeGeometry: AssignedRouteGeometry | null;
  routeMapPreview: AssignedRouteMapPreview | null;
  routeMetrics: AssignedRouteMetrics | null;
  routeStopPoints: AssignedRouteStopPoint[];
  scheduledStartAt?: string | null;
  shopDomain: string;
  stops: AssignedRouteStop[];
  etaSnapshot?: AssignedRouteEtaSnapshot | null;
  timezone: string;
};

export type AssignedRouteEtaSnapshot = {
  calculatedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  nextStopEta: AssignedRouteEtaSnapshotStop | null;
  pickupCompletedAt: string | null;
  remainingRouteEta: AssignedRouteEtaRemaining | null;
  status: AssignedRouteEtaSnapshotStatus;
};

export type AssignedRouteLookupResult =
  | {
      route: AssignedRoute;
      status: 'ASSIGNED_ROUTE';
    }
  | {
      status: 'NO_ASSIGNED_ROUTE';
    };

export type AssignedRouteLookupInput = {
  routeContext: string | null;
};

export type AssignedRouteService = {
  getAssignedRoute(input: AssignedRouteLookupInput): Promise<AssignedRouteLookupResult>;
};

export type AssignedRouteLoadInput = {
  consentState: Extract<DriverFlowState, 'consent_recorded' | 'consent_required'>;
  routeContext: string;
};

export type AssignedRouteLoadResult =
  | {
      flowState: Extract<DriverFlowState, 'route_ready'>;
      kind: 'route_ready';
      route: AssignedRoute;
    }
  | {
      flowState: Extract<DriverFlowState, 'consent_recorded'>;
      kind: 'no_assigned_route';
      message: string;
    }
  | {
      flowState: Extract<DriverFlowState, 'consent_recorded'>;
      kind: 'route_error';
      message: string;
      reason?: 'driver_access_expired';
    }
  | {
      flowState: Extract<DriverFlowState, 'consent_required'>;
      kind: 'blocked_until_consent';
      message: string;
    };

export type FetchLike = (
  input: string,
  init?: {
    cache?: 'no-store';
    credentials?: 'omit';
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status?: number;
}>;

export const sampleAssignedRoute: AssignedRoute = {
  deliveryDate: '2026-05-12',
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Tuesday AM Route',
  routeGeometry: {
    coordinates: [
      [-79.3832, 43.6532],
      [-79.3817, 43.6487],
      [-79.3909, 43.6509],
    ],
    type: 'LineString',
  },
  routeMapPreview: {
    altText: 'Static route preview for 2 stops.',
    contentType: 'image/png',
    expiresAt: '2026-05-12T07:00:00.000Z',
    generatedAt: '2026-05-12T06:50:00.000Z',
    height: 430,
    imageUrl: 'https://delivery.example.com/driver/route-map-preview/opaque?expires=1781142000000&signature=preview',
    kind: 'static_route_map',
    routeSequenceChecksum: 'sample-route-checksum',
    width: 720,
  },
  routeMetrics: {
    distanceMeters: 3250,
    durationSeconds: 840,
  },
  routeStopPoints: [
    {
      deliveryStopId: '22222222-2222-4222-8222-222222222222',
      inputCoordinates: [-79.3817, 43.6487],
      name: 'King Street West',
      sequence: 1,
      snapDistanceMeters: 3.5,
      snappedCoordinates: [-79.3818, 43.6488],
    },
    {
      deliveryStopId: '33333333-3333-4333-8333-333333333333',
      inputCoordinates: [-79.3909, 43.6509],
      name: 'Queen Street West',
      sequence: 2,
      snapDistanceMeters: 8.2,
      snappedCoordinates: [-79.391, 43.651],
    },
  ],
  scheduledStartAt: '2026-05-12T11:00:00.000Z',
  shopDomain: 'tomatono.myshopify.com',
  stops: [
    {
      address: {
        address1: '100 King St W',
        address2: null,
        city: 'Toronto',
        countryCode: 'CA',
        postalCode: 'M5X 1A9',
        province: 'ON',
      },
      coordinates: {
        latitude: 43.6487,
        longitude: -79.3817,
      },
      currencyCode: 'CAD',
      deliveryStopId: '22222222-2222-4222-8222-222222222222',
      durationFromPreviousSeconds: 480,
      estimatedArrivalAt: '2026-05-12T11:08:00.000Z',
      items: [
        {
          name: 'Tomato box',
          options: [{ key: 'Size', value: 'Large' }],
          productId: 101,
          quantity: 2,
          sku: 'TOM-L',
          variationId: 7,
        },
      ],
      normalizedPaymentStatus: 'CASH_COLLECT_REQUIRED',
      orderName: '#1001',
      paymentMethodTitle: 'Cash on delivery',
      phone: '+14165550123',
      recipientName: 'Recipient One',
      sequence: 1,
      status: 'ASSIGNED',
      totalPriceAmount: '84.50',
    },
    {
      address: {
        address1: '200 Queen St W',
        address2: 'Unit 4',
        city: 'Toronto',
        countryCode: 'CA',
        postalCode: 'M5V 1Z2',
        province: 'ON',
      },
      coordinates: {
        latitude: 43.6509,
        longitude: -79.3909,
      },
      currencyCode: 'CAD',
      deliveryStopId: '33333333-3333-4333-8333-333333333333',
      durationFromPreviousSeconds: 360,
      estimatedArrivalAt: '2026-05-12T11:19:00.000Z',
      items: [
        {
          name: 'Basil bunch',
          options: [],
          productId: 202,
          quantity: 1,
          sku: null,
          variationId: 0,
        },
      ],
      normalizedPaymentStatus: 'TRANSFER_CHECK_PENDING',
      orderName: '#1002',
      paymentMethodTitle: 'eTransfer',
      phone: '+14165550124',
      recipientName: 'Recipient Two',
      sequence: 2,
      status: 'ASSIGNED',
      totalPriceAmount: '52.00',
    },
  ],
  timezone: 'America/Toronto',
};

export async function loadAssignedRouteAfterConsent(
  input: AssignedRouteLoadInput,
  service: AssignedRouteService,
): Promise<AssignedRouteLoadResult> {
  if (input.consentState !== 'consent_recorded') {
    return {
      flowState: 'consent_required',
      kind: 'blocked_until_consent',
      message: 'Record required consent before loading assigned route details.',
    };
  }

  try {
    const result = await service.getAssignedRoute({ routeContext: input.routeContext.trim() });
    if (result.status === 'NO_ASSIGNED_ROUTE') {
      return {
        flowState: 'consent_recorded',
        kind: 'no_assigned_route',
        message: 'No ready or in-progress route is available for this driver and route context.',
      };
    }

    return {
      flowState: 'route_ready',
      kind: 'route_ready',
      route: {
        ...result.route,
        stops: [...result.route.stops]
          .map(normalizeAssignedRouteStop)
          .sort((left, right) => left.sequence - right.sequence),
      },
    };
  } catch (error) {
    if (isDriverApiUnauthorizedError(error)) {
      return {
        flowState: 'consent_recorded',
        kind: 'route_error',
        message: DRIVER_ACCESS_EXPIRED_MESSAGE,
        reason: 'driver_access_expired',
      };
    }

    return {
      flowState: 'consent_recorded',
      kind: 'route_error',
      message: 'Assigned route could not be loaded. Check the connection and try again.',
    };
  }
}

export function createMockAssignedRouteService(
  result: AssignedRouteLookupResult = { status: 'ASSIGNED_ROUTE', route: sampleAssignedRoute },
): AssignedRouteService {
  return {
    getAssignedRoute: async () => result,
  };
}

export function createAssignedRouteApiClient(input: {
  accessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): AssignedRouteService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const accessToken = input.accessToken.trim();

  return {
    getAssignedRoute: async (request) => {
      const routeContext = request.routeContext?.trim();
      const query = routeContext ? `?routeContext=${encodeURIComponent(routeContext)}` : '';
      const response = await fetchImpl(`${baseUrl}/driver/assigned-route${query}`, withNoStoreDriverApiRequest({
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: 'GET',
      }));
      const payload = await response.json();
      if (!response.ok) {
        throw createDriverApiHttpError({
          endpoint: 'Assigned route lookup',
          status: response.status,
        });
      }

      return readAssignedRouteEnvelope(payload);
    },
  };
}

export function formatAssignedRouteDistance(metrics: AssignedRouteMetrics | null): string {
  const distanceMeters = metrics?.distanceMeters;
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return 'Not available';
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function formatAssignedRouteDuration(metrics: AssignedRouteMetrics | null): string {
  const durationSeconds = metrics?.durationSeconds;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return 'Not available';
  }

  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`;
}

export function formatAssignedRoutePickupTiming(route: AssignedRoute, nowMs: number): {
  finish: string;
  leave: string;
  routeTime: string;
} {
  const scheduledStartMs = route.scheduledStartAt == null ? Number.NaN : Date.parse(route.scheduledStartAt);
  const leaveAtMs = Number.isFinite(scheduledStartMs) && scheduledStartMs > nowMs ? scheduledStartMs : nowMs;
  const leave = leaveAtMs === nowMs
    ? 'Now'
    : `In ${formatAssignedRouteDuration({ distanceMeters: 0, durationSeconds: (leaveAtMs - nowMs) / 1000 })}`;
  const routeTime = formatAssignedRouteDuration(route.routeMetrics);
  const durationSeconds = route.routeMetrics?.durationSeconds;
  const finish = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds >= 0
    ? formatAssignedRouteEta(new Date(leaveAtMs + durationSeconds * 1000).toISOString(), route.timezone) ?? 'Not available'
    : 'Not available';

  return { finish, leave, routeTime };
}

export function formatAssignedRouteEta(estimatedArrivalAt: string | null | undefined, timezone: string): string | null {
  if (estimatedArrivalAt === null || estimatedArrivalAt === undefined) {
    return null;
  }

  const parsed = new Date(estimatedArrivalAt);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: DEFAULT_ASSIGNED_ROUTE_TIMEZONE,
    }).format(parsed);
  }
}

export function hasAssignedRouteGeometry(route: AssignedRoute): boolean {
  return route.routeGeometry !== null && route.routeGeometry.coordinates.length >= 2;
}

export function formatAssignedRouteItemOptions(item: Pick<AssignedRouteOrderItem, 'options'>): string {
  return item.options.map((option) => `${option.key}: ${option.value}`).join(', ');
}

export function formatAssignedRouteItemLine(item: AssignedRouteOrderItem): string {
  const options = formatAssignedRouteItemOptions(item);
  return `${item.name}${options.length === 0 ? '' : ` (${options})`}: ${item.quantity}`;
}

export function resolveRouteMapPreviewState(input: {
  loadStatus: RouteMapPreviewLoadStatus;
  now: Date;
  preview: AssignedRouteMapPreview | null;
}): RouteMapPreviewState {
  if (input.preview === null) {
    return {
      kind: 'missing',
      message: 'Route preview unavailable. You can still open navigation for each stop.',
    };
  }

  if (input.loadStatus === 'failed') {
    return {
      kind: 'failed',
      message: 'Map preview couldn’t load. Route details are still available.',
    };
  }

  const expiresAt = Date.parse(input.preview.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now.getTime()) {
    return {
      kind: 'expired',
      message: 'Map preview couldn’t load. Route details are still available.',
    };
  }

  return {
    accessibilityLabel: input.preview.altText,
    imageUrl: input.preview.imageUrl,
    kind: 'available',
  };
}

function readAssignedRouteEnvelope(payload: unknown): AssignedRouteLookupResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid assigned route response');
  }

  const data = (payload as { data?: unknown }).data;
  const result = readAssignedRouteLookupResult(data);
  if (result === null) {
    throw new Error('Invalid assigned route response');
  }

  return result;
}

function readAssignedRouteLookupResult(value: unknown): AssignedRouteLookupResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;
  if (result.status === 'NO_ASSIGNED_ROUTE') {
    return { status: 'NO_ASSIGNED_ROUTE' };
  }

  if (result.status === 'ASSIGNED_ROUTE' && isAssignedRoute(result.route)) {
    return { status: 'ASSIGNED_ROUTE', route: normalizeAssignedRoute(result.route) };
  }

  return null;
}

function isAssignedRoute(value: unknown): value is AssignedRoute {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const route = value as Record<string, unknown>;
  return (
    typeof route.deliveryDate === 'string' &&
    typeof route.id === 'string' &&
    typeof route.name === 'string' &&
    (route.routeGeometry === undefined || route.routeGeometry === null || isAssignedRouteGeometry(route.routeGeometry)) &&
    (route.routeMapPreview === undefined || route.routeMapPreview === null || isAssignedRouteMapPreview(route.routeMapPreview)) &&
    (route.routeMetrics === undefined || route.routeMetrics === null || isAssignedRouteMetrics(route.routeMetrics)) &&
    (route.routeStopPoints === undefined || (Array.isArray(route.routeStopPoints) && route.routeStopPoints.every(isAssignedRouteStopPoint))) &&
    (route.scheduledStartAt === undefined || nullableString(route.scheduledStartAt)) &&
    typeof route.shopDomain === 'string' &&
    Array.isArray(route.stops) &&
    route.stops.every(isAssignedRouteStop) &&
    (route.etaSnapshot === undefined || route.etaSnapshot === null || isAssignedRouteEtaSnapshot(route.etaSnapshot)) &&
    nullableString(route.timezone)
  );
}

function normalizeAssignedRoute(route: AssignedRoute): AssignedRoute {
  return {
    ...route,
    routeGeometry: route.routeGeometry ?? null,
    routeMapPreview: route.routeMapPreview ?? null,
    routeMetrics: route.routeMetrics ?? null,
    routeStopPoints: route.routeStopPoints ?? [],
    scheduledStartAt: route.scheduledStartAt ?? null,
    stops: route.stops.map(normalizeAssignedRouteStop),
    etaSnapshot: route.etaSnapshot ?? null,
    timezone: route.timezone ?? DEFAULT_ASSIGNED_ROUTE_TIMEZONE,
  };
}

function normalizeAssignedRouteStop(stop: AssignedRouteStop): AssignedRouteStop {
  return {
    ...stop,
    coordinates: normalizeAssignedRouteCoordinates(stop.coordinates),
    customerNote: stop.customerNote ?? null,
    distanceFromPreviousMeters: stop.distanceFromPreviousMeters ?? null,
    durationFromPreviousSeconds: stop.durationFromPreviousSeconds ?? null,
    estimatedArrivalAt: stop.estimatedArrivalAt ?? null,
    items: stop.items.map((item) => ({
      ...item,
      options: [...item.options],
    })),
  };
}

function isAssignedRouteMapPreview(value: unknown): value is AssignedRouteMapPreview {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const preview = value as Record<string, unknown>;
  return (
    preview.kind === 'static_route_map' &&
    typeof preview.imageUrl === 'string' &&
    preview.imageUrl.trim().length > 0 &&
    typeof preview.width === 'number' &&
    Number.isFinite(preview.width) &&
    preview.width > 0 &&
    typeof preview.height === 'number' &&
    Number.isFinite(preview.height) &&
    preview.height > 0 &&
    preview.contentType === 'image/png' &&
    typeof preview.generatedAt === 'string' &&
    typeof preview.expiresAt === 'string' &&
    typeof preview.routeSequenceChecksum === 'string' &&
    typeof preview.altText === 'string' &&
    preview.altText.trim().length > 0
  );
}

function isAssignedRouteGeometry(value: unknown): value is AssignedRouteGeometry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const geometry = value as Record<string, unknown>;
  return (
    geometry.type === 'LineString' &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(isAssignedRouteLngLat)
  );
}

function isAssignedRouteMetrics(value: unknown): value is AssignedRouteMetrics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const metrics = value as Record<string, unknown>;
  return nullableFiniteNumber(metrics.distanceMeters) && nullableFiniteNumber(metrics.durationSeconds);
}

function isAssignedRouteStopPoint(value: unknown): value is AssignedRouteStopPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const stopPoint = value as Record<string, unknown>;
  return (
    typeof stopPoint.deliveryStopId === 'string' &&
    (stopPoint.inputCoordinates === null || isAssignedRouteLngLat(stopPoint.inputCoordinates)) &&
    nullableString(stopPoint.name) &&
    typeof stopPoint.sequence === 'number' &&
    nullableFiniteNumber(stopPoint.snapDistanceMeters) &&
    (stopPoint.snappedCoordinates === null || isAssignedRouteLngLat(stopPoint.snappedCoordinates))
  );
}

export function isAssignedRouteEtaSnapshot(value: unknown): value is AssignedRouteEtaSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Record<string, unknown>;
  if (snapshot.status === 'PRE_PICKUP') {
    return (
      snapshot.calculatedAt === null
      && snapshot.failureCode === null
      && snapshot.failureMessage === null
      && snapshot.pickupCompletedAt === null
      && snapshot.nextStopEta === null
      && snapshot.remainingRouteEta === null
    );
  }

  if (snapshot.status === 'READY') {
    return (
      nullableString(snapshot.calculatedAt)
      && snapshot.failureCode === null
      && snapshot.failureMessage === null
      && isNonEmptyString(snapshot.pickupCompletedAt)
      && isAssignedRouteEtaSnapshotStop(snapshot.nextStopEta)
      && isNonEmptyString(snapshot.nextStopEta.deliveryStopId)
      && isNonEmptyString(snapshot.nextStopEta.estimatedArrivalAt)
      && isAssignedRouteEtaRemaining(snapshot.remainingRouteEta)
      && isNonEmptyString(snapshot.remainingRouteEta.estimatedCompletionAt)
    );
  }

  if (snapshot.status === 'FAILED') {
    return (
      nullableString(snapshot.calculatedAt)
      && isNonEmptyString(snapshot.failureCode)
      && isNonEmptyString(snapshot.failureMessage)
      && isNonEmptyString(snapshot.pickupCompletedAt)
      && (snapshot.nextStopEta === null || isAssignedRouteEtaSnapshotStop(snapshot.nextStopEta))
      && (snapshot.remainingRouteEta === null || isAssignedRouteEtaRemaining(snapshot.remainingRouteEta))
    );
  }

  return false;
}

function isAssignedRouteEtaRemaining(value: unknown): value is AssignedRouteEtaRemaining {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const remaining = value as Record<string, unknown>;
  return (
    nullableFiniteNumber(remaining.distanceMeters)
    && (remaining.estimatedCompletionAt === null || typeof remaining.estimatedCompletionAt === 'string')
  );
}

function isAssignedRouteEtaSnapshotStop(value: unknown): value is AssignedRouteEtaSnapshotStop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const stop = value as Record<string, unknown>;
  return (
    (stop.deliveryStopId === null || typeof stop.deliveryStopId === 'string')
    && nullableFiniteNumber(stop.distanceFromPreviousMeters)
    && nullableString(stop.estimatedArrivalAt)
    && typeof stop.sequence === 'number'
    && Number.isInteger(stop.sequence)
  );
}

function isAssignedRouteStop(value: unknown): value is AssignedRouteStop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const stop = value as Record<string, unknown>;
  return (
    isAssignedRouteAddress(stop.address) &&
    (stop.coordinates === null || isNullableAssignedRouteCoordinates(stop.coordinates)) &&
    (stop.currencyCode === undefined || nullableString(stop.currencyCode)) &&
    (stop.customerNote === undefined || nullableString(stop.customerNote)) &&
    (stop.deliverySession === undefined || nullableString(stop.deliverySession)) &&
    typeof stop.deliveryStopId === 'string' &&
    (stop.distanceFromPreviousMeters === undefined || nullableFiniteNumber(stop.distanceFromPreviousMeters)) &&
    (stop.durationFromPreviousSeconds === undefined || nullableFiniteNumber(stop.durationFromPreviousSeconds)) &&
    (stop.estimatedArrivalAt === undefined || nullableString(stop.estimatedArrivalAt)) &&
    Array.isArray(stop.items) &&
    stop.items.every(isAssignedRouteOrderItem) &&
    (stop.navigationTarget === undefined || isAssignedRouteNavigationTarget(stop.navigationTarget)) &&
    isNormalizedPaymentStatus(stop.normalizedPaymentStatus) &&
    typeof stop.orderName === 'string' &&
    (stop.paymentMethodTitle === undefined || nullableString(stop.paymentMethodTitle)) &&
    nullableString(stop.phone) &&
    nullableString(stop.recipientName) &&
    typeof stop.sequence === 'number' &&
    (stop.serviceType === undefined || nullableString(stop.serviceType)) &&
    typeof stop.status === 'string' &&
    (stop.totalPriceAmount === undefined || nullableMoneyString(stop.totalPriceAmount))
  );
}

function isAssignedRouteOrderItem(value: unknown): value is AssignedRouteOrderItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.name === 'string' &&
    Array.isArray(item.options) &&
    item.options.every(isAssignedRouteOrderItemOption) &&
    typeof item.productId === 'number' &&
    Number.isFinite(item.productId) &&
    typeof item.quantity === 'number' &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0 &&
    nullableString(item.sku) &&
    typeof item.variationId === 'number' &&
    Number.isFinite(item.variationId)
  );
}

function isAssignedRouteOrderItemOption(value: unknown): value is AssignedRouteOrderItemOption {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const option = value as Record<string, unknown>;
  return typeof option.key === 'string' && typeof option.value === 'string';
}

function isNormalizedPaymentStatus(value: unknown): value is NormalizedPaymentStatus | null {
  return value === null || NORMALIZED_PAYMENT_STATUSES.some((status) => status === value);
}

function isAssignedRouteAddress(value: unknown): value is AssignedRouteAddress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const address = value as Record<string, unknown>;
  return (
    typeof address.address1 === 'string' &&
    nullableString(address.address2) &&
    typeof address.city === 'string' &&
    typeof address.countryCode === 'string' &&
    typeof address.postalCode === 'string' &&
    typeof address.province === 'string'
  );
}

function isAssignedRouteCoordinates(value: unknown): value is AssignedRouteCoordinates {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const coordinates = value as Record<string, unknown>;
  return typeof coordinates.latitude === 'number'
    && Number.isFinite(coordinates.latitude)
    && typeof coordinates.longitude === 'number'
    && Number.isFinite(coordinates.longitude);
}

function isNullableAssignedRouteCoordinates(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const coordinates = value as Record<string, unknown>;
  return nullableFiniteNumber(coordinates.latitude) && nullableFiniteNumber(coordinates.longitude);
}

function normalizeAssignedRouteCoordinates(value: unknown): AssignedRouteCoordinates | null {
  return isAssignedRouteCoordinates(value) ? value : null;
}

function isAssignedRouteNavigationTarget(value: unknown): value is AssignedRouteNavigationTarget {
  return value === 'ADDRESS' || value === 'COORDINATES';
}

function isAssignedRouteLngLat(value: unknown): value is AssignedRouteLngLat {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }

  const longitude = value[0];
  const latitude = value[1];
  return (
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function nullableMoneyString(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string'
    && /^-?\d+(?:\.\d+)?$/u.test(value.trim())
  );
}

export function formatAssignedRoutePaymentStatus(
  status: NormalizedPaymentStatus | null,
): AssignedRoutePaymentCopy {
  switch (status) {
    case 'PAID_CONFIRMED':
      return {
        detail: 'Payment is confirmed in WooCommerce. Do not request payment at delivery.',
        label: 'Paid confirmed',
        tone: 'green',
      };
    case 'CASH_COLLECT_REQUIRED':
      return {
        detail: 'Cash was selected. Collect payment directly at delivery.',
        label: 'Collect cash',
        tone: 'warning',
      };
    case 'TRANSFER_CHECK_PENDING':
      return {
        detail: 'E-mail/bank transfer still needs WooCommerce/admin confirmation. Do not ask again until confirmed by dispatch.',
        label: 'Transfer pending',
        tone: 'warning',
      };
    case 'ONLINE_PAYMENT_PENDING_OR_FAILED':
      return {
        detail: 'Online/card payment is not confirmed. Check with dispatch before requesting anything from the customer.',
        label: 'Online pending',
        tone: 'warning',
      };
    case 'NOT_DELIVERABLE_OR_EXCEPTION':
      return {
        detail: 'WooCommerce reports a cancelled, refunded, failed, or otherwise exceptional order status.',
        label: 'Payment exception',
        tone: 'warning',
      };
    case 'UNKNOWN_REVIEW':
      return {
        detail: 'Payment method/status is unknown to CLEVER Route. Ask dispatch/admin to review.',
        label: 'Review payment',
        tone: 'warning',
      };
    case null:
      return {
        detail: 'No normalized payment state was provided for this stop.',
        label: 'Payment unavailable',
        tone: 'neutral',
      };
  }
}

export function formatAssignedRoutePaymentSummary(
  stop: Pick<
    AssignedRouteStop,
    'currencyCode'
    | 'deliverySession'
    | 'normalizedPaymentStatus'
    | 'paymentMethodTitle'
    | 'serviceType'
    | 'totalPriceAmount'
  >,
): AssignedRoutePaymentSummary {
  const amountLabel = formatAssignedRoutePaymentAmount(
    stop.totalPriceAmount ?? null,
    stop.currencyCode ?? null,
  );
  if (isAssignedRoutePickupStop(stop)) {
    return {
      amountLabel,
      detail: '',
      methodLabel: 'Pickup',
      notificationLabel: 'Pickup',
      status: {
        detail: '',
        label: 'Pickup',
        tone: 'warning',
      },
    };
  }

  const status = formatAssignedRoutePaymentStatus(stop.normalizedPaymentStatus);
  const methodLabel = stop.paymentMethodTitle?.trim()
    || getFallbackPaymentMethodLabel(stop.normalizedPaymentStatus);
  const displayStatus = stop.normalizedPaymentStatus === 'CASH_COLLECT_REQUIRED'
    && amountLabel === 'Amount unavailable'
    ? {
      detail: 'The exact cash total is missing from the server response.',
      label: 'Amount unavailable',
      tone: 'warning' as const,
    }
    : status;

  let detail = displayStatus.detail;
  if (stop.normalizedPaymentStatus === 'CASH_COLLECT_REQUIRED') {
    detail = amountLabel === 'Amount unavailable'
      ? 'Do not request cash until dispatch provides the exact total.'
      : `Collect exactly ${amountLabel} from the customer.`;
  } else if (stop.normalizedPaymentStatus === 'TRANSFER_CHECK_PENDING') {
    detail = 'Transfer is not confirmed. Ask the customer only when dispatch requires collection.';
  } else if (stop.normalizedPaymentStatus === 'PAID_CONFIRMED') {
    detail = 'Payment is confirmed. Do not request payment from the customer.';
  }

  return {
    amountLabel,
    detail,
    methodLabel,
    notificationLabel: displayStatus.label === amountLabel
      ? `${methodLabel}, ${amountLabel}`
      : `${methodLabel}, ${displayStatus.label}, ${amountLabel}`,
    status: displayStatus,
  };
}

export function formatAssignedRouteCompactPaymentAmount(
  amount: string | null | undefined,
  currencyCode: string | null | undefined,
): string {
  return formatAssignedRoutePaymentAmount(amount ?? null, currencyCode ?? null, 'narrowSymbol');
}

export function isAssignedRoutePickupStop(
  stop: Pick<AssignedRouteStop, 'deliverySession' | 'serviceType'>,
): boolean {
  return [stop.deliverySession, stop.serviceType].some(
    (value) => value?.trim().toUpperCase() === 'PICKUP',
  );
}

function formatAssignedRoutePaymentAmount(
  amount: string | null,
  currencyCode: string | null,
  currencyDisplay: 'code' | 'narrowSymbol' = 'code',
): string {
  const normalizedAmount = amount?.trim() ?? '';
  const normalizedCurrency = currencyCode?.trim().toUpperCase() ?? '';
  if (
    !/^-?\d+(?:\.\d+)?$/u.test(normalizedAmount)
    || !/^[A-Z]{3}$/u.test(normalizedCurrency)
  ) {
    return 'Amount unavailable';
  }

  const numericAmount = Number(normalizedAmount);
  if (!Number.isFinite(numericAmount)) {
    return 'Amount unavailable';
  }

  try {
    return new Intl.NumberFormat('en-CA', {
      currency: normalizedCurrency,
      currencyDisplay,
      style: 'currency',
    }).format(numericAmount).replace(/\s+/gu, ' ');
  } catch {
    return 'Amount unavailable';
  }
}

function getFallbackPaymentMethodLabel(status: NormalizedPaymentStatus | null): string {
  switch (status) {
    case 'CASH_COLLECT_REQUIRED':
      return 'Cash';
    case 'TRANSFER_CHECK_PENDING':
      return 'eTransfer';
    case 'ONLINE_PAYMENT_PENDING_OR_FAILED':
      return 'Online payment';
    default:
      return 'Payment';
  }
}
