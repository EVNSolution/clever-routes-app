import { createMockRouteAccessService, createRouteAccessApiClient, type FetchLike, type RouteAccessService } from '../../domain/routeAccess/routeAccess';

export type DriverRuntimeConfig =
  | {
      mode: 'mock';
    }
  | {
      deliveryServerBaseUrl: string;
      mode: 'live';
    };

export type DriverRuntimeServices = {
  routeAccessService: RouteAccessService;
};

export function readDriverRuntimeConfig(env: Partial<Record<'EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL', string>>): DriverRuntimeConfig {
  const deliveryServerBaseUrl = env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL?.trim();
  if (deliveryServerBaseUrl === undefined || deliveryServerBaseUrl === '') {
    return { mode: 'mock' };
  }

  return {
    deliveryServerBaseUrl,
    mode: 'live',
  };
}

export function createDriverRuntimeServices(input: {
  config: DriverRuntimeConfig;
  fetchImpl?: FetchLike;
}): DriverRuntimeServices {
  if (input.config.mode === 'mock') {
    return {
      routeAccessService: createMockRouteAccessService(),
    };
  }

  return {
    routeAccessService: createRouteAccessApiClient({
      baseUrl: input.config.deliveryServerBaseUrl,
      fetchImpl: input.fetchImpl,
    }),
  };
}
