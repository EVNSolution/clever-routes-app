import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDriverApiClientsFromRouteAccess } from '../api/deliveryServer/driverApiClients';
import { sampleInvitedRouteAccess } from '../domain/routeAccess/routeAccess';
import { isRouteAccessRefreshForAssignment } from './routeAccessRefreshGuard';

describe('route access refresh assignment guard', () => {
  it('does not retry old proof with a same-route token from a new assignment', async () => {
    const original = sampleInvitedRouteAccess;
    const refreshed = { ...original.routeAccess, assignmentGeneration: '8' };
    const authorizations: (string | undefined)[] = [];
    let refreshCount = 0;
    const clients = createDriverApiClientsFromRouteAccess({
      baseUrl: 'https://delivery.example.com', routeAccess: original,
      fetchImpl: async (_url, init) => {
        authorizations.push(init?.headers?.Authorization);
        return authorizations.length === 1
          ? { ok: false, status: 401, json: async () => ({ data: null, error: { code: 'UNAUTHORIZED' } }) }
          : { ok: true, json: async () => ({ data: proofMedia }) };
      },
      refreshDriverAccess: async () => {
        refreshCount += 1;
        return isRouteAccessRefreshForAssignment(refreshed, original.routeAccess)
          ? { ...original.driverAccess, accessToken: 'new-assignment-token' } : null;
      },
    });

    await assert.rejects(clients.proofMediaUploadService.uploadProofMedia(proofRequest), /HTTP 401/u);
    assert.equal(refreshCount, 1);
    assert.deepEqual(authorizations, ['Bearer fixture-driver-access-token']);
  });

  it('rejects a changed contract even when route and generation match', () => {
    assert.equal(isRouteAccessRefreshForAssignment(
      { ...sampleInvitedRouteAccess.routeAccess, driverContractVersion: 1 as unknown as 2 },
      sampleInvitedRouteAccess.routeAccess,
    ), false);
  });

  it('rejects another route with the same generation and contract', () => {
    assert.equal(isRouteAccessRefreshForAssignment(
      { ...sampleInvitedRouteAccess.routeAccess, routePlanId: 'different-route' },
      sampleInvitedRouteAccess.routeAccess,
    ), false);
  });

  it('allows same-assignment token rotation when publication has advanced', async () => {
    const original = sampleInvitedRouteAccess;
    const refreshed = { ...original.routeAccess, expectedRouteVersionId: '33333333-3333-4333-8333-333333333333' };
    const authorizations: (string | undefined)[] = [];
    const clients = createDriverApiClientsFromRouteAccess({
      baseUrl: 'https://delivery.example.com', routeAccess: original,
      fetchImpl: async (_url, init) => {
        authorizations.push(init?.headers?.Authorization);
        return authorizations.length === 1
          ? { ok: false, status: 401, json: async () => ({ data: null, error: { code: 'UNAUTHORIZED' } }) }
          : { ok: true, json: async () => ({ data: proofMedia }) };
      },
      refreshDriverAccess: async () => isRouteAccessRefreshForAssignment(refreshed, original.routeAccess)
        ? { ...original.driverAccess, accessToken: 'rotated-assignment-token' } : null,
    });

    assert.deepEqual(await clients.proofMediaUploadService.uploadProofMedia(proofRequest), proofMedia);
    assert.deepEqual(authorizations, ['Bearer fixture-driver-access-token', 'Bearer rotated-assignment-token']);
  });
});

const proofRequest = {
  deliveryStopId: 'stop-1', fileName: 'proof.jpg', routePlanId: sampleInvitedRouteAccess.routeAccess.routePlanId,
  source: 'camera' as const, uri: 'file:///proof.jpg',
};
const proofMedia = {
  contentType: 'image/jpeg', kind: 'photo', mediaId: 'media-1', source: 'camera',
  storageKey: 'driver-proof/media-1.jpg', uploadedAt: '2026-10-08T10:00:00.000Z',
};
