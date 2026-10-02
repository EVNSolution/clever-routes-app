import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type Manifest = { files: { path: string; sha256: string }[]; schemaVersion: string };
const root = new URL('./v1/', import.meta.url);

describe('canonical route operations contract fixtures', () => {
  it('matches the server 62cc5ceb SHA256 manifest exactly', () => {
    const manifest = JSON.parse(readFileSync(new URL('sha256-manifest.json', root), 'utf8')) as Manifest;
    assert.equal(manifest.schemaVersion, 'clever.route-operations.v1');
    for (const file of manifest.files) {
      const digest = createHash('sha256').update(readFileSync(new URL(file.path, root))).digest('hex');
      assert.equal(digest, file.sha256, file.path);
    }
  });
});
