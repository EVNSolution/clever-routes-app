import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('test harness discovery', () => {
  it('runs an explicitly requested .test.tsx file', () => {
    const result = spawnSync(process.execPath, [
      'scripts/run-tests.mjs',
      'src/ui/components/OperationalPills.test.tsx',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.error, undefined);
  });
});
