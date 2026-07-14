import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createRouteAccessApiClient } from './routeAccess';

it('uses the account bearer and never submits the phone during route lookup', async () => {
  let requestBody: Record<string, unknown> = {};
  let requestHeaders: Record<string, string> = {};
  const client = createRouteAccessApiClient({
    baseUrl: 'https://delivery.example.com',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      requestHeaders = init?.headers ?? {};
      return {
        json: async () => ({ data: { status: 'ROUTES_FOUND', routes: [] }, error: null }),
        ok: true,
        status: 200,
      };
    },
  });

  await client.lookupRouteAccess({ accountAccessToken: 'account-access-token', routeContext: null });

  assert.deepEqual(requestBody, { routeContext: null });
  assert.equal('phoneE164' in requestBody, false);
  assert.equal(requestHeaders.Authorization, 'Bearer account-access-token');
});
