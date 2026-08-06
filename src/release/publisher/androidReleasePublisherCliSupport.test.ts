import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ensureDriveAnyoneReaderPermission,
  fetchOptionalRelease,
  sha256File,
  sha256ResponseBody,
  listDriveFiles,
  selectSingleOnlineSsmTarget,
  uploadDriveFileResumable,
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

  it('fails closed unless exactly one tagged SSM target is online', () => {
    assert.equal(selectSingleOnlineSsmTarget([
      { instanceId: 'i-online', pingStatus: 'Online' },
    ]), 'i-online');

    assert.throws(() => selectSingleOnlineSsmTarget([]), /expected one SSM target; got 0/u);
    assert.throws(() => selectSingleOnlineSsmTarget([
      { instanceId: 'i-a', pingStatus: 'Online' },
      { instanceId: 'i-b', pingStatus: 'Online' },
    ]), /expected one SSM target; got 2/u);
    assert.throws(() => selectSingleOnlineSsmTarget([
      { instanceId: 'i-offline', pingStatus: 'ConnectionLost' },
    ]), /SSM target is not online/u);
  });

  it('hashes files and response bodies incrementally', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'routes-publisher-'));
    const filePath = join(directory, 'candidate.apk');
    const contents = Buffer.concat([
      Buffer.alloc(128 * 1024, 1),
      Buffer.alloc(128 * 1024, 2),
    ]);
    writeFileSync(filePath, contents);
    const expected = createHash('sha256').update(contents).digest('hex');

    try {
      assert.equal(await sha256File(filePath), expected);
      assert.equal(await sha256ResponseBody(new ReadableStream({
        start(controller) {
          controller.enqueue(contents.subarray(0, 64 * 1024));
          controller.enqueue(contents.subarray(64 * 1024));
          controller.close();
        },
      })), expected);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('uploads APK content through a resumable streaming request with source provenance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'routes-upload-'));
    const filePath = join(directory, 'candidate.apk');
    const contents = Buffer.from('streamed-apk-content');
    const sha256 = createHash('sha256').update(contents).digest('hex');
    writeFileSync(filePath, contents);
    const calls: { init?: RequestInit & { duplex?: string }; url: string }[] = [];

    try {
      const fileId = await uploadDriveFileResumable({
        apk: {
          appName: 'CLEVER Routes',
          packageName: 'com.evnsolution.clever.routes',
          sha256,
          sourceSha: 'abc123def456',
          versionCode: 9,
          versionName: '1.1.2',
        },
        apkPath: filePath,
        fetchImpl: async (url, init) => {
          calls.push({ init, url });
          if (calls.length === 1) {
            return {
              body: null,
              headers: new Headers({ Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session' }),
              json: async () => ({}),
              ok: true,
              status: 200,
            };
          }
          assert.equal(Buffer.isBuffer(init?.body), false);
          assert.equal(init?.duplex, 'half');
          const uploaded = Buffer.from(await new Response(init?.body).arrayBuffer());
          assert.deepEqual(uploaded, contents);
          return {
            body: null,
            headers: new Headers(),
            json: async () => ({
              appProperties: { sha256, sourceSha: 'abc123def456' },
              id: 'file-9',
              sha256Checksum: sha256,
            }),
            ok: true,
            status: 200,
          };
        },
        fileName: 'com.evnsolution.clever.routes-1.1.2-9.apk',
        folderId: 'approved-folder',
        token: 'token',
      });

      assert.equal(fileId, 'file-9');
      assert.equal(calls.length, 2);
      const metadata = JSON.parse(String(calls[0].init?.body)) as { appProperties: { sourceSha: string } };
      assert.equal(metadata.appProperties.sourceSha, 'abc123def456');
      assert.match(calls[0].url, /uploadType=resumable/u);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
