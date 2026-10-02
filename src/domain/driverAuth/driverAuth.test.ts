import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDriverAuthApiClient,
  createMockDriverAuthService,
  DriverAuthRefreshPendingError,
} from './driverAuth';
import { DriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import {
  installDriverDiagnosticObserver,
  type DriverDiagnosticObservation,
} from '../diagnostics/driverDiagnosticObservation';

describe('DriverAuthService', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }
  it('reads and updates the phone-account profile with the account bearer', async () => {
    const requests: { body?: string; headers?: Record<string, string>; method?: string; url: string }[] = [];
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          ...(init?.body === undefined ? {} : { body: init.body }),
          headers: init?.headers,
          method: init?.method,
          url,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              account: {
                name: init?.method === 'PATCH' ? '임 지인' : null,
                phone: '+821089216198',
              },
            },
            error: null,
          }),
        };
      },
    });

    const loaded = await client.getAccountProfile({ accountAccessToken: ' account-token ' });
    const updated = await client.updateAccountProfile({
      accountAccessToken: ' account-token ',
      name: '  임 지인  ',
    });

    assert.deepEqual(loaded.account, { name: null, phone: '+821089216198' });
    assert.deepEqual(updated.account, { name: '임 지인', phone: '+821089216198' });
    assert.deepEqual(requests, [
      {
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
        method: 'GET',
        url: 'https://test-api.com/driver/account/profile',
      },
      {
        body: JSON.stringify({ name: '임 지인' }),
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Pragma: 'no-cache',
        },
        method: 'PATCH',
        url: 'https://test-api.com/driver/account/profile',
      },
    ]);
  });

  it('registers with invite and PIN and parses account tokens', async () => {
    let requestBody: any;
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com',
      fetchImpl: async (url: string, init?: any) => {
        requestBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'mock-at',
              expiresAt: '2026-05-15T00:00:00.000Z',
              refreshToken: 'mock-rt',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
          }),
        };
      },
    });

    const result = await client.register({
      phoneE164: '+1234567890',
      inviteCode: '123456',
      pin: '654321',
    });

    assert.equal(requestBody.phone, '+1234567890');
    assert.equal(requestBody.inviteCode, '123456');
    assert.equal(requestBody.pin, '654321');
    assert.equal('displayName' in requestBody, false);
    assert.equal(result.accountAccess.accessToken, 'mock-at');
    assert.equal(result.accountAccess.refreshToken, 'mock-rt');
    assert.equal(result.accountAccess.use, 'driver_account');
  });

  it('refreshes driver access with the stored refresh token', async () => {
    let requestBody: any;
    let requestHeaders: Record<string, string> = {};
    let requestUrl = '';
    const observations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      requestIdFactory: () => '66666666-6666-4666-8666-666666666666',
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url: string, init?: any) => {
        requestUrl = url;
        requestBody = JSON.parse(init.body);
        requestHeaders = init.headers ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'refreshed-at',
              expiresAt: '2026-05-15T00:15:00.000Z',
              refreshToken: 'stored-rt',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
          }),
        };
      },
    });

    const result = await client.refreshSession({ refreshToken: ' stored-rt ' });

    assert.equal(requestUrl, 'https://test-api.com/driver/auth/refresh');
    assert.deepEqual(requestBody, { refreshToken: 'stored-rt' });
    assert.equal(requestHeaders['X-Request-Id'], '66666666-6666-4666-8666-666666666666');
    assert.equal(result.accountAccess.accessToken, 'refreshed-at');
    assert.equal(result.accountAccess.refreshToken, 'stored-rt');
    assert.equal(result.accountAccess.use, 'driver_account');
    assert.deepEqual(observations.filter((item) => item.kind === 'OPERATION').map((item) => ({
      operation: item.operation,
      phase: item.phase,
      requestId: item.requestId,
    })), [
      { operation: 'AUTH_REFRESH', phase: 'STARTED', requestId: '66666666-6666-4666-8666-666666666666' },
      { operation: 'AUTH_REFRESH', phase: 'SUCCEEDED', requestId: '66666666-6666-4666-8666-666666666666' },
    ]);
    installDriverDiagnosticObserver(null);
  });

  it('reports a stuck timed-out refresh as pending until its raw request settles', async () => {
    let expire!: () => void;
    let requestSignal: AbortSignal | undefined;
    let requests = 0;
    const firstResponse = deferred<{
      json(): Promise<unknown>;
      ok: boolean;
      status: number;
    }>();
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com',
      refreshTimeoutMs: 5_000,
      scheduleRefreshTimeout: (run) => { expire = run; return 'refresh-timeout'; },
      cancelRefreshTimeout: () => undefined,
      fetchImpl: async (_url, init) => {
        requests += 1;
        requestSignal = init?.signal;
        if (requests === 1) return firstResponse.promise;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              accessToken: 'retry-access',
              expiresAt: '2026-05-15T00:15:00.000Z',
              refreshToken: 'stored-rt',
              refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
              tokenType: 'Bearer',
              ttlSeconds: 900,
              use: 'driver_account',
            },
          }),
        };
      },
    });

    const first = client.refreshSession({ refreshToken: 'stored-rt' });
    await new Promise((resolve) => setImmediate(resolve));
    expire();

    await assert.rejects(first, { name: 'BoundedOperationTimeoutError' });
    assert.equal(requestSignal?.aborted, true);
    await assert.rejects(
      client.refreshSession({ refreshToken: 'stored-rt' }),
      (error) => error instanceof DriverAuthRefreshPendingError
        && error.message === 'DRIVER_AUTH_REFRESH_STILL_PENDING',
    );
    assert.equal(requests, 1);

    firstResponse.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          accessToken: 'late-access',
          expiresAt: '2026-05-15T00:15:00.000Z',
          refreshToken: 'stored-rt',
          refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
          tokenType: 'Bearer',
          ttlSeconds: 900,
          use: 'driver_account',
        },
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));

    const retry = await client.refreshSession({ refreshToken: 'stored-rt' });
    assert.equal(retry.accountAccess.accessToken, 'retry-access');
    assert.equal(requests, 2);
  });

  it('shares one refresh request between concurrent callers', async () => {
    const response = deferred<{
      json(): Promise<unknown>;
      ok: boolean;
      status: number;
    }>();
    let requests = 0;
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com',
      fetchImpl: async () => {
        requests += 1;
        return response.promise;
      },
    });

    const first = client.refreshSession({ refreshToken: 'stored-rt' });
    const second = client.refreshSession({ refreshToken: ' stored-rt ' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    response.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          accessToken: 'refreshed-at',
          expiresAt: '2026-05-15T00:15:00.000Z',
          refreshToken: 'stored-rt',
          refreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
          tokenType: 'Bearer',
          ttlSeconds: 900,
          use: 'driver_account',
        },
      }),
    });

    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
    assert.equal(requests, 1);
  });

  it('preserves a non-2xx status when the error response body is empty or malformed', async () => {
    for (const bodyError of [new SyntaxError('empty'), new Error('body unavailable')]) {
      const client = createDriverAuthApiClient({
        baseUrl: 'https://test-api.com',
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          json: async () => { throw bodyError; },
        }),
      });

      await assert.rejects(
        client.refreshSession({ refreshToken: 'stored-rt' }),
        (error) => error instanceof DriverApiHttpError && error.status === 503,
      );
    }
  });

  it('registers and revokes the current app installation with the account bearer', async () => {
    const requests: { body?: string; headers?: Record<string, string>; method?: string; url: string }[] = [];
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: init?.body,
          headers: init?.headers,
          method: init?.method,
          url,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: init?.method === 'PUT'
              ? { pushToken: { id: 'push-token-id', status: 'ACTIVE' } }
              : { revoked: true },
            error: null,
          }),
        };
      },
    });

    await client.registerPushInstallation({
      accountAccessToken: ' account-token ',
      appId: 'com.evnsolution.clever.routes',
      appVersion: '1.1.0',
      devicePushToken: 'native-token',
      locale: 'en-CA',
      platform: 'android',
      timezone: 'America/Toronto',
    });
    await client.revokePushInstallation({
      accountAccessToken: ' account-token ',
      devicePushToken: 'native-token',
    });

    assert.deepEqual(requests, [
      {
        body: JSON.stringify({
          appId: 'com.evnsolution.clever.routes',
          appVersion: '1.1.0',
          devicePushToken: 'native-token',
          locale: 'en-CA',
          platform: 'android',
          timezone: 'America/Toronto',
        }),
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Pragma: 'no-cache',
        },
        method: 'PUT',
        url: 'https://test-api.com/api/driver/mobile/push-token',
      },
      {
        body: JSON.stringify({ devicePushToken: 'native-token' }),
        headers: {
          Authorization: 'Bearer account-token',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Pragma: 'no-cache',
        },
        method: 'DELETE',
        url: 'https://test-api.com/api/driver/mobile/push-token',
      },
    ]);
  });

  it('requests global account deletion with the account bearer and explicit confirmation', async () => {
    const requests: { body?: string; headers?: Record<string, string>; method?: string; url: string }[] = [];
    const client = createDriverAuthApiClient({
      baseUrl: 'https://test-api.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: init?.body,
          headers: init?.headers,
          method: init?.method,
          url,
        });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            data: {
              duplicate: false,
              requestId: 'deletion-request-id',
              status: 'REQUESTED',
            },
            error: null,
          }),
        };
      },
    });

    const result = await client.requestAccountDeletion({
      accountAccessToken: ' account-token ',
    });

    assert.deepEqual(result.request, {
      duplicate: false,
      requestId: 'deletion-request-id',
      status: 'REQUESTED',
    });
    assert.deepEqual(requests, [{
      body: JSON.stringify({ confirmation: 'DELETE' }),
      headers: {
        Authorization: 'Bearer account-token',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        Pragma: 'no-cache',
      },
      method: 'POST',
      url: 'https://test-api.com/driver/account-deletion-requests',
    }]);
  });

  it('provides a local mock PIN login without pretending to send SMS', async () => {
    const client = createMockDriverAuthService();

    const result = await client.login({
      phoneE164: '+1234567890',
      pin: '654321',
    });

    assert.equal(result.accountAccess.accessToken, 'fixture-driver-account-access-token');
  });
});
