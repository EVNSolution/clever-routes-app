export const DRIVER_ACCESS_EXPIRED_MESSAGE =
  'Driver session expired. Look up the route with route context and phone again.';

export class DriverApiHttpError extends Error {
  readonly code?: string;
  readonly endpoint: string;
  readonly status: number | 'unknown';

  constructor(input: { code?: string; endpoint: string; status: number | 'unknown' }) {
    super(`${input.endpoint} failed with HTTP ${input.status}`);
    this.name = 'DriverApiHttpError';
    this.code = input.code;
    this.endpoint = input.endpoint;
    this.status = input.status;
  }
}

export function createDriverApiHttpError(input: {
  code?: string;
  endpoint: string;
  status?: number;
}): DriverApiHttpError {
  return new DriverApiHttpError({
    ...(input.code === undefined ? {} : { code: input.code }),
    endpoint: input.endpoint,
    status: input.status ?? 'unknown',
  });
}

export function readDriverApiErrorCode(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() !== '' ? code : undefined;
}

export function isDriverApiUnauthorizedError(error: unknown): boolean {
  return error instanceof DriverApiHttpError && error.status === 401;
}

export function isDriverRouteNotInProgressError(error: unknown): boolean {
  return error instanceof DriverApiHttpError
    && error.status === 409
    && error.code === 'ROUTE_NOT_IN_PROGRESS';
}

export function isDriverAccountDeletionActiveRouteError(error: unknown): boolean {
  return error instanceof DriverApiHttpError
    && error.status === 409
    && error.code === 'ACCOUNT_DELETION_ACTIVE_ROUTE';
}

export function getDriverApiRecoveryReason(
  error: unknown,
): 'driver_access_expired' | 'route_not_in_progress' | undefined {
  if (isDriverApiUnauthorizedError(error)) {
    return 'driver_access_expired';
  }
  return isDriverRouteNotInProgressError(error) ? 'route_not_in_progress' : undefined;
}

export function getDriverApiRequiresRouteLookup(error: unknown): true | undefined {
  return getDriverApiRecoveryReason(error) === 'driver_access_expired' ? true : undefined;
}

export function getDriverApiRequiresRouteReconciliation(error: unknown): true | undefined {
  return getDriverApiRecoveryReason(error) === 'route_not_in_progress' ? true : undefined;
}

export function formatDriverApiErrorForDriver(error: unknown): string {
  if (isDriverApiUnauthorizedError(error)) {
    return `${DRIVER_ACCESS_EXPIRED_MESSAGE} (HTTP 401)`;
  }
  if (isDriverRouteNotInProgressError(error)) {
    return 'This route was ended or released by the server and needs reconciliation. (HTTP 409)';
  }

  return error instanceof Error ? error.message : 'unknown error';
}
