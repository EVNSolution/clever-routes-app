import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDriverAccessTokenStore, type DriverAccessRestoreResult } from '../domain/driver/driverAccessTokenStore';
import { sampleInvitedRouteAccess } from '../domain/routeAccess/routeAccess';
import { observeDriverAccessStore } from './diagnosticAccessObserver';
import { clearInvoluntaryDriverSession } from './involuntaryDriverSessionClear';

const now = new Date('2026-10-01T14:00:00.000Z');
const appRootSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx'), 'utf8');

function accountAccess(accessToken: string) {
  return {
    accessToken,
    expiresAt: '2026-10-01T15:00:00.000Z',
    refreshToken: `${accessToken}-refresh`,
    refreshTokenExpiresAt: '2026-10-02T15:00:00.000Z',
    tokenType: 'Bearer' as const,
    ttlSeconds: 3600,
    use: 'driver_account' as const,
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('involuntary driver session clear', () => {
  it('clears observed access before route cleanup so diagnostics retain the old tenant and route with an auth blocker', async () => {
    const values = new Map<string, string>();
    let deferDelete = false;
    let resolveDelete!: () => void;
    const base = createDriverAccessTokenStore({
      now: () => now,
      storage: {
        deleteItemAsync: async (key) => {
          if (deferDelete) await new Promise<void>((resolve) => { resolveDelete = resolve; });
          values.delete(key);
        },
        getItemAsync: async (key) => values.get(key) ?? null,
        setItemAsync: async (key, value) => { values.set(key, value); },
      },
    });
    const diagnostic = {
      accountOwner: null as string | null,
      authCredentialMissing: false,
      routePlanId: null as string | null,
    };
    const callbackOrder: string[] = [];
    const changed = (access: DriverAccessRestoreResult) => {
      callbackOrder.push(`changed:${access.kind}`);
      if (access.kind === 'active' || access.kind === 'refresh_required') {
        diagnostic.accountOwner = access.driverProfile.phoneE164;
        diagnostic.authCredentialMissing = false;
        diagnostic.routePlanId = access.activeRouteSession?.routePlanId ?? null;
      } else {
        diagnostic.authCredentialMissing = true;
      }
    };
    const observed = observeDriverAccessStore(base, {
      changed,
      cleared: (cause) => {
        callbackOrder.push(`cleared:${cause}`);
        if (cause === 'account_replacement') {
          diagnostic.accountOwner = null;
          diagnostic.routePlanId = null;
        } else {
          diagnostic.authCredentialMissing = true;
        }
      },
    });

    await observed.saveAuthenticatedDriver({ accountAccess: accountAccess('account-a'), phoneE164: '+14165550100' });
    await observed.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
    await observed.saveActiveRouteSession({
      navigationStepIndex: 1,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      startedAt: '2026-10-01T13:55:00.000Z',
    });
    await nextTurn();
    assert.equal(diagnostic.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);

    callbackOrder.length = 0;
    deferDelete = true;
    const clearing = clearInvoluntaryDriverSession({
      clearAccess: () => observed.clear(),
      clearLocation: async () => {
        callbackOrder.push('location:clear');
        await observed.clearActiveRouteSession(sampleInvitedRouteAccess.routeAccess.routePlanId);
      },
    });
    await nextTurn();
    assert.equal(callbackOrder[0], 'cleared:store_clear');
    assert.ok(callbackOrder.indexOf('location:clear') > callbackOrder.indexOf('cleared:store_clear'));
    assert.equal(diagnostic.accountOwner, '+14165550100');
    assert.equal(diagnostic.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
    assert.equal(diagnostic.authCredentialMissing, true);

    resolveDelete();
    await clearing;
    await nextTurn();

    assert.equal(diagnostic.accountOwner, '+14165550100');
    assert.equal(diagnostic.routePlanId, sampleInvitedRouteAccess.routeAccess.routePlanId);
    assert.equal(diagnostic.authCredentialMissing, true);

    await observed.saveAuthenticatedDriver({ accountAccess: accountAccess('account-b'), phoneE164: '+14165550101' });
    assert.equal(diagnostic.accountOwner, '+14165550101');
    assert.equal(diagnostic.routePlanId, null);
    assert.equal(diagnostic.authCredentialMissing, false);
  });

  it('still clears location when durable access clearing fails', async () => {
    const failure = new Error('secure access clear failed');
    const cleanupFailure = new Error('location cleanup failed');
    const order: string[] = [];

    await assert.rejects(clearInvoluntaryDriverSession({
      clearAccess: async () => { order.push('access'); throw failure; },
      clearLocation: async () => { order.push('location'); throw cleanupFailure; },
    }), failure);

    assert.deepEqual(order, ['access', 'location']);
  });

  it('starts location cleanup without waiting for a deferred access clear and waits for both operations', async () => {
    let resolveAccess!: () => void;
    let locationFinished = false;
    const clearing = clearInvoluntaryDriverSession({
      clearAccess: () => new Promise<void>((resolve) => { resolveAccess = resolve; }),
      clearLocation: async () => { locationFinished = true; },
    });

    await nextTurn();
    assert.equal(locationFinished, true);
    let helperFinished = false;
    void clearing.then(() => { helperFinished = true; });
    await nextTurn();
    assert.equal(helperFinished, false);

    resolveAccess();
    await clearing;
    assert.equal(helperFinished, true);
  });

  it('wires only both involuntary 401 paths through the ordered helper', () => {
    const loginFailure = appRootSource.slice(
      appRootSource.indexOf("if (failure.kind === 'server_401')"),
      appRootSource.indexOf('const handleRefreshRoutes = useCallback'),
    );
    const refreshFailure = appRootSource.slice(
      appRootSource.indexOf('if (shouldDiscardSavedLoginAfterRefreshFailure(error))'),
      appRootSource.indexOf('} finally {', appRootSource.indexOf('if (shouldDiscardSavedLoginAfterRefreshFailure(error))')),
    );

    for (const source of [loginFailure, refreshFailure]) {
      assert.match(source, /await clearInvoluntaryDriverSession\(\{[\s\S]*clearAccess: \(\) => driverAccessTokenStore\.clear\(\)[\s\S]*clearLocation: async \(\) => \{[\s\S]*await clearAndStopActiveLocationSession\(\)/u);
      assert.doesNotMatch(source, /revokeExpoDriverDiagnosticRegistrationOnLogout|clearExpoDriverDiagnosticAccount/u);
    }
    assert.equal((appRootSource.match(/await clearInvoluntaryDriverSession\(/gu) ?? []).length, 2);
  });
});
