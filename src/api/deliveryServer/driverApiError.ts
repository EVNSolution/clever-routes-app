export const DRIVER_ACCESS_EXPIRED_MESSAGE =
  'Driver session expired. Look up the route with route context and phone again.';

export class DriverApiHttpError extends Error {
  readonly endpoint: string;
  readonly status: number | 'unknown';

  constructor(input: { endpoint: string; status: number | 'unknown' }) {
    super(`${input.endpoint} failed with HTTP ${input.status}`);
    this.name = 'DriverApiHttpError';
    this.endpoint = input.endpoint;
    this.status = input.status;
  }
}

export function createDriverApiHttpError(input: {
  endpoint: string;
  status?: number;
}): DriverApiHttpError {
  return new DriverApiHttpError({
    endpoint: input.endpoint,
    status: input.status ?? 'unknown',
  });
}

export function isDriverApiUnauthorizedError(error: unknown): boolean {
  return error instanceof DriverApiHttpError && error.status === 401;
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
