import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { finalizeDiagnosticLogoutCleanup, runBoundedDiagnosticRevocation } from './diagnosticLogoutRevocation';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../platform/expo/diagnostics/expoDriverDiagnosticRuntime.ts', import.meta.url), 'utf8');

describe('explicit diagnostic logout revocation', () => {
  it('awaits diagnostic revocation before clearing the business session', () => {
    const logout = appRootSource.slice(
      appRootSource.indexOf('async function handleLogout()'),
      appRootSource.indexOf('const handleAppBack', appRootSource.indexOf('async function handleLogout()')),
    );
    const revoke = logout.indexOf('await revokeExpoDriverDiagnosticRegistrationOnLogout(');
    const reset = logout.indexOf('await resetDriverSession({');
    const fallbackClear = logout.indexOf('await driverAccessTokenStore.clear();');
    assert.ok(revoke > 0 && reset > revoke && fallbackClear > revoke);
  });

  it('uses only bounded persisted active access and bounds push cleanup', () => {
    const logout = appRootSource.slice(
      appRootSource.indexOf('async function handleLogout()'),
      appRootSource.indexOf('const handleAppBack', appRootSource.indexOf('async function handleLogout()')),
    );
    assert.doesNotMatch(logout, /getActiveAccountAccess/u);
    assert.doesNotMatch(logout, /refreshSession/u);
    assert.match(logout, /runBoundedAsyncOperation\([\s\S]*driverAccessTokenStore\.loadActiveDriverAccess\(\)[\s\S]*timeoutMs: 5000/u);
    assert.match(logout, /restoredLogoutAccess\?\.kind === 'active'/u);
    assert.match(logout, /runBoundedAsyncOperation\([\s\S]*stopArrivalNotificationService\.getDevicePushToken\(\)[\s\S]*timeoutMs: 5000/u);
    assert.match(logout, /runBoundedAsyncOperation\([\s\S]*driverAuthService\.revokePushInstallation[\s\S]*timeoutMs: 5000/u);
  });

  it('uses bounded final flush then account-authenticated DELETE with the device hash', () => {
    const revokeStart = runtimeSource.indexOf('export async function revokeExpoDriverDiagnosticRegistrationOnLogout');
    const revokeEnd = runtimeSource.indexOf('export function clearExpoDriverDiagnosticAccount', revokeStart);
    const revoke = runtimeSource.slice(revokeStart, revokeEnd);
    assert.match(revoke, /flushBeforeDetach/u);
    assert.match(revoke, /'\/driver\/sync-health\/registrations',[\s\S]*'DELETE'/u);
    assert.match(revoke, /schemaVersion: 1, deviceInstanceHash/u);
    assert.match(revoke, /getExpoDriverSyncIdentity\(\)\.getDeviceInstanceHash\(\)/u);
    assert.match(revoke, /runBoundedDiagnosticRevocation/u);
    assert.ok(revoke.indexOf('flushBeforeDetach') < revoke.indexOf("'DELETE'"));
  });

  it('does not revoke or detach diagnostics for an automatic business-token clear', () => {
    assert.match(runtimeSource, /observeExpoDriverDiagnosticBusinessAccessCleared/u);
    assert.doesNotMatch(runtimeSource, /observeExpoDriverDiagnosticBusinessAccessCleared[\s\S]{0,600}method: 'DELETE'/u);
  });

  it('passes an abort signal to a bounded logout DELETE', () => {
    assert.match(runtimeSource, /register: async[\s\S]*if \(revocationBarrier !== null\) await revocationBarrier\.catch/u);
    assert.match(runtimeSource, /runBoundedDiagnosticRevocation\(\{[\s\S]*timeoutMs: 5000/u);
    assert.match(runtimeSource, /'DELETE',[\s\S]*signal/u);
  });

  it('runs an immediately successful revocation exactly once', async () => {
    let revokeCount = 0;
    await runBoundedDiagnosticRevocation({
      timeoutMs: 5000,
      revoke: async (signal) => {
        revokeCount += 1;
        assert.equal(signal.aborted, false);
      },
    });
    assert.equal(revokeCount, 1);
  });

  it('aborts a hung DELETE and releases a later registration', async () => {
    let expire: (() => void) | null = null;
    let aborted = false;
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const barrier = runBoundedDiagnosticRevocation({
      timeoutMs: 5000,
      schedule: (callback) => {
        expire = callback;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
      revoke: (signal) => new Promise<void>(() => {
        notifyStarted();
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      }),
    });
    await started;
    assert.notEqual(expire, null);
    (expire as unknown as () => void)();
    await barrier;
    let registered = false;
    await barrier.then(() => { registered = true; });
    assert.equal(aborted, true);
    assert.equal(registered, true);
  });

  it('does not start a stale DELETE after its barrier already expired', async () => {
    let expire: (() => void) | null = null;
    let revokeCount = 0;
    const previous = new Promise<void>(() => undefined);
    const barrier = runBoundedDiagnosticRevocation({
      previous,
      timeoutMs: 5000,
      schedule: (callback) => {
        expire = callback;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
      revoke: async () => { revokeCount += 1; },
    });
    (expire as unknown as () => void)();
    await barrier;
    assert.equal(revokeCount, 0);
  });

  it('does not clear a newer login after old credential cleanup settles', async () => {
    let current = true;
    let finishRemoval: (() => void) | null = null;
    let bindingCleared = false;
    const cleanup = finalizeDiagnosticLogoutCleanup({
      isCurrent: () => current,
      removeCredential: () => new Promise<void>(resolve => { finishRemoval = resolve; }),
      clearBinding: () => { bindingCleared = true; },
    });
    await Promise.resolve();
    current = false;
    (finishRemoval as unknown as () => void)();
    await cleanup;
    assert.equal(bindingCleared, false);
  });
});
