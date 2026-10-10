import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import { createDriverApiHttpError, isDriverApiUnauthorizedError } from '../../api/deliveryServer/driverApiError';
import { withNoStoreDriverApiRequest } from '../../api/deliveryServer/driverApiRequestOptions';
import type { DriverAccountAccessToken, FetchLike } from './driverAuth';

/** A successful receipt is scoped to the current account session. No route assignment is required. */
export function createDeliveryProofCapabilityReporter(input: {
  baseUrl: string; enabled: boolean; installed: {packageId: string; versionCode: number} | null; fetchImpl?: FetchLike;
}): (account: Pick<DriverAccountAccessToken, 'accessToken' | 'refreshToken'>) => Promise<void> {
  let registeredRefreshToken: string | null = null;
  return async account => {
    if (!input.enabled || input.installed?.packageId !== 'com.evnsolution.clever.routes' || input.installed.versionCode < 43 || registeredRefreshToken === account.refreshToken) return;
    const response = await runBoundedAsyncOperation(signal => (input.fetchImpl ?? globalThis.fetch)(`${input.baseUrl.replace(/\/$/u, '')}/driver/capabilities`, withNoStoreDriverApiRequest({
      method: 'POST', signal, headers: {Authorization: `Bearer ${account.accessToken}`, 'Content-Type':'application/json'},
      body: JSON.stringify({refreshToken: account.refreshToken, capability:'delivery-proof-v1', versionCode:input.installed!.versionCode, packageId:input.installed!.packageId}),
    })), {timeoutMs: 10_000});
    if (!response.ok) throw createDriverApiHttpError({endpoint:'Delivery proof capability',status:response.status});
    const payload = await response.json() as {data?: {registered?: boolean; capability?: string}};
    if (payload?.data?.registered !== true || payload.data.capability !== 'delivery-proof-v1') throw new Error('Delivery proof capability was not confirmed.');
    registeredRefreshToken = account.refreshToken;
  };
}

/**
 * The capability only lets the server publish routes that need a delivery photo or signature. A failure to register
 * it (network, timeout, an unexpected answer) must not hide the driver's routes, so the route lookup goes on and the
 * registration is tried again at the next lookup. An expired session is still reported so it can be refreshed.
 */
export async function reportDeliveryProofCapabilityBestEffort(
  report: (account: Pick<DriverAccountAccessToken, 'accessToken' | 'refreshToken'>) => Promise<void>,
  account: Pick<DriverAccountAccessToken, 'accessToken' | 'refreshToken'>,
): Promise<void> {
  try {
    await report(account);
  } catch (error) {
    if (isDriverApiUnauthorizedError(error)) throw error;
  }
}
