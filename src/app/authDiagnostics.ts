import { DriverApiHttpError } from '../api/deliveryServer/driverApiError';
import type { DriverRuntimeConfig } from './config/driverRuntimeConfig';

export type AuthPhase = 'route_access' | 'invite_verify';

export type AuthFailureKind =
  | 'mock_mode'
  | 'request_not_sent'
  | 'network_failure'
  | 'server_400'
  | 'server_401'
  | 'stale_build'
  | 'server_other_error';

export type AuthFailure = {
  kind: AuthFailureKind;
  message: string;
};

export function isStaleClientContractError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['Invalid route access response', 'Invalid driver auth response'].some((pattern) => error.message.includes(pattern))
  );
}

function isRequestNotSentError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.toLowerCase().includes('fetch')
  );
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'network request failed',
      'failed to fetch',
      'networkerror',
      'network error',
      'econnreset',
    ].some((token) => error.message.toLowerCase().includes(token))
  );
}

export function getRuntimeHostLabel(runtimeConfig: DriverRuntimeConfig): string {
  return runtimeConfig.mode === 'mock'
    ? 'mock mode (local services)'
    : `live server ${runtimeConfig.deliveryServerBaseUrl}`;
}

export function buildAuthFailureMessage(input: {
  runtimeConfig: DriverRuntimeConfig;
  phase: AuthPhase;
  error: unknown;
}): AuthFailure {
  const phaseLabel = input.phase === 'invite_verify' ? 'Invite verification' : 'Route access lookup';

  if (input.runtimeConfig.mode === 'mock') {
    return {
      kind: 'mock_mode',
      message: `${phaseLabel}: running in mock mode; no live request was sent.`,
    };
  }

  if (isRequestNotSentError(input.error)) {
    return {
      kind: 'request_not_sent',
      message: `${phaseLabel}: request was not sent. Verify the app bundle and live-server connectivity.`,
    };
  }

  if (isNetworkError(input.error)) {
    return {
      kind: 'network_failure',
      message: `${phaseLabel}: network request failed. Retry after checking connectivity.`,
    };
  }

  if (isStaleClientContractError(input.error)) {
    return {
      kind: 'stale_build',
      message: `${phaseLabel}: server response shape mismatch; this app build may be stale.`,
    };
  }

  if (input.error instanceof DriverApiHttpError) {
    return {
      kind: input.error.status === 401 ? 'server_401' : input.error.status === 400 ? 'server_400' : 'server_other_error',
      message: `${phaseLabel}: ${formatDriverApiStatusMessage(input.error.status)}.`,
    };
  }

  return {
    kind: 'server_other_error',
    message: `${phaseLabel}: unable to complete. Contact dispatch if this continues.`,
  };
}

export function buildAuthSuccessMessage(input: {
  runtimeConfig: DriverRuntimeConfig;
  phase: AuthPhase;
}): string {
  const phaseLabel = input.phase === 'invite_verify' ? 'Invite verification' : 'Route access lookup';
  return `${phaseLabel} succeeded via ${getRuntimeHostLabel(input.runtimeConfig)}.`;
}

function formatDriverApiStatusMessage(status: DriverApiHttpError['status']): string {
  if (status === 400) {
    return 'server returned 400 (request payload mismatch)';
  }

  if (status === 401) {
    return 'server returned 401 (session expired or unauthorized)';
  }

  if (status === 'unknown') {
    return 'server returned unknown HTTP status';
  }

  return `server returned HTTP ${status}`;
}
