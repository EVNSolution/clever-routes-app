import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DriverApiHttpError } from '../api/deliveryServer/driverApiError';
import type { PersistedActiveRouteSession } from '../domain/driver/driverAccessTokenStore';
import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { createLiveRouteChangeStore, emptyLiveRouteChangeState, type LiveRouteChangeRawStorage, type LiveRouteChangeState } from '../domain/route/liveRouteChangeStore';
import { createRouteAccessApiClient, RouteAccessTransportError, sampleInvitedRouteAccess, submitRouteAccess } from '../domain/routeAccess/routeAccess';
import { canRefreshCachedLiveRoute, getLiveRouteLoadDiagnostic, loadRouteAccessWithLiveCacheRecovery, shouldHydrateLiveRouteInputs, type LiveRouteAccessRecoveryInput, type LiveRouteRecoveryDiagnostic } from './liveRouteCacheRecovery';

const owner = 'a'.repeat(64);
const route = { ...structuredClone(sampleAssignedRoute), shopDomain: '7hrud1-xq.myshopify.com' };
const appliedVersion = '60000000-0000-4000-8000-000000000001';
const active: PersistedActiveRouteSession = {
  routePlanId: route.id, navigationStepIndex: 2, completedStopIds: [route.stops[0]!.deliveryStopId],
  status: 'active', startedAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:05:00.000Z',
};
const access = {
  driverAccess: sampleInvitedRouteAccess.driverAccess,
  routeAccess: { ...sampleInvitedRouteAccess.routeAccess, routePlanId: route.id, routeContext: route.id, assignmentGeneration: '2' },
};

async function fixture() {
  let raw: string | null = null;
  let writes = 0;
  const storage: LiveRouteChangeRawStorage = {
    readLiveRouteChangeState: async () => raw,
    removeLiveRouteChangeState: async () => { raw = null; },
    updateLiveRouteChangeState: async (_owner, mutate) => { writes += 1; raw = mutate(raw); return raw; },
  };
  const createStore = async () => createLiveRouteChangeStore(storage, { now: () => new Date('2026-10-08T00:05:00.000Z') });
  const state: LiveRouteChangeState = {
    ...emptyLiveRouteChangeState(route.id, '2'), appliedRoute: route, appliedPublicationVersionId: appliedVersion,
    appliedPublicationSequence: 1, ackPendingPublicationVersionId: appliedVersion,
    pendingPublication: { routePlanId: route.id, assignmentGeneration: '2', publicationVersionId: '60000000-0000-4000-8000-000000000002',
      sequence: 2, publishedAt: '2026-10-08T00:04:00.000Z', appliedVersionId: appliedVersion, pending: true,
      snapshot: { schemaVersion: 1, stops: route.stops.map((stop, index) => ({
        routePlanStopId: `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        deliveryStopId: stop.deliveryStopId, orderId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        sourceOrderId: null, sequence: index + 1, recipientName: stop.recipientName, phone: stop.phone, ...stop.address,
        address1: 'N+1 must stay pending', instructions: null, latitude: null, longitude: null, serviceMinutes: 5,
        timeWindowStart: null, timeWindowEnd: null,
      })) } },
    uiDraft: { currentStopId: route.stops[1]!.deliveryStopId, selectedStopDetailsId: null,
      proofDrafts: { [route.stops[1]!.deliveryStopId]: { additionalNotes: 'QA stop2 preserved', locationTip: 'QA side entrance', todayNote: '' } },
      proofPhotoResults: { [route.stops[1]!.deliveryStopId]: { kind: 'captured', source: 'camera', uri: 'file:///synthetic-proof.jpg' } },
      proofMediaResults: { [route.stops[1]!.deliveryStopId]: { kind: 'upload_failed', message: 'Offline' } } },
  };
  await (await createStore()).update(owner, route.id, '2', () => state);
  const input: LiveRouteAccessRecoveryInput = {
    accountOwnerHash: owner, activeRouteSession: active, persistedAccess: access, createStore,
    lookup: async () => { throw new RouteAccessTransportError(); }, isCurrent: () => true, observeRecovery: () => undefined,
  };
  return { input, state, createStore, readRaw: () => raw, writes: () => writes };
}

describe('live route cache recovery', () => {
  it('requires authoritative refresh on a foreground connection for the same cached owner and assignment', async () => {
    const f = await fixture();
    const restored = await loadRouteAccessWithLiveCacheRecovery(f.input);
    const eligibility = {
      cached: { accountOwnerHash: owner, routePlanId: route.id, assignmentGeneration: '2' },
      accountOwnerHash: owner, activeRoutePlanId: route.id, routeAccess: restored.cached!.session.routeAccess,
      isForeground: true, isOnline: true,
    };
    assert.equal(canRefreshCachedLiveRoute(eligibility), true);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, isOnline: false }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, isForeground: false }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, cached: null }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, accountOwnerHash: null }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, accountOwnerHash: 'b'.repeat(64) }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, activeRoutePlanId: null }), false);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, activeRoutePlanId: null, hasPendingRouteEnd: true }), true);
    assert.equal(canRefreshCachedLiveRoute({ ...eligibility, routeAccess: { ...access.routeAccess, assignmentGeneration: '3' } }), false);
    assert.deepEqual(restored.cached!.state.uiDraft, f.state.uiDraft);
    assert.equal(restored.cached!.state.pendingPublication?.sequence, 2);
  });

  it('restores the durable route when actual lookup fetch rejects with native wording outside the old allowlist', async () => {
    const f = await fixture();
    const service = createRouteAccessApiClient({ baseUrl: 'https://delivery.example.com',
      fetchImpl: async () => { throw new Error('connection reset'); },
    });
    const restored = await loadRouteAccessWithLiveCacheRecovery({ ...f.input,
      lookup: () => submitRouteAccess({ accountAccessToken: 'account-access-token' }, service),
    });
    assert.equal(restored.cached?.session.route.id, route.id);
    assert.deepEqual(restored.cached.state.uiDraft, f.state.uiDraft);
  });

  it('does not recover HTTP denial, malformed schema or JSON errors from actual lookup responses', async () => {
    const f = await fixture();
    const parsingError = new SyntaxError('Network request failed while parsing invalid JSON');
    for (const response of [
      ...[401, 403, 409].map(status => ({ ok: false, status, json: async () => ({ data: null, error: { code: 'DENIED' } }) })),
      { ok: true, json: async () => ({ data: { status: 'INVITED' } }) },
      { ok: true, json: async () => { throw parsingError; } },
    ]) {
      const service = createRouteAccessApiClient({ baseUrl: 'https://delivery.example.com', fetchImpl: async () => response });
      await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input,
        lookup: () => submitRouteAccess({ accountAccessToken: 'account-access-token' }, service),
        createStore: async () => { assert.fail('response failure must not restore cached permissions'); },
        observeRecovery: () => { assert.fail('response failure must not enter cache recovery'); },
      }), (error: unknown) => 'status' in response
        ? error instanceof DriverApiHttpError && error.status === response.status
        : error === parsingError || error instanceof Error && error.message === 'Invalid route access response');
    }
  });

  it('classifies route-load failures with fixed stage codes and no raw error text', () => {
    assert.deepEqual(getLiveRouteLoadDiagnostic('LR01', Object.assign(new Error('private payload'), { code: 'ERR_USING_RELEASED_SHARED_OBJECT' })),
      { code: 'LR01', category: 'NATIVE_SHARED_OBJECT', nativeErrorCode: 'ERR_USING_RELEASED_SHARED_OBJECT' });
    assert.deepEqual(getLiveRouteLoadDiagnostic('LR02', new RouteAccessTransportError()),
      { code: 'LR02', category: 'NETWORK_FAILURE' });
    assert.deepEqual(getLiveRouteLoadDiagnostic('LR03', new DriverApiHttpError({ endpoint: 'private URL', status: 403, code: 'private response' })),
      { code: 'LR03', category: 'HTTP_FAILURE', httpStatus: 403 });
    assert.deepEqual(getLiveRouteLoadDiagnostic('LR04', new Error('private URI and customer')),
      { code: 'LR04', category: 'OTHER_FAILURE' });
  });
  it('restores applied N, original photos and notes from durable storage when cold-start lookup is offline', async () => {
    const f = await fixture();
    const before = f.readRaw();
    const restored = await loadRouteAccessWithLiveCacheRecovery(f.input);
    assert.equal(restored.cached?.session.route.id, route.id);
    assert.equal(restored.cached.session.routeAccess.expectedRouteVersionId, appliedVersion);
    assert.equal(restored.cached.state.ackPendingPublicationVersionId, appliedVersion);
    assert.equal(restored.cached.state.pendingPublication?.sequence, 2);
    assert.equal(restored.cached.session.route.stops[1]!.address.address1, route.stops[1]!.address.address1);
    assert.deepEqual(restored.cached.state.uiDraft, f.state.uiDraft);
    assert.equal(f.readRaw(), before);
    assert.equal(f.writes(), 1);
  });

  it('uses a successful server lookup and never opens the offline cache', async () => {
    const f = await fixture();
    const lookupResult = { kind: 'denied' as const, status: 'NOT_FOUND' as const, message: 'No route' };
    assert.deepEqual(await loadRouteAccessWithLiveCacheRecovery({ ...f.input, lookup: async () => lookupResult,
      createStore: async () => { assert.fail('successful lookup keeps server permissions authoritative'); },
    }), { cached: null, lookupResult });
  });

  it('cannot expose a cache without an applied snapshot or verified route access', async () => {
    const f = await fixture();
    await (await f.createStore()).removeAccount(owner);
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery(f.input), RouteAccessTransportError);
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input, persistedAccess: undefined }), RouteAccessTransportError);
  });

  it('does not restore an old generation or another account cache', async () => {
    const f = await fixture();
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input,
      persistedAccess: { ...access, routeAccess: { ...access.routeAccess, assignmentGeneration: '3' } },
    }), RouteAccessTransportError);
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input, accountOwnerHash: 'b'.repeat(64) }), RouteAccessTransportError);
  });

  it('never falls back after access denial or for a completion-pending route', async () => {
    const f = await fixture();
    for (const status of [401, 403, 409]) {
      await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input,
        lookup: async () => { throw new DriverApiHttpError({ endpoint: 'Route lookup', status }); },
        createStore: async () => { assert.fail('denial must not read cached permissions'); },
        observeRecovery: () => { assert.fail('access denial must not enter cache recovery'); },
      }), (error: unknown) => error instanceof DriverApiHttpError && error.status === status);
    }
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input,
      activeRouteSession: { ...active, status: 'completion_pending' },
      createStore: async () => { assert.fail('completion recovery keeps its receipt-first path'); },
    }), RouteAccessTransportError);
  });

  it('reports fixed cache-read diagnostic fields without exposing native messages or account identifiers', async () => {
    const f = await fixture();
    const diagnostics: LiveRouteRecoveryDiagnostic[] = [];
    const nativeError = Object.assign(new Error('private token and SQL payload'), { code: 'ERR_USING_RELEASED_SHARED_OBJECT' });
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input, observeRecovery: value => diagnostics.push(value),
      createStore: async () => { throw nativeError; },
    }), RouteAccessTransportError);
    assert.deepEqual(diagnostics, [{ code: 'CACHE_READ_FAILED', nativeErrorCode: 'ERR_USING_RELEASED_SHARED_OBJECT' }]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private|token|payload|aaaa/u);
  });

  it('cannot expose a snapshot after account scope changes during its durable read', async () => {
    const f = await fixture();
    let current = true;
    const store = await f.createStore();
    await assert.rejects(loadRouteAccessWithLiveCacheRecovery({ ...f.input, isCurrent: () => current,
      createStore: async () => ({ ...store, read: async (...args) => { const value = await store.read(...args); current = false; return value; } }),
    }), RouteAccessTransportError);
  });

  it('hydrates saved inputs on reconnect Retry when failed cold-start left no active route in runtime', () => {
    assert.equal(shouldHydrateLiveRouteInputs({ resetProgress: false, replacedAssignment: false,
      previousActiveRoutePlanId: null, restoredRoutePlanId: route.id }), true);
    assert.equal(shouldHydrateLiveRouteInputs({ resetProgress: false, replacedAssignment: false,
      previousActiveRoutePlanId: route.id, restoredRoutePlanId: route.id }), false);
  });
});
