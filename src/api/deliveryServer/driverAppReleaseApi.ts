import {
  readDriverAppReleaseManifest,
  type DriverAppReleaseManifest,
} from '../../domain/appUpdate/driverAppUpdate';
import { withNoStoreDriverApiRequest } from './driverApiRequestOptions';

export type DriverAppReleaseService = {
  getAndroidRelease(): Promise<DriverAppReleaseManifest>;
};

export type DriverAppReleaseFetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

export function createDriverAppReleaseApiClient(input: {
  baseUrl: string;
  fetchImpl?: DriverAppReleaseFetchLike;
  timeoutMs?: number;
}): DriverAppReleaseService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? 3_000;

  return {
    getAndroidRelease: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          `${baseUrl}/driver-app/release/android`,
          withNoStoreDriverApiRequest<{
            headers?: Record<string, string>;
            method: string;
            signal: AbortSignal;
          }>({
            method: 'GET',
            signal: controller.signal,
          }),
        );
        if (!response.ok) {
          throw new Error(`Driver app release request failed with ${response.status}`);
        }

        const payload = await response.json();
        if (!isRecord(payload) || payload.error !== null) {
          throw new Error('Invalid driver app release response');
        }
        return readDriverAppReleaseManifest(payload.data);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
