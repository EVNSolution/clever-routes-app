import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createDriverAccessTokenStore } from '../driver/driverAccessTokenStore';
import { createMockDriverAuthService } from '../driverAuth/driverAuth';
import { createMockDriverEventService } from '../events/driverEvents';
import { createInMemoryOfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';
import { createMockRouteAccessService, sampleInvitedRouteAccess } from '../routeAccess/routeAccess';
import { processContinuousLocationTaskBatch } from './continuousLocationTask';

const accountAccess = {
  accessToken: 'account-access',
  expiresAt: '2026-07-16T12:00:00.000Z',
  refreshToken: 'account-refresh',
  refreshTokenExpiresAt: '2026-08-16T12:00:00.000Z',
  tokenType: 'Bearer',
  ttlSeconds: 900,
  use: 'driver_account',
} as const;

function createTokenStore() {
  const values = new Map<string, string>();
  return createDriverAccessTokenStore({
    now: () => new Date('2026-07-16T10:00:00.000Z'),
    storage: {
      deleteItemAsync: async (key) => { values.delete(key); },
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); },
    },
  });
}

async function saveActiveRoute(store: ReturnType<typeof createTokenStore>, routePlanId = sampleInvitedRouteAccess.routeAccess.routePlanId) {
  await store.saveAuthenticatedDriver({ accountAccess, phoneE164: '+14165550123' });
  await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
  await store.saveActiveRouteSession({ navigationStepIndex: 0, routePlanId });
  const persisted = await store.loadActiveDriverAccess();
  if ((persisted.kind === 'active' || persisted.kind === 'refresh_required') && persisted.activeRouteSession !== undefined) {
    await store.markActiveRouteStarted(
      routePlanId,
      persisted.activeRouteSession.startedAt ?? persisted.activeRouteSession.updatedAt,
    );
  }
}

describe('continuous location background task', () => {
  it('records the durable route start before the first location batch', async () => {
    const store = createTokenStore();
    await store.saveAuthenticatedDriver({ accountAccess, phoneE164: '+14165550123' });
    await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
    await store.saveActiveRouteSession({
      navigationStepIndex: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      startedAt: '2026-07-16T10:00:00.000Z',
    });
    const driverEventService = createMockDriverEventService();

    await processContinuousLocationTaskBatch({
      createDriverEventService: () => driverEventService,
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: createInMemoryOfflineSubmissionQueue(),
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(driverEventService.recordedEvents.map((event) => event.eventType), [
      'ROUTE_STARTED',
      'LOCATION_UPDATED',
    ]);
  });

  it('queues route start before locations when the first headless submission is offline', async () => {
    const store = createTokenStore();
    await store.saveAuthenticatedDriver({ accountAccess, phoneE164: '+14165550123' });
    await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
    await store.saveActiveRouteSession({
      navigationStepIndex: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      startedAt: '2026-07-16T10:00:00.000Z',
    });
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => ({
        recordDriverEvent: async () => { throw new Error('offline'); },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: queue,
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, {
      kind: 'processed',
      queuedCount: 1,
      recordedCount: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    assert.deepEqual(queue.listPending().map((item) => (
      item.kind === 'driver_event' ? item.event.eventType : item.kind
    )), ['ROUTE_STARTED', 'LOCATION_UPDATED']);
  });

  it('records locations against the persisted active route without React state', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const driverEventService = createMockDriverEventService();

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => driverEventService,
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: createInMemoryOfflineSubmissionQueue(),
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, {
      kind: 'processed',
      recordedCount: 1,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    assert.deepEqual(driverEventService.recordedEvents.map((event) => ({
      eventType: event.eventType,
      routePlanId: event.routePlanId,
    })), [{
      eventType: 'LOCATION_UPDATED',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    }]);
  });

  it('stops a captured location batch after route completion becomes pending', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    let releaseFirstLocation: () => void = () => undefined;
    const firstLocationReleased = new Promise<void>((resolve) => {
      releaseFirstLocation = resolve;
    });
    let markFirstLocationStarted: () => void = () => undefined;
    const firstLocationStarted = new Promise<void>((resolve) => {
      markFirstLocationStarted = resolve;
    });
    const recordedClientEventIds: string[] = [];

    const task = processContinuousLocationTaskBatch({
      createDriverEventService: () => ({
        recordDriverEvent: async (event) => {
          recordedClientEventIds.push(event.clientEventId);
          if (recordedClientEventIds.length === 1) {
            markFirstLocationStarted();
            await firstLocationReleased;
          }
          return { duplicate: false, eventId: event.clientEventId, status: 'recorded' };
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
        { latitude: 43.6533, longitude: -79.3833, occurredAt: new Date('2026-07-16T10:01:10.000Z') },
      ],
      offlineQueue: createInMemoryOfflineSubmissionQueue(),
      routeAccessService: createMockRouteAccessService(),
    });

    await firstLocationStarted;
    assert.equal(await store.markActiveRouteCompletionPending({
      clientEventId: 'route-released-after-first-location',
      occurredAt: '2026-07-16T10:01:05.000Z',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    }), true);
    releaseFirstLocation();

    assert.deepEqual(await task, {
      kind: 'ignored',
      reason: 'completion_pending',
    });
    assert.equal(recordedClientEventIds.length, 1);
  });

  it('ignores a new location batch while route completion is pending', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    assert.equal(await store.markActiveRouteCompletionPending({
      clientEventId: 'route-released-before-location',
      occurredAt: '2026-07-16T10:00:30.000Z',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    }), true);
    let serviceCreations = 0;

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => {
        serviceCreations += 1;
        return createMockDriverEventService();
      },
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: createInMemoryOfflineSubmissionQueue(),
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, { kind: 'ignored', reason: 'completion_pending' });
    assert.equal(serviceCreations, 0);
  });

  it('ignores missing or mismatched active route state', async () => {
    const missingStore = createTokenStore();
    await missingStore.saveAuthenticatedDriver({ accountAccess, phoneE164: '+14165550123' });
    await missingStore.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
    const mismatchedStore = createTokenStore();
    await saveActiveRoute(mismatchedStore, 'different-route');
    let serviceCreations = 0;

    for (const store of [missingStore, mismatchedStore]) {
      const result = await processContinuousLocationTaskBatch({
        createDriverEventService: () => {
          serviceCreations += 1;
          return createMockDriverEventService();
        },
        driverAccessTokenStore: store,
        driverAuthService: createMockDriverAuthService(),
        locations: [
          { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
        ],
        offlineQueue: createInMemoryOfflineSubmissionQueue(),
        routeAccessService: createMockRouteAccessService(),
      });

      assert.deepEqual(result, { kind: 'ignored', reason: 'inactive_route' });
    }

    assert.equal(serviceCreations, 0);
  });

  it('waits for durable queue persistence when a background submission fails', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const queue = createInMemoryOfflineSubmissionQueue();
    let persisted = false;

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => ({
        recordDriverEvent: async () => { throw new Error('offline'); },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: {
        ...queue,
        whenPersisted: async () => { persisted = true; },
      },
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, {
      kind: 'processed',
      queuedCount: 1,
      recordedCount: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    assert.equal(queue.listPending().length, 1);
    assert.equal(persisted, true);
  });

  it('refreshes expired account and route access without mounted UI state', async () => {
    const store = createTokenStore();
    const expiredAccountAccess = {
      ...accountAccess,
      expiresAt: '2026-07-16T09:59:00.000Z',
    };
    const refreshedAccountAccess = {
      ...accountAccess,
      accessToken: 'refreshed-account-access',
      expiresAt: '2026-07-16T12:15:00.000Z',
    };
    const refreshedDriverAccess = {
      ...sampleInvitedRouteAccess.driverAccess,
      accessToken: 'refreshed-driver-access',
      expiresAt: '2026-07-16T12:15:00.000Z',
    };
    await store.saveAuthenticatedDriver({
      accountAccess: expiredAccountAccess,
      phoneE164: '+14165550123',
    });
    await store.saveFromInvitedRouteAccess(sampleInvitedRouteAccess);
    await store.saveActiveRouteSession({
      navigationStepIndex: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    let refreshedToken: string | null = null;

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: ({ refreshDriverAccess }) => ({
        recordDriverEvent: async (event) => {
          refreshedToken = (await refreshDriverAccess())?.accessToken ?? null;
          return {
            duplicate: false,
            eventId: event.clientEventId,
            status: 'recorded',
          };
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(refreshedAccountAccess),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: createInMemoryOfflineSubmissionQueue(),
      routeAccessService: createMockRouteAccessService({
        ...sampleInvitedRouteAccess,
        driverAccess: refreshedDriverAccess,
      }),
    });

    assert.equal(result.kind, 'processed');
    assert.equal(refreshedToken, 'refreshed-driver-access');
    const persisted = await store.loadActiveDriverAccess();
    assert.equal(persisted.kind, 'active');
    if (persisted.kind === 'active') {
      assert.equal(persisted.accountAccess.accessToken, 'refreshed-account-access');
      assert.equal(persisted.driverAccess?.accessToken, 'refreshed-driver-access');
      assert.equal(
        persisted.activeRouteSession?.routePlanId,
        sampleInvitedRouteAccess.routeAccess.routePlanId,
      );
    }
  });

  it('does not retry a stale batch after another route becomes active', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const queue = createInMemoryOfflineSubmissionQueue();
    const nextRouteAccess = {
      ...sampleInvitedRouteAccess,
      driverAccess: {
        ...sampleInvitedRouteAccess.driverAccess,
        accessToken: 'next-route-driver-access',
      },
      routeAccess: {
        ...sampleInvitedRouteAccess.routeAccess,
        routePlanId: 'next-route',
      },
    };
    let refreshedToken: string | null | undefined;

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: ({ refreshDriverAccess }) => ({
        recordDriverEvent: async () => {
          refreshedToken = (await refreshDriverAccess())?.accessToken ?? null;
          throw new Error('stale route access');
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: queue,
      routeAccessService: {
        lookupRouteAccess: async () => {
          await store.clearActiveRouteSession(sampleInvitedRouteAccess.routeAccess.routePlanId);
          await store.saveFromInvitedRouteAccess(nextRouteAccess);
          await store.saveActiveRouteSession({ navigationStepIndex: 0, routePlanId: 'next-route' });
          return sampleInvitedRouteAccess;
        },
      },
    });

    assert.equal(refreshedToken, null);
    assert.deepEqual(result, {
      kind: 'processed',
      recordedCount: 0,
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    assert.deepEqual(queue.listPending(), []);
    const persisted = await store.loadActiveDriverAccess();
    assert.equal(persisted.kind, 'active');
    if (persisted.kind === 'active') {
      assert.equal(persisted.activeRouteSession?.routePlanId, 'next-route');
      assert.equal(persisted.driverAccess?.accessToken, 'next-route-driver-access');
    }
  });

  it('deactivates the matching session when headless route refresh confirms revocation', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: ({ refreshDriverAccess }) => ({
        recordDriverEvent: async () => {
          await refreshDriverAccess();
          throw new Error('driver access expired');
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: queue,
      routeAccessService: createMockRouteAccessService({ status: 'NOT_FOUND' }),
    });

    assert.equal(result.kind, 'deactivated');
    assert.deepEqual(queue.listPending(), []);
    const persisted = await store.loadActiveDriverAccess();
    assert.equal(persisted.kind, 'active');
    if (persisted.kind === 'active') {
      assert.equal(persisted.activeRouteSession, undefined);
      assert.equal(persisted.driverAccess, undefined);
      assert.equal(persisted.routeAccess, undefined);
    }
  });

  it('does not clear a route release that becomes pending before a stale location receives 409', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const queue = createInMemoryOfflineSubmissionQueue();

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => ({
        recordDriverEvent: async () => {
          assert.equal(await store.markActiveRouteCompletionPending({
            clientEventId: 'route-release-won-race',
            occurredAt: '2026-07-16T10:01:01.000Z',
            routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
          }), true);
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: queue,
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, { kind: 'ignored', reason: 'completion_pending' });
    assert.deepEqual(queue.listPending(), []);
    const persisted = await store.loadActiveDriverAccess();
    assert.equal(persisted.kind, 'active');
    if (persisted.kind === 'active') {
      assert.equal(persisted.activeRouteSession?.status, 'completion_pending');
      assert.equal(persisted.activeRouteSession?.completionClientEventId, 'route-release-won-race');
    }
  });

  it('stops the matching session without clearing reusable route access when the route is no longer in progress', async () => {
    const store = createTokenStore();
    await saveActiveRoute(store);
    const queue = createInMemoryOfflineSubmissionQueue();
    queue.enqueueDriverEvent({
      clientEventId: 'stale-location',
      eventType: 'LOCATION_UPDATED',
      occurredAt: new Date('2026-07-16T10:00:30.000Z'),
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    queue.enqueueDriverEvent({
      clientEventId: 'unsynced-delivery',
      deliveryStopId: 'stop-1',
      eventType: 'STOP_DELIVERED',
      occurredAt: new Date('2026-07-16T10:00:40.000Z'),
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
    });
    queue.enqueueProofMediaUpload({
      deliveryStopId: 'stop-1',
      fileName: 'proof.jpg',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      source: 'camera',
      uri: 'file:///proof.jpg',
    });

    const result = await processContinuousLocationTaskBatch({
      createDriverEventService: () => ({
        recordDriverEvent: async () => {
          throw createDriverApiHttpError({
            code: 'ROUTE_NOT_IN_PROGRESS',
            endpoint: 'Driver event record',
            status: 409,
          });
        },
      }),
      driverAccessTokenStore: store,
      driverAuthService: createMockDriverAuthService(),
      locations: [
        { latitude: 43.6532, longitude: -79.3832, occurredAt: new Date('2026-07-16T10:01:00.000Z') },
      ],
      offlineQueue: queue,
      routeAccessService: createMockRouteAccessService(),
    });

    assert.deepEqual(result, {
      kind: 'deactivated',
      reason: 'route_not_in_progress',
      routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
      sessionGeneration: '2026-07-16T10:00:00.000Z',
    });
    const reconciledItems = queue.listPending();
    assert.deepEqual(reconciledItems.map((item) => ({
      attempts: item.attempts,
      kind: item.kind,
      reason: item.reconciliation?.reason,
    })), [
      {
        attempts: 0,
        kind: 'driver_event',
        reason: 'route_not_in_progress',
      },
      {
        attempts: 0,
        kind: 'proof_media',
        reason: 'route_not_in_progress',
      },
    ]);
    assert.equal(reconciledItems.every((item) => Date.parse(item.reconciliation?.blockedAt ?? '') > 0), true);
    const persisted = await store.loadActiveDriverAccess();
    assert.equal(persisted.kind, 'active');
    if (persisted.kind === 'active') {
      assert.equal(persisted.activeRouteSession, undefined);
      assert.notEqual(persisted.driverAccess, undefined);
      assert.notEqual(persisted.routeAccess, undefined);
    }
  });
});
