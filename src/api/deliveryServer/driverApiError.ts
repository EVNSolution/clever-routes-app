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
  return error instanceof DriverApiHttpError && error.code === 'ROUTE_NOT_IN_PROGRESS';
}

export function getDriverApiRecoveryReason(error: unknown): 'driver_access_expired' | undefined {
  return isDriverApiUnauthorizedError(error) ? 'driver_access_expired' : undefined;
}

export function getDriverApiRequiresRouteLookup(error: unknown): true | undefined {
  return getDriverApiRecoveryReason(error) === undefined ? undefined : true;
}

export function formatDriverApiErrorForDriver(error: unknown): string {
  if (isDriverApiUnauthorizedError(error)) {
    return `${DRIVER_ACCESS_EXPIRED_MESSAGE} (HTTP 401)`;
  }

  return error instanceof Error ? error.message : 'unknown error';
}
