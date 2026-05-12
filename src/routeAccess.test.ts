import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createMockRouteAccessService,
  createRouteAccessApiClient,
  getRouteAccessDeniedMessage,
  sampleInvitedRouteAccess,
  submitRouteAccess,
} from './routeAccess';

describe('driver route access UX flow', () => {
  it('blocks phone-only access before lookup', async () => {
    let lookupCalls = 0;
    const result = await submitRouteAccess(
      { routeContext: '', phoneE164: '+14165550123' },
      {
        lookupRouteAccess: async () => {
          lookupCalls += 1;
          return sampleInvitedRouteAccess;
        },
      },
    );

    assert.equal(result.kind, 'validation_error');
    assert.equal(result.reason, 'route_context_required');
    assert.equal(lookupCalls, 0);
  });

  it('maps invited lookup to company guidance before consent', async () => {
    const result = await submitRouteAccess(
      { routeContext: ' 11111111-1111-4111-8111-111111111111 ', phoneE164: '+14165550123' },
      createMockRouteAccessService(),
    );

    assert.equal(result.kind, 'company_guidance');
    assert.equal(result.flowState, 'company_context_confirmed');
    assert.equal(result.nextState, 'consent_required');
    assert.equal(result.companyGuidance.companyDisplayName, 'Tomatono Toronto');
    assert.equal(JSON.stringify(result).includes('address1'), false);
    assert.equal(JSON.stringify(result).includes('deliveryStop'), false);
  });

  it('maps denial statuses to safe app messages', () => {
    assert.equal(
      getRouteAccessDeniedMessage('NOT_FOUND'),
      'Route code and phone did not match an active assignment. Check the company route link/code or contact dispatch.',
    );
    assert.equal(getRouteAccessDeniedMessage('DISABLED'), 'This driver profile is inactive. Contact dispatch before continuing.');
    assert.equal(getRouteAccessDeniedMessage('BLOCKED'), 'This driver profile is blocked. Contact dispatch before continuing.');
  });

  it('posts lookup requests to the delivery-server contract endpoint', async () => {
    const requests: { body: unknown; method: string; url: string }[] = [];
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          json: async () => ({ data: { status: 'NOT_FOUND' }, error: null }),
        };
      },
    });

    const result = await client.lookupRouteAccess({
      routeContext: '11111111-1111-4111-8111-111111111111',
      phoneE164: '+14165550123',
    });

    assert.deepEqual(result, { status: 'NOT_FOUND' });
    assert.deepEqual(requests, [
      {
        body: {
          routeContext: '11111111-1111-4111-8111-111111111111',
          phoneE164: '+14165550123',
        },
        method: 'POST',
        url: 'https://delivery.example.com/driver/route-access/lookup',
      },
    ]);
  });
});
