import { createDriverApiHttpError, readDriverApiErrorCode } from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import type { DriverEventInput } from './driverEvents';

export type DriverEventReceipt = {
  assignmentGeneration: string | null;
  clientEventId: string;
  errorCode: string | null;
  expectedRouteVersionId: string | null;
  routePlanId: string;
  routeStatus: string;
  status: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
};

export type DriverEventReceiptService = {
  lookupReceipt(
    input: { clientEventId: string; routePlanId: string },
    options?: { signal?: AbortSignal },
  ): Promise<DriverEventReceipt>;
};

export type CompletionReceiptResolution =
  | { kind: 'acknowledge'; receipt: DriverEventReceipt }
  | { kind: 'reconcile'; receipt: DriverEventReceipt }
  | { kind: 'retry'; receipt: DriverEventReceipt };

type FetchLike = (input: string, init?: {
  cache?: 'no-store';
  credentials?: 'omit';
  headers?: Record<string, string>;
  method?: string;
  signal?: AbortSignal;
}) => Promise<{ json(): Promise<unknown>; ok: boolean; status?: number }>;

export function createDriverEventReceiptApiClient(input: {
  accountAccessToken: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): DriverEventReceiptService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  return {
    lookupReceipt: async ({ clientEventId, routePlanId }, options) => {
      const response = await fetchImpl(
        `${baseUrl}/driver/event-receipts/${encodeURIComponent(routePlanId)}/${encodeURIComponent(clientEventId)}`,
        withNoStoreDriverApiRequest({
          headers: { Authorization: `Bearer ${input.accountAccessToken.trim()}` },
          method: 'GET',
          signal: options?.signal,
        }),
      );
      const payload = await response.json();
      if (!response.ok) {
        throw createDriverApiHttpError({
          code: readDriverApiErrorCode(payload),
          endpoint: 'Driver event receipt lookup',
          status: response.status,
        });
      }
      return readDriverEventReceiptEnvelope(payload);
    },
  };
}

export function resolveCompletionReceipt(
  event: DriverEventInput,
  receipt: DriverEventReceipt,
): CompletionReceiptResolution {
  const lineageMatches = receipt.routePlanId === event.routePlanId
    && receipt.clientEventId === event.clientEventId
    && receipt.assignmentGeneration === (event.assignmentGeneration ?? null)
    && receipt.expectedRouteVersionId === (event.expectedRouteVersionId ?? null);
  if (!lineageMatches || receipt.status === 'REJECTED') return { kind: 'reconcile', receipt };
  if (receipt.status === 'APPLIED') return { kind: 'acknowledge', receipt };
  return receipt.routeStatus === 'IN_PROGRESS'
    ? { kind: 'retry', receipt }
    : { kind: 'reconcile', receipt };
}

function readDriverEventReceiptEnvelope(payload: unknown): DriverEventReceipt {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid driver event receipt response');
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid driver event receipt response');
  }
  const receipt = data as Record<string, unknown>;
  if (
    !isNullableString(receipt.assignmentGeneration)
    || typeof receipt.clientEventId !== 'string'
    || !isNullableString(receipt.errorCode)
    || !isNullableString(receipt.expectedRouteVersionId)
    || typeof receipt.routePlanId !== 'string'
    || typeof receipt.routeStatus !== 'string'
    || !['APPLIED', 'REJECTED', 'UNKNOWN'].includes(String(receipt.status))
  ) throw new Error('Invalid driver event receipt response');
  return receipt as DriverEventReceipt;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
