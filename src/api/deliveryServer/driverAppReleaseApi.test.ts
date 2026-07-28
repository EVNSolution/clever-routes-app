import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverAppReleaseApiClient } from './driverAppReleaseApi';

describe('driver app release API', () => {
  it('loads the public direct Android manifest without credentials or caching', async () => {
    const requests: { init?: RequestInit; url: string }[] = [];
    const client = createDriverAppReleaseApiClient({
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({ init, url });
        return {
          json: async () => ({
            data: {
              distributionChannel: 'direct',
              installUrl: 'https://delivery.example.com/driver-app',
              latestVersionCode: 2,
              latestVersionName: '1.0.1',
              minimumSupportedVersionCode: 1,
              platform: 'android',
            },
            error: null,
          }),
          ok: true,
          status: 200,
        };
      },
      timeoutMs: 100,
    });

    const release = await client.getAndroidRelease();

    assert.equal(release.latestVersionCode, 2);
    assert.equal(requests[0]?.url, 'https://delivery.example.com/driver-app/release/android');
    assert.equal(requests[0]?.init?.cache, 'no-store');
    assert.equal(requests[0]?.init?.credentials, 'omit');
    assert.deepEqual(requests[0]?.init?.headers, {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    });
  });

  it('fails closed on non-success and malformed response envelopes', async () => {
    const nonSuccess = createDriverAppReleaseApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        json: async () => ({ data: null, error: { code: 'NOT_CONFIGURED' } }),
        ok: false,
        status: 404,
      }),
      timeoutMs: 100,
    });
    await assert.rejects(() => nonSuccess.getAndroidRelease());

    const malformed = createDriverAppReleaseApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => ({
        json: async () => ({ data: { latestVersionCode: 2 }, error: null }),
        ok: true,
        status: 200,
      }),
      timeoutMs: 100,
    });
    await assert.rejects(() => malformed.getAndroidRelease());
  });

  it('aborts a release request after the bounded timeout', async () => {
    const client = createDriverAppReleaseApiClient({
      baseUrl: 'https://delivery.example.com',
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      timeoutMs: 5,
    });

    await assert.rejects(() => client.getAndroidRelease(), /aborted/u);
  });
});
