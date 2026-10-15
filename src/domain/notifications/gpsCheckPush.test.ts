import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideGpsCheck, GPS_CHECK_MIN_INTERVAL_MS, parseGpsCheckPush } from './gpsCheckPush';

const data = {
  pushId: '2f6f3b0e-8c1a-4f4e-9d2b-3a1c5e7f9a10',
  routePlanId: 'route-1',
  sentAt: '2026-10-14T01:00:00.000Z',
  severity: 'WARNING',
  silentSeconds: '75',
  type: 'driver_gps_check',
};
const push = parseGpsCheckPush(data);
const base = {
  activeRoutePlanId: 'route-1',
  backgroundGranted: true,
  lastHandled: null,
  nowMs: 1_000_000,
  push: push!,
  taskStarted: true,
};

describe('GPS check push', () => {
  it('parses the server data message and rejects anything else', () => {
    assert.deepEqual(push, {
      pushId: data.pushId, routePlanId: 'route-1', sentAt: data.sentAt, severity: 'WARNING', silentSeconds: 75,
    });
    assert.equal(parseGpsCheckPush({ ...data, type: 'route_update' }), null);
    assert.equal(parseGpsCheckPush({ ...data, severity: 'LOW' }), null);
    assert.equal(parseGpsCheckPush({ ...data, pushId: 'not-a-uuid' }), null);
    assert.equal(parseGpsCheckPush({ ...data, routePlanId: '' }), null);
    assert.equal(parseGpsCheckPush({ ...data, silentSeconds: 'x' }), null);
    assert.equal(parseGpsCheckPush(null), null);
  });

  it('ignores a push for another route, an ended route or without location consent', () => {
    assert.deepEqual(decideGpsCheck({ ...base, activeRoutePlanId: 'route-2' }), { action: 'ignore', reason: 'route_mismatch' });
    assert.deepEqual(decideGpsCheck({ ...base, activeRoutePlanId: null }), { action: 'ignore', reason: 'no_active_route' });
    assert.deepEqual(decideGpsCheck({ ...base, backgroundGranted: false }), { action: 'ignore', reason: 'no_consent' });
  });

  it('handles one pushId once and keeps a minimum interval', () => {
    const handled = { at: base.nowMs - 1000, pushId: push!.pushId };
    assert.deepEqual(decideGpsCheck({ ...base, lastHandled: handled }), { action: 'ignore', reason: 'duplicate' });
    const other = { at: base.nowMs - (GPS_CHECK_MIN_INTERVAL_MS - 1), pushId: 'other-push' };
    assert.deepEqual(decideGpsCheck({ ...base, lastHandled: other }), { action: 'ignore', reason: 'too_soon' });
    const old = { at: base.nowMs - GPS_CHECK_MIN_INTERVAL_MS, pushId: 'other-push' };
    assert.deepEqual(decideGpsCheck({ ...base, lastHandled: old }), { action: 'send_location_now' });
  });

  it('restarts a stopped task and otherwise sends a position at once', () => {
    assert.deepEqual(decideGpsCheck({ ...base, taskStarted: false }), { action: 'restart_task' });
    assert.deepEqual(decideGpsCheck(base), { action: 'send_location_now' });
  });
});
