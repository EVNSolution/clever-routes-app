import { createMockRouteAccessService, createRouteAccessApiClient, type FetchLike, type RouteAccessService } from '../../domain/routeAccess/routeAccess';
import { createDriverAuthApiClient, createMockDriverAuthService, type DriverAuthService } from '../../domain/driverAuth/driverAuth';

export type DriverRuntimeConfig =
  | {
      mode: 'mock';
    }
  | {
      deliveryServerBaseUrl: string;
      mode: 'live';
    };

export type DriverRuntimeServices = {
  driverAuthService: DriverAuthService;
  routeAccessService: RouteAccessService;
};

type DriverRuntimeEnv = Partial<Record<
  'EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL' | 'EXPO_PUBLIC_DRIVER_RUNTIME_MODE',
  string
>>;

export function readDriverRuntimeConfig(env: DriverRuntimeEnv): DriverRuntimeConfig {
  const deliveryServerBaseUrl = env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL?.trim();
  const runtimeMode = env.EXPO_PUBLIC_DRIVER_RUNTIME_MODE?.trim().toLowerCase();

  if (runtimeMode !== undefined && runtimeMode !== '' && runtimeMode !== 'live' && runtimeMode !== 'mock') {
    throw new Error('EXPO_PUBLIC_DRIVER_RUNTIME_MODE must be live or mock.');
  }

  if (runtimeMode === 'mock') {
    if (deliveryServerBaseUrl !== undefined && deliveryServerBaseUrl !== '') {
      throw new Error('Mock mode cannot include EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL.');
    }
    return { mode: 'mock' };
  }

  if (deliveryServerBaseUrl === undefined || deliveryServerBaseUrl === '') {
    throw new Error('EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL is required unless EXPO_PUBLIC_DRIVER_RUNTIME_MODE=mock.');
  }
  if (!deliveryServerBaseUrl.toLowerCase().startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL must use HTTPS in live mode.');
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
      driverAuthService: createMockDriverAuthService(),
      routeAccessService: createMockRouteAccessService(),
    };
  }

  return {
    driverAuthService: createDriverAuthApiClient({
      baseUrl: input.config.deliveryServerBaseUrl,
      fetchImpl: input.fetchImpl,
    }),
    routeAccessService: createRouteAccessApiClient({
      baseUrl: input.config.deliveryServerBaseUrl,
      fetchImpl: input.fetchImpl,
    }),
  };
}
