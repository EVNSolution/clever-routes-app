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
  it('uses account access and maps returned routes to selectable route choices', async () => {
    let lookupCalls = 0;
    const result = await submitRouteAccess(
      { accountAccessToken: 'account-access-token' },
      {
        lookupRouteAccess: async (input) => {
          lookupCalls += 1;
          assert.deepEqual(input, { accountAccessToken: 'account-access-token', routeContext: null });
          return { status: 'ROUTES_FOUND', routes: [sampleInvitedRouteAccess] };
        },
      },
    );

    assert.equal(result.kind, 'route_choices');
    assert.equal(result.flowState, 'company_context_confirmed');
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].companyGuidance.companyDisplayName, 'Tomatono Toronto');
    assert.equal(lookupCalls, 1);
  });

  it('accepts a registered phone with no active routes as an empty route choice list', async () => {
    const result = await submitRouteAccess(
      { accountAccessToken: 'account-access-token' },
      createMockRouteAccessService({ status: 'ROUTES_FOUND', routes: [] }),
    );

    assert.equal(result.kind, 'route_choices');
    assert.equal(result.flowState, 'company_context_confirmed');
    assert.equal(result.routes.length, 0);
  });

  it('maps invited lookup to company guidance before consent', async () => {
    const result = await submitRouteAccess(
      { accountAccessToken: 'account-access-token', routeContext: ' 11111111-1111-4111-8111-111111111111 ' },
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
      'No active route is assigned to this account. Contact dispatch if you expected an assignment.',
    );
    assert.equal(getRouteAccessDeniedMessage('DISABLED'), 'This driver profile is inactive. Contact dispatch before continuing.');
    assert.equal(getRouteAccessDeniedMessage('BLOCKED'), 'This driver profile is blocked. Contact dispatch before continuing.');
  });

  it('maps multiple phone matches to selectable routes with company metadata', async () => {
    const secondRoute = {
      ...sampleInvitedRouteAccess,
      routeAccess: {
        nextState: 'consent_required' as const,
        routeContext: '22222222-2222-4222-8222-222222222222',
        routePlanId: '22222222-2222-4222-8222-222222222222',
      },
      companyGuidance: {
        ...sampleInvitedRouteAccess.companyGuidance,
        companyDisplayName: 'North Market',
        routeName: 'North PM Route',
        shopDomain: 'north-market.myshopify.com',
      },
      driverAccess: {
        ...sampleInvitedRouteAccess.driverAccess,
        accessToken: 'second-route-token',
      },
    };

    const result = await submitRouteAccess(
      { accountAccessToken: 'account-access-token' },
      createMockRouteAccessService({ status: 'ROUTES_FOUND', routes: [sampleInvitedRouteAccess, secondRoute] }),
    );

    assert.equal(result.kind, 'route_choices');
    assert.equal(result.routes.length, 2);
    assert.equal(result.routes[1].companyGuidance.companyDisplayName, 'North Market');
    assert.equal(result.routes[1].driverAccess.accessToken, 'second-route-token');
    assert.equal(JSON.stringify(result).includes('address1'), false);
  });

  it('maps legacy ambiguous route-scope matches to guidance', async () => {
    const result = await submitRouteAccess(
      { accountAccessToken: 'account-access-token', routeContext: 'shared-dispatch-code' },
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
        resolutionHint: 'Use the account route list or contact dispatch.',
      }),
    );

    assert.equal(result.kind, 'multiple_matches');
    assert.equal(result.flowState, 'route_context_entered');
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].companyDisplayName, 'Tomatono Toronto');
    assert.equal(result.message, 'Multiple route assignments matched. Use the account route list or contact dispatch.');
    assert.equal(JSON.stringify(result).includes('routePlanId'), false);
    assert.equal(JSON.stringify(result).includes('accessToken'), false);
    assert.equal(JSON.stringify(result).includes('deliveryStop'), false);
    assert.equal(JSON.stringify(result).includes('address1'), false);
  });

  it('posts account-authenticated lookup requests to the delivery-server contract endpoint', async () => {
    const requests: { body: unknown; cache?: string; credentials?: string; headers: Record<string, string>; method: string; url: string }[] = [];
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          cache: init?.cache,
          credentials: init?.credentials,
          headers: init?.headers ?? {},
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
      accountAccessToken: 'account-access-token',
    });

    assert.deepEqual(result, { status: 'NOT_FOUND' });
    assert.deepEqual(requests, [
      {
        body: {
          routeContext: null,
        },
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          Authorization: 'Bearer account-access-token',
          'Content-Type': 'application/json',
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
      accountAccessToken: 'account-access-token',
    });

    assert.equal(result.status, 'INVITED');
    assert.equal(result.driverAccess.accessToken, 'server-issued-driver-jwt');
    assert.equal(result.driverAccess.use, 'consent_and_assigned_route');
  });



  it('parses route choices with scoped driver access tokens', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'ROUTES_FOUND',
            routes: [
              {
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
            ],
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({ accountAccessToken: 'account-access-token' });

    assert.equal(result.status, 'ROUTES_FOUND');
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].driverAccess.accessToken, 'server-issued-driver-jwt');
  });

  it('accepts the current server route-choice envelope with nested invited status', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'ROUTES_FOUND',
            routes: [
              {
                status: 'INVITED',
                routeAccess: sampleInvitedRouteAccess.routeAccess,
                companyGuidance: sampleInvitedRouteAccess.companyGuidance,
                driverAccess: {
                  accessToken: 'server-issued-driver-jwt',
                  expiresAt: '2026-05-12T06:55:00.000Z',
                  scopes: ['route:assigned:read'],
                  tokenType: 'Bearer',
                  ttlSeconds: 900,
                  use: 'consent_and_assigned_route',
                },
              },
            ],
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({ accountAccessToken: 'account-access-token' });

    assert.equal(result.status, 'ROUTES_FOUND');
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].driverAccess.accessToken, 'server-issued-driver-jwt');
  });

  it('parses empty route choices for registered phones without active assignments', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            status: 'ROUTES_FOUND',
            routes: [],
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({ accountAccessToken: 'account-access-token' });

    assert.equal(result.status, 'ROUTES_FOUND');
    assert.equal(result.routes.length, 0);
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
            resolutionHint: 'Use the account route list or contact dispatch.',
          },
          error: null,
        }),
      }),
    });

    const result = await client.lookupRouteAccess({
      accountAccessToken: 'account-access-token',
      routeContext: 'shared-dispatch-code',
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
      () => client.lookupRouteAccess({ accountAccessToken: 'account-access-token', routeContext: 'shared-dispatch-code' }),
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
      () => client.lookupRouteAccess({ accountAccessToken: 'account-access-token', routeContext: 'route-context' }),
      /Invalid route access response/u,
    );
  });

});
