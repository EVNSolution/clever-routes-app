import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAuthFailureMessage, shouldDiscardSavedLoginAfterRefreshFailure } from './authDiagnostics';
import { createDriverApiHttpError } from '../api/deliveryServer/driverApiError';
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
