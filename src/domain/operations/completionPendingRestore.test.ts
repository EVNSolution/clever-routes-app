import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attemptDriverCompletionClearHeartbeat,
  createDriverSyncHeartbeatApiClient,
} from './driverSyncHeartbeat';
import {
  restoreCompletionPendingBeforeRouteHydration,
  type CompletionPendingRestoreIdentity,
} from './completionPendingRestore';
import {
  createPersistentOfflineSubmissionQueue,
  type OfflineSubmissionQueueStorage,
} from '../offline/offlineSubmissionQueue';
import { sampleInvitedRouteAccess } from '../routeAccess/routeAccess';

describe('completion-pending cold restore', () => {
  for (const hydrationStatus of [401, 500]) {
    it(`keeps reduced heartbeat and later converges after thrown route hydration ${hydrationStatus}`, async () => {
      const values = new Map<string, string>();
      const storage: OfflineSubmissionQueueStorage = {
        getItem: async (key) => values.get(key) ?? null,
        removeItem: async (key) => { values.delete(key); },
        setItem: async (key, value) => { values.set(key, value); },
      };
      const initialQueue = await createPersistentOfflineSubmissionQueue({ storage });
      const routePlanId = sampleInvitedRouteAccess.routeAccess.routePlanId;
      initialQueue.enqueueDriverEvent({
        appVersion: '1.1.6',
        assignmentGeneration: sampleInvitedRouteAccess.routeAccess.assignmentGeneration,
        clientEventId: `completion-before-${hydrationStatus}`,
        driverContractVersion: 2,
        eventType: 'ROUTE_COMPLETED',
        expectedRouteVersionId: sampleInvitedRouteAccess.routeAccess.expectedRouteVersionId,
        occurredAt: new Date('2026-08-22T19:42:10.000Z'),
        routePlanId,
        versionCode: 116,
      });
      await initialQueue.whenPersisted();
      const restartedQueue = await createPersistentOfflineSubmissionQueue({ storage });
      const identity = {
        activeRouteSession: {
          completionClientEventId: `completion-before-${hydrationStatus}`,
          navigationStepIndex: 11,
          routePlanId,
          status: 'completion_pending' as const,
          updatedAt: '2026-08-22T19:42:10.000Z',
        },
        driverAccess: sampleInvitedRouteAccess.driverAccess,
        routeAccess: sampleInvitedRouteAccess.routeAccess,
      };
      let receiptStatus: 'APPLIED' | 'UNKNOWN' = 'UNKNOWN';
      const runtimeIdentity: { current: CompletionPendingRestoreIdentity | null } = { current: null };
      const recover = (hydrateRoute: () => Promise<unknown> = async () => null) => restoreCompletionPendingBeforeRouteHydration({
        hydrateRoute,
        identity,
        onPending: (pendingIdentity) => { runtimeIdentity.current = pendingIdentity; },
        onResolved: async () => { runtimeIdentity.current = null; },
        queue: restartedQueue,
        receiptService: { lookupReceipt: async () => ({
          assignmentGeneration: identity.routeAccess.assignmentGeneration,
          clientEventId: identity.activeRouteSession.completionClientEventId!,
          errorCode: null,
          expectedRouteVersionId: identity.routeAccess.expectedRouteVersionId,
          routePlanId,
          routeStatus: receiptStatus === 'APPLIED' ? 'COMPLETED' : 'IN_PROGRESS',
          status: receiptStatus,
        }) },
      });

      await assert.rejects(
        recover(async () => {
          throw Object.assign(new Error(`route hydration failed (${hydrationStatus})`), { status: hydrationStatus });
        }),
        { status: hydrationStatus },
      );
      assert.equal(runtimeIdentity.current?.activeRouteSession.routePlanId, routePlanId);
      assert.equal(restartedQueue.listPending().length, 1);

      let heartbeatSent = false;
      await createDriverSyncHeartbeatApiClient({
        accessToken: runtimeIdentity.current!.driverAccess!.accessToken,
        baseUrl: 'https://route.test',
        fetchImpl: async (_url, init) => {
          heartbeatSent = init?.headers?.Authorization === `Bearer ${sampleInvitedRouteAccess.driverAccess.accessToken}`;
          return new Response(JSON.stringify({
            data: { accepted: true, conflict: false, syncHealth: { heartbeatSequence: 1, state: 'HEALTHY' } },
          }), { status: 200 });
        },
      }).recordHeartbeat({
        appVersion: '1.1.6', clientOccurredAt: '2026-08-22T19:42:20.000Z', completedStopCount: null,
        currentStopSequence: null, deviceInstanceHash: 'device-hash', driverContractVersion: 2,
        finishPending: true, firstErrorCode: null, firstFailedAt: null, heartbeatSequence: 1,
        lastAcknowledgedAt: null, lastErrorCode: null, lastRetryAt: null, locallyFinished: true,
        nextRetryAt: null, oldestQueuedAt: '2026-08-22T19:42:10.000Z', queueDepth: 1,
        retryCount: 0, retryJournal: [], sessionGeneration: 'session-1', totalStopCount: null,
        versionCode: 116,
      });
      assert.equal(heartbeatSent, true);

      receiptStatus = 'APPLIED';
      assert.equal((await recover()).receiptRecovery, 'acknowledged');
      assert.equal(runtimeIdentity.current, null);
      assert.equal(restartedQueue.listPending().length, 0);
    });
  }

  it('retains the durable clear outbox when identity times out and secure session cleanup rejects', async () => {
    const storage = createMemoryStorage();
    const queue = await createPersistentOfflineSubmissionQueue({ storage });
    const routePlanId = sampleInvitedRouteAccess.routeAccess.routePlanId;
    queue.enqueueDriverEvent({
      appVersion: '1.2.0', assignmentGeneration: sampleInvitedRouteAccess.routeAccess.assignmentGeneration,
      clientEventId: 'cold-restart-hostile', driverContractVersion: 2, eventType: 'ROUTE_COMPLETED',
      expectedRouteVersionId: sampleInvitedRouteAccess.routeAccess.expectedRouteVersionId,
      occurredAt: new Date('2026-08-22T19:42:10.000Z'), routePlanId, versionCode: 18,
    });
    await queue.whenPersisted();
    const expirations: (() => void)[] = [];
    let cleanupCalls = 0;
    const restore = restoreCompletionPendingBeforeRouteHydration({
      hydrateRoute: async () => 'unused',
      identity: {
        activeRouteSession: {
          completionClientEventId: 'cold-restart-hostile', navigationStepIndex: 11, routePlanId,
          status: 'completion_pending', updatedAt: '2026-08-22T19:42:10.000Z',
        },
        driverAccess: sampleInvitedRouteAccess.driverAccess,
        routeAccess: sampleInvitedRouteAccess.routeAccess,
      },
      onPending: () => undefined,
      onResolved: async () => {
        const attempt = attemptDriverCompletionClearHeartbeat({
          appVersion: '1.2.0', attemptTimeoutMs: 10, cancelAttemptTimeout: () => undefined,
          completedStopCount: 11, driverContractVersion: 2,
          heartbeatService: { recordHeartbeat: async () => { throw new Error('must not reach server'); } },
          identityService: { next: () => new Promise(() => undefined) }, queue, routePlanId,
          scheduleAttemptTimeout: (expire) => { expirations.push(expire); return expire; },
          sessionKey: 'account:route:generation', versionCode: 18,
        });
        await new Promise((resolve) => setImmediate(resolve));
        expirations.shift()?.();
        assert.equal((await attempt).observed, false);
        cleanupCalls += 1;
        throw new Error('secure session clear rejected');
      },
      queue,
      receiptService: { lookupReceipt: async () => ({
        assignmentGeneration: sampleInvitedRouteAccess.routeAccess.assignmentGeneration,
        clientEventId: 'cold-restart-hostile', errorCode: null,
        expectedRouteVersionId: sampleInvitedRouteAccess.routeAccess.expectedRouteVersionId,
        routePlanId, routeStatus: 'COMPLETED', status: 'APPLIED',
      }) },
    });
    await assert.rejects(restore, /secure session clear rejected/u);
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(queue.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
    const restarted = await createPersistentOfflineSubmissionQueue({ storage });
    assert.deepEqual(restarted.listPendingCompletionClearRoutePlanIds(), [routePlanId]);
  });
});

function createMemoryStorage(): OfflineSubmissionQueueStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    removeItem: async (key) => { values.delete(key); },
    setItem: async (key, value) => { values.set(key, value); },
  };
}
