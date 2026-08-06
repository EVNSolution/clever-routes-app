import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ensureDriveAnyoneReaderPermission,
  fetchOptionalRelease,
  listDriveFiles,
} from './androidReleasePublisherCliSupport';

describe('Android release publisher CLI support', () => {
  it('treats only a 404 public release response as an absent current release', async () => {
    const release = await fetchOptionalRelease('https://delivery.example.com', async () => ({
      json: async () => ({ error: { code: 'NOT_CONFIGURED' } }),
      ok: false,
      status: 404,
    }));

    assert.equal(release, undefined);
  });

  it('aborts publication on public release 5xx, network, or malformed response failures', async () => {
    await assert.rejects(() => fetchOptionalRelease('https://delivery.example.com', async () => ({
      json: async () => ({ error: { code: 'SERVER_ERROR' } }),
      ok: false,
      status: 500,
    })), /HTTP 500/u);

    await assert.rejects(() => fetchOptionalRelease('https://delivery.example.com', async () => {
      throw new Error('network down');
    }), /network down/u);

    await assert.rejects(() => fetchOptionalRelease('https://delivery.example.com', async () => ({
      json: async () => ({ data: undefined }),
      ok: true,
      status: 200,
    })), /missing data/u);
  });

  it('lists every Drive page so immutable filename duplicates past page one are not missed', async () => {
    const requestedUrls: string[] = [];
    const files = await listDriveFiles({
      fetchImpl: async (url) => {
        requestedUrls.push(url);
        const pageToken = new URL(url).searchParams.get('pageToken');
        return {
          json: async () => pageToken === null
            ? {
                files: [{ id: 'first', name: 'old.apk', appProperties: { sha256: 'old-sha' } }],
                nextPageToken: 'page-2',
              }
            : {
                files: [{ id: 'duplicate', name: 'com.evnsolution.clever.routes-1.1.2-9.apk', appProperties: { sha256: 'new-sha' } }],
              },
          ok: true,
          status: 200,
        };
      },
      folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ',
      token: 'token',
    });

    assert.equal(requestedUrls.length, 2);
    assert.equal(new URL(requestedUrls[0]).searchParams.get('pageSize'), '1000');
    assert.equal(new URL(requestedUrls[1]).searchParams.get('pageToken'), 'page-2');
    assert.deepEqual(files, [
      { id: 'first', name: 'old.apk', sha256: 'old-sha' },
      { id: 'duplicate', name: 'com.evnsolution.clever.routes-1.1.2-9.apk', sha256: 'new-sha' },
    ]);
  });

  it('keeps Drive anyone-reader permission idempotent for reused or uploaded APK files', async () => {
    const presentCalls: { init?: RequestInit; url: string }[] = [];
    const present = await ensureDriveAnyoneReaderPermission({
      fetchImpl: async (url, init) => {
        presentCalls.push({ init, url });
        return {
          json: async () => ({ permissions: [{ role: 'reader', type: 'anyone' }] }),
          ok: true,
          status: 200,
        };
      },
      fileId: 'file-9',
      token: 'token',
    });

    assert.equal(present, 'present');
    assert.equal(presentCalls.length, 1);
    assert.equal(presentCalls[0].init?.method, undefined);

    const createdCalls: { init?: RequestInit; url: string }[] = [];
    const created = await ensureDriveAnyoneReaderPermission({
      fetchImpl: async (url, init) => {
        createdCalls.push({ init, url });
        return {
          json: async () => ({ permissions: [] }),
          ok: true,
          status: init?.method === 'POST' ? 200 : 200,
        };
      },
      fileId: 'private-orphan',
      token: 'token',
    });

    assert.equal(created, 'created');
    assert.equal(createdCalls.length, 2);
    assert.match(createdCalls[0].url, /\/private-orphan\/permissions\?fields=permissions/u);
    assert.equal(createdCalls[1].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(createdCalls[1].init?.body)), { role: 'reader', type: 'anyone' });
  });
});
