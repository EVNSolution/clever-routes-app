import { createDriverApiHttpError, readDriverApiErrorCode } from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import type { DriverEventInput } from './driverEvents';
import { matchesStopCompletionEvent, readStopCompletion, type StopCompletion } from '../stop/stopCompletion';

export type DriverEventReceipt = {
  assignmentGeneration: string | null;
  clientEventId: string;
  completion?: StopCompletion | null;
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
  const requestMatches = receipt.routePlanId === event.routePlanId
    && receipt.clientEventId === event.clientEventId;
  if (!requestMatches || receipt.status === 'REJECTED') return { kind: 'reconcile', receipt };
  if (receipt.status === 'UNKNOWN') {
    // A request that never reached the server has no attempt lineage. Null does not contradict it.
    const lineageConflicts = (receipt.assignmentGeneration !== null
      && receipt.assignmentGeneration !== (event.assignmentGeneration ?? null))
      || (receipt.expectedRouteVersionId !== null
        && receipt.expectedRouteVersionId !== (event.expectedRouteVersionId ?? null));
    if (lineageConflicts) return { kind: 'reconcile', receipt };
    // UNKNOWN is not rejection or permission to rewrite Cash against a newer route.
    return event.completion !== undefined || receipt.routeStatus === 'IN_PROGRESS'
      ? { kind: 'retry', receipt }
      : { kind: 'reconcile', receipt };
  }
  const lineageMatches = receipt.assignmentGeneration === (event.assignmentGeneration ?? null)
    && receipt.expectedRouteVersionId === (event.expectedRouteVersionId ?? null);
  if (!lineageMatches || (event.completion !== undefined && (receipt.completion == null
    || !matchesStopCompletionEvent(receipt.completion, event)))) return { kind: 'reconcile', receipt };
  return { kind: 'acknowledge', receipt };
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
  const completion = readStopCompletion(receipt.completion);
  if (
    !isNullableString(receipt.assignmentGeneration)
    || typeof receipt.clientEventId !== 'string'
    || !isNullableString(receipt.errorCode)
    || !isNullableString(receipt.expectedRouteVersionId)
    || typeof receipt.routePlanId !== 'string'
    || typeof receipt.routeStatus !== 'string'
    || !['APPLIED', 'REJECTED', 'UNKNOWN'].includes(String(receipt.status))
    || (receipt.completion !== undefined && receipt.completion !== null && completion === null)
  ) throw new Error('Invalid driver event receipt response');
  return {
    ...receipt,
    ...(receipt.completion === undefined ? {} : { completion }),
  } as DriverEventReceipt;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
