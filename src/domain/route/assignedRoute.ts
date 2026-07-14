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

export type AssignedRouteStop = {
  address: AssignedRouteAddress;
  coordinates: AssignedRouteCoordinates | null;
  deliveryStopId: string;
  items: AssignedRouteOrderItem[];
  normalizedPaymentStatus: NormalizedPaymentStatus | null;
  orderName: string;
  phone: string | null;
  recipientName: string | null;
  sequence: number;
  status: string;
};

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
  shopDomain: string;
  stops: AssignedRouteStop[];
  timezone: string;
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
      deliveryStopId: '22222222-2222-4222-8222-222222222222',
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
      phone: '+14165550123',
      recipientName: 'Recipient One',
      sequence: 1,
      status: 'ASSIGNED',
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
      deliveryStopId: '33333333-3333-4333-8333-333333333333',
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
      phone: '+14165550124',
      recipientName: 'Recipient Two',
      sequence: 2,
      status: 'ASSIGNED',
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
        message: 'No current or upcoming route is available for this driver and route context.',
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

export function hasAssignedRouteGeometry(route: AssignedRoute): boolean {
  return route.routeGeometry !== null && route.routeGeometry.coordinates.length >= 2;
}

export function formatAssignedRouteItemOptions(item: Pick<AssignedRouteOrderItem, 'options'>): string {
  return item.options.map((option) => `${option.key}: ${option.value}`).join(' · ');
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
    typeof route.shopDomain === 'string' &&
    Array.isArray(route.stops) &&
    route.stops.every(isAssignedRouteStop) &&
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
    stops: route.stops.map(normalizeAssignedRouteStop),
    timezone: route.timezone ?? DEFAULT_ASSIGNED_ROUTE_TIMEZONE,
  };
}

function normalizeAssignedRouteStop(stop: AssignedRouteStop): AssignedRouteStop {
  return {
    ...stop,
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

function isAssignedRouteStop(value: unknown): value is AssignedRouteStop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const stop = value as Record<string, unknown>;
  return (
    isAssignedRouteAddress(stop.address) &&
    (stop.coordinates === null || isAssignedRouteCoordinates(stop.coordinates)) &&
    typeof stop.deliveryStopId === 'string' &&
    Array.isArray(stop.items) &&
    stop.items.every(isAssignedRouteOrderItem) &&
    isNormalizedPaymentStatus(stop.normalizedPaymentStatus) &&
    typeof stop.orderName === 'string' &&
    nullableString(stop.phone) &&
    nullableString(stop.recipientName) &&
    typeof stop.sequence === 'number' &&
    typeof stop.status === 'string'
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
  return typeof coordinates.latitude === 'number' && typeof coordinates.longitude === 'number';
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
