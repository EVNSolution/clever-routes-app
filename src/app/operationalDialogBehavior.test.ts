import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const appRootPath = join(appDirectory, 'AppRoot.tsx');
const dialogPath = join(appDirectory, 'OperationalDialog.tsx');

describe('operational dialog design', () => {
  it('uses one app-owned modal instead of device-owned alerts', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const dialogSource = readFileSync(dialogPath, 'utf8');

    assert.doesNotMatch(appSource, /\bAlert\b/u);
    assert.match(appSource, /<OperationalDialog/u);
    assert.match(dialogSource, /<Modal/u);
    assert.match(dialogSource, /accessibilityViewIsModal/u);
    assert.match(dialogSource, /onRequestClose/u);
  });

  it('keeps primary, destructive, and cancel actions in a stable visual order', () => {
    const dialogSource = readFileSync(dialogPath, 'utf8');

    assert.match(dialogSource, /default:\s*0/u);
    assert.match(dialogSource, /destructive:\s*1/u);
    assert.match(dialogSource, /cancel:\s*2/u);
    assert.match(dialogSource, /minHeight:\s*54/u);
  });
});
