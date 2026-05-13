import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withNoStoreDriverApiRequest } from './driverApiRequestOptions';

describe('driver API request options', () => {
  it('prevents ambient cookie use and response cache reuse on driver API calls', () => {
    const request = withNoStoreDriverApiRequest({
      body: '{"ok":true}',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    assert.equal(request.cache, 'no-store');
    assert.equal(request.credentials, 'omit');
    assert.deepEqual(request.headers, {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
    assert.equal(request.method, 'POST');
    assert.equal(request.body, '{"ok":true}');
  });
});
