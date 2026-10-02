import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreDiagnosticBinding } from './diagnosticBindingRestore';
const owner = 'a'.repeat(64);
const context = { appVersion: '1.3.3', versionCode: 39, os: 'ANDROID', osVersion: '35', deviceInstanceHash: 'b'.repeat(64), routePlanId: null, sessionGeneration: null };
const binding = JSON.stringify({ accountOwnerHash: owner, context, locationExpected: true });
test('stale diagnostic binding cannot restore after logout or another account login', async () => {
  assert.equal(await restoreDiagnosticBinding(binding, null, async () => owner), null);
  assert.equal(await restoreDiagnosticBinding(binding, JSON.stringify({ driverProfile: { phoneE164: '+10000000000' } }), async () => 'c'.repeat(64)), null);
});
test('restore uses current account route facts rather than obsolete diagnostic binding', async () => {
  const result = await restoreDiagnosticBinding(binding, JSON.stringify({ driverProfile: { phoneE164: '+10000000000' } }), async () => owner);
  assert.equal(result?.binding.locationExpected, false);
  assert.equal(result?.binding.context.routePlanId, null);
  assert.equal(JSON.stringify(result?.binding).includes('+10000000000'), false);
});
test('context equality ignores object insertion order and detects assignment changes', async () => {
  const { equalDiagnosticContext } = await import('./diagnosticBindingRestore');
  const left = { ...context, os: 'ANDROID' as const, assignmentGeneration: '2' };
  const right = { assignmentGeneration: '2', ...context, os: 'ANDROID' as const };
  assert.equal(equalDiagnosticContext(left, right), true);
  assert.equal(equalDiagnosticContext(left, { ...right, assignmentGeneration: '3' }), false);
});
