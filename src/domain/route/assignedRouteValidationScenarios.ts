import type { AssignedRoute } from './assignedRoute';

export type AssignedRouteValidationTab = 'active' | 'completed' | 'ready';

export type AssignedRouteValidationScenario = {
  expectedEvidence: {
    hasCoordinatesForEveryStop: boolean;
    hasOsrmGeometry: boolean;
    hasOsrmMetrics: boolean;
    safeForOperationalSmoke: boolean;
  };
  id: string;
  label: string;
  route: AssignedRoute;
  tab: AssignedRouteValidationTab;
};

export const assignedRouteValidationScenarios: AssignedRouteValidationScenario[] = [
  {
    expectedEvidence: {
      hasCoordinatesForEveryStop: true,
      hasOsrmGeometry: true,
      hasOsrmMetrics: true,
      safeForOperationalSmoke: true,
    },
    id: 'validation-ready-osrm-route',
    label: 'Ready tab — synthetic Toronto route with OSRM geometry and route-level metrics',
    route: buildValidationRoute({
      deliveryDate: '2026-06-04',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      metrics: { distanceMeters: 6120.4, durationSeconds: 1680 },
      name: '[TEST] OSRM Ready Route',
      stops: [
        validationStop({
          address1: '100 King St W',
          deliveryStopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          latitude: 43.6487,
          longitude: -79.3817,
          orderName: '#TEST-OSRM-1001',
          postalCode: 'M5X 1A9',
          recipientName: 'TEST Recipient Ready 1',
          sequence: 1,
        }),
        validationStop({
          address1: '200 Queen St W',
          address2: 'Unit 4',
          deliveryStopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          latitude: 43.6509,
          longitude: -79.3909,
          orderName: '#TEST-OSRM-1002',
          postalCode: 'M5V 1Z2',
          recipientName: 'TEST Recipient Ready 2',
          sequence: 2,
        }),
      ],
    }),
    tab: 'ready',
  },
  {
    expectedEvidence: {
      hasCoordinatesForEveryStop: true,
      hasOsrmGeometry: true,
      hasOsrmMetrics: true,
      safeForOperationalSmoke: true,
    },
    id: 'validation-active-return-to-depot',
    label: 'Active tab — synthetic route in progress with return-to-depot geometry',
    route: buildValidationRoute({
      deliveryDate: '2026-06-04',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      metrics: { distanceMeters: 8740, durationSeconds: 2460 },
      name: '[TEST] OSRM Active Return Route',
      stops: [
        validationStop({
          address1: '40 College St',
          deliveryStopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
          latitude: 43.6613,
          longitude: -79.383,
          orderName: '#TEST-OSRM-2001',
          postalCode: 'M5G 2J3',
          recipientName: 'TEST Recipient Active 1',
          sequence: 1,
          status: 'IN_TRANSIT',
        }),
        validationStop({
          address1: '500 Bloor St W',
          deliveryStopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
          latitude: 43.6655,
          longitude: -79.4104,
          orderName: '#TEST-OSRM-2002',
          postalCode: 'M5S 1Y3',
          recipientName: 'TEST Recipient Active 2',
          sequence: 2,
          status: 'ASSIGNED',
        }),
      ],
    }),
    tab: 'active',
  },
  {
    expectedEvidence: {
      hasCoordinatesForEveryStop: true,
      hasOsrmGeometry: false,
      hasOsrmMetrics: false,
      safeForOperationalSmoke: true,
    },
    id: 'validation-completed-osrm-fallback',
    label: 'Completed tab — synthetic route with OSRM unavailable fallback fields',
    route: {
      ...buildValidationRoute({
        deliveryDate: '2026-06-04',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        metrics: null,
        name: '[TEST] OSRM Fallback Completed Route',
        stops: [
          validationStop({
            address1: '1 Blue Jays Way',
            deliveryStopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
            latitude: 43.6414,
            longitude: -79.3894,
            orderName: '#TEST-OSRM-3001',
            postalCode: 'M5V 1J1',
            recipientName: 'TEST Recipient Completed 1',
            sequence: 1,
            status: 'DELIVERED',
          }),
        ],
      }),
      routeGeometry: null,
      routeMetrics: null,
      routeStopPoints: [],
    },
    tab: 'completed',
  },
];

function buildValidationRoute(input: {
  deliveryDate: string;
  id: string;
  metrics: AssignedRoute['routeMetrics'];
  name: string;
  stops: AssignedRoute['stops'];
}): AssignedRoute {
  const geometryCoordinates: [number, number][] = [
    [-79.3832, 43.6532],
    ...input.stops.flatMap((stop) => (
      stop.coordinates === null
        ? []
        : [[stop.coordinates.longitude, stop.coordinates.latitude] as [number, number]]
    )),
  ];

  return {
    deliveryDate: input.deliveryDate,
    id: input.id,
    name: input.name,
    routeGeometry: geometryCoordinates.length >= 2 ? { coordinates: geometryCoordinates, type: 'LineString' } : null,
    routeMapPreview: null,
    routeMetrics: input.metrics,
    routeStopPoints: input.stops.map((stop) => ({
      deliveryStopId: stop.deliveryStopId,
      inputCoordinates: stop.coordinates === null ? null : [stop.coordinates.longitude, stop.coordinates.latitude],
      name: stop.address.address1,
      sequence: stop.sequence,
      snapDistanceMeters: 5,
      snappedCoordinates: stop.coordinates === null ? null : [stop.coordinates.longitude, stop.coordinates.latitude],
    })),
    shopDomain: 'validation-only.example.test',
    stops: input.stops,
    timezone: 'America/Toronto',
  };
}

function validationStop(input: {
  address1: string;
  address2?: string;
  deliveryStopId: string;
  latitude: number;
  longitude: number;
  normalizedPaymentStatus?: AssignedRoute['stops'][number]['normalizedPaymentStatus'];
  orderName: string;
  postalCode: string;
  recipientName: string;
  sequence: number;
  status?: string;
}): AssignedRoute['stops'][number] {
  return {
    address: {
      address1: input.address1,
      address2: input.address2 ?? null,
      city: 'Toronto',
      countryCode: 'CA',
      postalCode: input.postalCode,
      province: 'ON',
    },
    coordinates: {
      latitude: input.latitude,
      longitude: input.longitude,
    },
    deliveryStopId: input.deliveryStopId,
    items: [
      {
        name: 'Validation tomato box',
        options: [{ key: 'Scenario', value: input.orderName }],
        productId: 9001,
        quantity: 1,
        sku: null,
        variationId: 0,
      },
    ],
    normalizedPaymentStatus: input.normalizedPaymentStatus ?? 'PAID_CONFIRMED',
    orderName: input.orderName,
    phone: '+14165550100',
    recipientName: input.recipientName,
    sequence: input.sequence,
    status: input.status ?? 'ASSIGNED',
  };
}
