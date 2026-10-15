import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAuthFailureMessage, shouldDiscardSavedLoginAfterRefreshFailure } from './authDiagnostics';
import { createDriverApiHttpError } from '../api/deliveryServer/driverApiError';
import { createRouteAccessApiClient, RouteAccessTransportError } from '../domain/routeAccess/routeAccess';
import type { AuthPhase } from './authDiagnostics';
import type { DriverRuntimeConfig } from './config/driverRuntimeConfig';

describe('authDiagnostics', () => {
  const liveConfig: DriverRuntimeConfig = {
    mode: 'live',
    deliveryServerBaseUrl: 'https://clever-route.example',
  };

  it('classifies mock runtime as mock_mode for invite verify', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: { mode: 'mock' },
      phase: 'invite_verify',
      error: new Error('kaboom'),
    });

    assert.equal(result.kind, 'mock_mode');
    assert.equal(result.message.includes('mock mode'), true);
  });

  it('classifies missing request from TypeError as request_not_sent', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'route_access',
      error: new TypeError('fetch failed'),
    });

    assert.equal(result.kind, 'request_not_sent');
  });

  it('classifies transport failure as network_failure', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'route_access',
      error: new Error('failed to fetch'),
    });

    assert.equal(result.kind, 'network_failure');
  });

  it('gives offline route refresh a connection retry action without internal lookup or dispatch wording', async () => {
    const client = createRouteAccessApiClient({
      baseUrl: liveConfig.deliveryServerBaseUrl,
      fetchImpl: async () => { throw new Error('java.net.UnknownHostException: https://private.example/routes'); },
    });
    await assert.rejects(client.lookupRouteAccess({ accountAccessToken: 'test-account-token' }), (error: unknown) => {
      assert.ok(error instanceof RouteAccessTransportError);
      const result = buildAuthFailureMessage({ runtimeConfig: liveConfig, phase: 'route_access', error });
      assert.equal(result.kind, 'network_failure');
      assert.equal(result.message, 'Routes could not refresh. Try again when connected.');
      assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(error), false);
      return true;
    });
  });

  it('uses the same route retry wording for known network failures without changing their classification', () => {
    for (const [error, kind] of [
      [new TypeError('fetch failed'), 'request_not_sent'],
      [new Error('network request failed'), 'network_failure'],
    ] as const) {
      const result = buildAuthFailureMessage({ runtimeConfig: liveConfig, phase: 'route_access', error });
      assert.equal(result.kind, kind);
      assert.equal(result.message, 'Routes could not refresh. Try again when connected.');
    }
  });

  it('keeps a server permission failure outside the network retry classification', () => {
    const error = createDriverApiHttpError({ endpoint: 'Route Access Lookup', status: 403 });
    const result = buildAuthFailureMessage({ runtimeConfig: liveConfig, phase: 'route_access', error });
    assert.equal(result.kind, 'server_other_error');
    assert.equal(result.message, 'Route access lookup: server returned HTTP 403.');
    assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(error), false);
  });

  it('classifies invalid response payload as stale_build', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'invite_verify',
      error: new Error('Invalid driver auth response'),
    });

    assert.equal(result.kind, 'stale_build');
  });

  it('classifies HTTP 400 as server_400', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'invite_verify',
      error: createDriverApiHttpError({ endpoint: 'Verify Auth Code', status: 400 }),
    });

    assert.equal(result.kind, 'server_400');
    assert.equal(result.message.includes('400'), true);
  });

  it('classifies HTTP 401 as server_401', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'route_access',
      error: createDriverApiHttpError({ endpoint: 'Route Access Lookup', status: 401 }),
    });

    assert.equal(result.kind, 'server_401');
    assert.equal(result.message.includes('401'), true);
  });

  it('discards saved login only when refresh is explicitly unauthorized', () => {
    assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(
      createDriverApiHttpError({ endpoint: 'Refresh Auth Session', status: 401 }),
    ), true);
    assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(
      createDriverApiHttpError({ endpoint: 'Refresh Auth Session', status: 500 }),
    ), false);
    assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(new TypeError('fetch failed')), false);
    assert.equal(shouldDiscardSavedLoginAfterRefreshFailure(new Error('Invalid driver auth response')), false);
  });

  it('explains invalid phone or PIN without exposing which credential failed', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'pin_login',
      error: createDriverApiHttpError({ endpoint: 'PIN Login', status: 401 }),
    });

    assert.equal(result.kind, 'server_401');
    assert.equal(result.message, 'PIN login: phone number or PIN is incorrect.');
  });

  it('explains invalid or expired invite codes during registration', () => {
    const result = buildAuthFailureMessage({
      runtimeConfig: liveConfig,
      phase: 'invite_verify',
      error: createDriverApiHttpError({ endpoint: 'Verify Invite Code', status: 401 }),
    });

    assert.equal(result.kind, 'server_401');
    assert.equal(result.message, 'Account registration: invite code is invalid or expired.');
  });

  const phaseKinds: AuthPhase[] = ['invite_verify', 'pin_login', 'route_access'];
  it('keeps the live API address out of user-facing failure messages', () => {
    phaseKinds.forEach((phase) => {
      const result = buildAuthFailureMessage({
        runtimeConfig: liveConfig,
        phase,
        error: new Error('network request failed'),
      });
      assert.doesNotMatch(result.message, /clever-route\.example|https?:\/\//u);
    });
  });
});
