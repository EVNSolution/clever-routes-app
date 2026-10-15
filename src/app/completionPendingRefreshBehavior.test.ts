import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { buildAuthFailureMessage } from './authDiagnostics';
import { restoreCompletionPendingBeforeRouteHydration } from '../domain/operations/completionPendingRestore';
import { createInMemoryOfflineSubmissionQueue, getPendingRouteEnd, recoverPendingStopCompletionReceipts, retryOfflineSubmissions } from '../domain/offline/offlineSubmissionQueue';
import { sampleInvitedRouteAccess } from '../domain/routeAccess/routeAccess';
import { runBoundedAsyncOperation } from '../domain/async/boundedAsyncOperation';
import type { DriverEventInput } from '../domain/events/driverEvents';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('AppRoot.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callback(name: string): string {
  let result: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name
      && node.initializer !== undefined && ts.isCallExpression(node.initializer)) result = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(result);
  return result.getText(tree);
}

function harness(input: { postFails?: boolean; changeOwnerDuringPost?: boolean; changeEpochDuringPost?: boolean; choiceGeneration?: string; receiptStatus?: 'UNKNOWN' | 'APPLIED' | 'REJECTED'; freshReadyChoice?: boolean } = {}) {
  const queue = createInMemoryOfflineSubmissionQueue();
  const choice = structuredClone(sampleInvitedRouteAccess);
  const routePlanId = choice.routeAccess.routePlanId;
  const event: DriverEventInput = {
    appVersion: '1.3.9', assignmentGeneration: choice.routeAccess.assignmentGeneration,
    clientEventId: 'original-offline-finish', driverContractVersion: 2,
    eventType: 'ROUTE_COMPLETED', expectedRouteVersionId: choice.routeAccess.expectedRouteVersionId,
    occurredAt: new Date(), routePlanId, versionCode: 55,
  };
  queue.enqueueDriverEvent(event);
  const activeRouteSession = { completionClientEventId: event.clientEventId, completedStopIds: ['stop-1', 'stop-2'],
    navigationStepIndex: 3, routePlanId, startedAt: '2026-10-15T08:00:00.000Z',
    status: 'completion_pending', updatedAt: event.occurredAt.toISOString() };
  const persisted = { kind: 'active', ...structuredClone(choice), activeRouteSession };
  if (input.choiceGeneration !== undefined) choice.routeAccess.assignmentGeneration = input.choiceGeneration;
  const events: DriverEventInput[] = [];
  const effects: string[] = [];
  const messages: (string | null)[] = [];
  const readyChoice = { ...choice, routeAccess: { ...choice.routeAccess, routePlanId: 'ready-j' },
    companyGuidance: { ...choice.companyGuidance, executionStatus: 'READY' } };
  let lookupCount = 0;
  let projectedRoutes: { route: { id: string } }[] = [];
  const receiptService = { lookupReceipt: async ({ clientEventId }: { clientEventId: string }) => ({
    assignmentGeneration: event.assignmentGeneration!, clientEventId, errorCode: null,
    expectedRouteVersionId: event.expectedRouteVersionId!, routePlanId,
    routeStatus: input.receiptStatus === 'APPLIED' ? 'COMPLETED' : 'IN_PROGRESS', status: input.receiptStatus ?? 'UNKNOWN',
  }) };
  const context = createContext({
    AbortController, Error, console: { warn: (...args: unknown[]) => effects.push(`warning:${JSON.stringify(args)}`) },
    runtimeConfig: { mode: 'live', deliveryServerBaseUrl: 'https://route.test' }, routeSyncState: 'error',
    activeRoutePlanId: null, completedStopIds: [], offlineSubmissionQueue: queue, installedDriverAppVersion: null,
    driverSyncBoundAccountOwnerHashRef: { current: queue.getAccountOwnerHash() }, driverSyncAccountEpochRef: { current: 1 },
    driverSyncLifecycleAbortControllerRef: { current: new AbortController() }, driverSyncRouteAbortControllerRef: { current: new AbortController() },
    driverSyncHeartbeatSchedulerRef: { current: null }, completionClearRetrySchedulerRef: { current: null },
    liveRouteOwnerRef: { current: queue.getAccountOwnerHash() }, liveRouteSessionsRef: { current: [] },
    liveRouteStatesRef: { current: {} }, retryingOfflineSubmissionsEpochRef: { current: null },
    cachedLiveRouteValidationRef: { current: null }, pendingRouteSyncReconnectRef: { current: false },
    bindExpoOfflineSubmissionQueueAccount: async () => queue, getExpoOfflineSubmissionQueue: async () => queue,
    getActiveAccountAccess: async () => ({}), driverAccessTokenStore: { loadActiveDriverAccess: async () => persisted },
    restoreCompletionPendingBeforeRouteHydration, recoverPendingStopCompletionReceipts, retryOfflineSubmissions, runBoundedAsyncOperation,
    createDriverEventReceiptApiClient: () => receiptService,
    submitAccountRouteAccess: async () => ({ kind: 'route_choices', routes: ++lookupCount === 1 ? [choice] : input.freshReadyChoice ? [readyChoice] : [] }),
    getRouteChoicesFromSubmission: (result: { routes: unknown[] }) => result.routes,
    liveRouteStateKey: (routeId: string, generation: string) => `${routeId}:${generation}`,
    toCompanyGuidanceSubmission: (value: unknown) => value, buildDriverAccessRefresh: () => undefined,
    mockDriverConsentService: {}, mockAssignedRouteService: {}, mockDriverEventService: {}, mockProofMediaUploadService: {},
    getDriverConsentServiceForCurrentSubmission: () => ({}),
    getAssignedRouteServiceForCurrentSubmission: ({ submission }: { submission: typeof choice }) => ({ routePlanId: submission.routeAccess.routePlanId }),
    submitDriverConsent: async () => ({ kind: 'consent_recorded', flowState: 'consent_recorded' }),
    loadAssignedRouteAfterConsent: async (_request: unknown, service: { routePlanId: string }) => {
      effects.push(`hydrate:${service.routePlanId}`);
      return service.routePlanId === 'ready-j' ? { kind: 'route_ready', route: { id: 'ready-j', stops: [] } } : { kind: 'no_assigned_route' };
    },
    gateLiveRouteSession: async (value: unknown, route: unknown) => ({ ...value as object, route }),
    getPendingRouteEnd, selectedRouteIdRef: { current: null }, selectLoadedRouteSession: (values: unknown[]) => values[0],
    toInvitedRouteAccess: (value: unknown) => value, isDeliveryDateToday: () => false, AppState: { currentState: 'active' },
    Platform: { OS: 'android' },
    getDriverEventServiceForCurrentSubmission: () => ({ recordDriverEvent: async (submitted: DriverEventInput) => {
      events.push(submitted);
      if (input.changeOwnerDuringPost) queue.bindAccountOwnerHash('other-account');
      if (input.changeEpochDuringPost) context.driverSyncAccountEpochRef.current += 1;
      if (input.postFails) throw new Error('offline');
      return { status: 'recorded', duplicate: false, eventId: 'server-finish' };
    } }),
    getProofMediaUploadServiceForCurrentSubmission: () => ({}),
    waitForOfflineQueuePersistence: () => queue.whenPersisted(),
    sendCompletionAcknowledgedHeartbeatBeforeCleanup: async () => { effects.push('ack-heartbeat'); },
    clearAndStopActiveLocationSession: async () => { effects.push('clear-session'); },
    openVerifiedNoAssignedRoute: async () => { effects.push('open-empty-list'); },
    buildAuthFailureMessage, getLiveRouteLoadDiagnostic: () => ({}), CONTINUOUS_LOCATION_TASK_NAME: 'location',
    setMessage: (message: string | null) => messages.push(message),
    ...Object.fromEntries(['setDriverSyncHealth', 'setIsLoggingIn', 'setRouteSyncState', 'setRouteRecoveryCode',
      'setVerifiedDriverPhoneE164', 'setOfflineSubmissionQueue', 'syncOfflineQueueState', 'setCompletionPendingRestoreIdentity',
      'setActiveRoutePlanId', 'setNavigationStepIndex', 'setCompletedStopIds', 'setSubmission', 'setConsentSubmission',
      'setAcceptedPrivacy', 'setAcceptedLocation', 'setServerConfirmedStopIds', 'setDeliveryStartResult',
      'setContinuousLocationResult', 'setRouteSessions', 'setIsInitialRouteRestoreComplete', 'setScreen',
      'setLastRoutesUpdatedAt', 'setSelectedRouteId'].map(name => [name, () => undefined])),
  });
  context.driverAccessTokenStore.saveFromInvitedRouteAccess = async () => true;
  context.setRouteSessions = (value: typeof projectedRoutes | ((routes: typeof projectedRoutes) => typeof projectedRoutes)) => {
    projectedRoutes = typeof value === 'function' ? value(projectedRoutes) : value;
  };
  context.verifiedDriverPhoneE164 = '+15195550101';
  context.isRefreshingRoutes = false;
  context.isLoggingIn = false;
  context.isRouteRefreshUiAllowed = () => true;
  context.routeProgressRefreshGuardRef = { current: { beginRefresh: () => () => effects.push('release-refresh') } };
  context.setIsRefreshingRoutes = () => undefined;
  runInContext(ts.transpileModule(`var retryOfflineSubmissionsForSessions = ${callback('retryOfflineSubmissionsForSessions')};
    var handleLoginAndLoadRoutes = ${callback('handleLoginAndLoadRoutes')};
    var refresh = ${callback('handleRefreshRoutes')};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { queue, event, events, effects, messages, context, lookupCount: () => lookupCount, projectedRoutes: () => projectedRoutes,
    refresh: () => context.refresh(), load: () => context.handleLoginAndLoadRoutes({}, '+15195550101', {
    activeRouteSession, persistedAccess: persisted, resetProgress: false, navigateOnSuccess: false,
  }) };
}

describe('completion-pending refresh before route hydration', () => {
  it('replays the original unknown receipt once even when assigned-route hydration has no route', async () => {
    const app = harness();
    await app.refresh();
    assert.deepEqual(app.events, [app.event]);
    assert.equal(app.lookupCount(), 2, 'refresh assignments again after the saved Finish is accepted');
    assert.equal(app.effects.some(effect => effect.startsWith('hydrate:')), false, 'do not hydrate the stale pre-Finish choice');
    assert.ok(app.effects.includes('clear-session'));
    assert.ok(app.effects.includes('open-empty-list'));
    assert.equal(app.queue.listPending().length, 0);
    assert.doesNotMatch(app.messages.join(' '), /Waiting for confirmation/u);
  });

  it('hydrates another READY route from the post-Finish lookup', async () => {
    const app = harness({ freshReadyChoice: true });
    await app.refresh();
    assert.deepEqual(app.events, [app.event]);
    assert.equal(app.lookupCount(), 2);
    assert.deepEqual(Array.from(app.projectedRoutes(), session => session.route.id), ['ready-j']);
    assert.deepEqual(app.effects.filter(effect => effect.startsWith('hydrate:')), ['hydrate:ready-j']);
    assert.equal(app.messages.at(-1), null);
    assert.equal(app.effects.some(effect => effect.startsWith('warning:')), false);
  });

  it('retains the original pending end and runtime when replay is still offline', async () => {
    const app = harness({ postFails: true });
    await app.load();
    assert.deepEqual(app.events, [app.event]);
    assert.equal(app.queue.listPending().length, 1);
    const retained = app.queue.listPending()[0];
    assert.deepEqual(retained?.kind === 'driver_event' ? retained.event : null, app.event);
    assert.equal(app.effects.includes('clear-session'), false);
    assert.equal(app.effects.includes('open-empty-list'), false);
  });

  it('does not acknowledge or clear the old account after ownership changes during replay', async () => {
    const app = harness({ changeOwnerDuringPost: true });
    await app.load();
    assert.equal(app.events.length, 1);
    assert.equal(app.effects.includes('clear-session'), false);
    app.queue.bindAccountOwnerHash('test-account-owner');
    assert.equal(app.queue.listPending().length, 1);
  });

  it('keeps pending evidence when the login epoch changes during replay', async () => {
    const app = harness({ changeEpochDuringPost: true });
    await app.load();
    assert.equal(app.events.length, 1);
    assert.equal(app.effects.includes('clear-session'), false);
    assert.equal(app.queue.listPending().length, 1);
  });

  for (const receiptStatus of ['APPLIED', 'REJECTED'] as const) {
    it(`preserves receipt-first ${receiptStatus} handling without reposting the event`, async () => {
      const app = harness({ receiptStatus });
      await app.load();
      assert.deepEqual(app.events, []);
      assert.equal(app.effects.includes('clear-session'), true);
      if (receiptStatus === 'APPLIED') assert.equal(app.queue.listPending().length, 0);
      else {
        assert.equal(app.queue.listPending().length, 1);
        assert.ok(app.queue.listPending()[0]?.reconciliation);
      }
    });
  }

  it('does not replay old completion against a replacement assignment', async () => {
    const app = harness({ choiceGeneration: '999' });
    await app.load();
    assert.deepEqual(app.events, []);
    assert.equal(app.queue.listPending().length, 1);
    assert.equal(app.effects.includes('clear-session'), false);
  });

  it('does not touch pending evidence for another route and assignment', async () => {
    const app = harness();
    const unrelated = { ...app.event, assignmentGeneration: '999', clientEventId: 'another-route-finish', routePlanId: 'another-route' };
    app.queue.enqueueDriverEvent(unrelated);
    await app.refresh();
    assert.deepEqual(app.events, [app.event]);
    const retained = app.queue.listPending();
    assert.equal(retained.length, 1);
    assert.deepEqual(retained[0]?.kind === 'driver_event' ? retained[0].event : null, unrelated);
    assert.equal(retained[0]?.reconciliation, undefined);
  });
});
