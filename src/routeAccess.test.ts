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
    assert.equal(result.driverAccess.tokenType, 'Bearer');
    assert.equal(result.driverAccess.accessToken, 'fixture-driver-access-token');
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

  it('maps multiple company matches to safe route-specific link guidance', async () => {
    const result = await submitRouteAccess(
      { routeContext: 'shared-dispatch-code', phoneE164: '+14165550123' },
      createMockRouteAccessService({
        status: 'MULTIPLE_MATCHES',
        matches: [
          {
            companyDisplayName: 'Tomatono Toronto',
            deliveryDate: '2026-05-12',
            routeName: 'Tuesday AM Route',
            shopDomain: 'tomatono.myshopify.com',
            timezone: 'America/Toronto',
          },
          {
            companyDisplayName: 'North Market',
            deliveryDate: '2026-05-12',
            routeName: 'North PM Route',
            shopDomain: 'north-market.myshopify.com',
            timezone: 'America/Toronto',
          },
        ],
        resolutionHint: 'Use the route-specific invite link/code from dispatch.',
      }),
    );

    assert.equal(result.kind, 'multiple_matches');
    assert.equal(result.flowState, 'route_context_entered');
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].companyDisplayName, 'Tomatono Toronto');
    assert.equal(result.message, 'Multiple company routes match this phone. Use the route-specific link/code or contact dispatch.');
    assert.equal(JSON.stringify(result).includes('routePlanId'), false);
    assert.equal(JSON.stringify(result).includes('accessToken'), false);
    assert.equal(JSON.stringify(result).includes('deliveryStop'), false);
    assert.equal(JSON.stringify(result).includes('address1'), false);
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

  it('parses driver access token from invited lookup responses', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'INVITED',
            routeAccess: sampleInvitedRouteAccess.routeAccess,
            companyGuidance: sampleInvitedRouteAccess.companyGuidance,
            driverAccess: {
              accessToken: 'server-issued-driver-jwt',
              expiresAt: '2026-05-12T06:55:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'consent_and_assigned_route',
            },
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({
      routeContext: '11111111-1111-4111-8111-111111111111',
      phoneE164: '+14165550123',
    });

    assert.equal(result.status, 'INVITED');
    assert.equal(result.driverAccess.accessToken, 'server-issued-driver-jwt');
    assert.equal(result.driverAccess.use, 'consent_and_assigned_route');
  });

  it('parses multiple match lookup responses without requiring a driver token', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'MULTIPLE_MATCHES',
            matches: [
              {
                companyDisplayName: 'Tomatono Toronto',
                deliveryDate: '2026-05-12',
                routeName: 'Tuesday AM Route',
                shopDomain: 'tomatono.myshopify.com',
                timezone: 'America/Toronto',
              },
            ],
            resolutionHint: 'Use the route-specific invite link/code from dispatch.',
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({
      routeContext: 'shared-dispatch-code',
      phoneE164: '+14165550123',
    });

    assert.equal(result.status, 'MULTIPLE_MATCHES');
    assert.equal(result.matches.length, 1);
    assert.equal(JSON.stringify(result).includes('accessToken'), false);
  });

  it('rejects multiple match lookup responses that include route or token evidence', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'MULTIPLE_MATCHES',
            driverAccess: {
              accessToken: 'must-not-be-present',
              expiresAt: '2026-05-12T06:55:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'consent_and_assigned_route',
            },
            matches: [
              {
                companyDisplayName: 'Tomatono Toronto',
                deliveryDate: '2026-05-12',
                routeName: 'Tuesday AM Route',
                routePlanId: '11111111-1111-4111-8111-111111111111',
                shopDomain: 'tomatono.myshopify.com',
                timezone: 'America/Toronto',
              },
            ],
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.lookupRouteAccess({ routeContext: 'shared-dispatch-code', phoneE164: '+14165550123' }),
      /Invalid route access response/u,
    );
  });

  it('rejects invited lookup responses without driver access token evidence', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'INVITED',
            routeAccess: sampleInvitedRouteAccess.routeAccess,
            companyGuidance: sampleInvitedRouteAccess.companyGuidance,
          },
          error: null,
        }),
      }),
    });

    await assert.rejects(
      () => client.lookupRouteAccess({ routeContext: 'route-context', phoneE164: '+14165550123' }),
      /Invalid route access response/u,
    );
  });

});
