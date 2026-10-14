import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectLoadedRouteSession } from './loadedRouteSelection';

const now = new Date('2026-10-14T08:34:00Z');
function session(id: string, deliveryDate = '2026-10-14', status = 'READY') {
  return { companyGuidance: { executionStatus: status }, route: { id, deliveryDate, timezone: 'Asia/Seoul' } };
}
const defaults = { currentSelectedRouteId: null, restoredActiveRouteId: null, preferTodayReadyRoute: true, now };

describe('loaded route selection', () => {
  it('selects today even when yesterday and tomorrow precede it', () => {
    const today = session('today');
    const sessions = [session('past', '2026-10-13'), session('future', '2026-10-15'), today];
    assert.equal(selectLoadedRouteSession(sessions, defaults), today);
    assert.deepEqual(sessions.map(item => item.route.id), ['past', 'future', 'today']);
    assert.equal(today.companyGuidance.executionStatus, 'READY');
  });
  it('prefers the restored active route over a ready route, regardless of date', () => {
    const active = session('active', '2026-10-13', 'IN_PROGRESS');
    assert.equal(selectLoadedRouteSession([session('today'), active], { ...defaults, restoredActiveRouteId: 'active' }), active);
  });
  it('keeps a selected eligible route when multiple routes are today', () => {
    const selected = session('selected');
    assert.equal(selectLoadedRouteSession([session('first'), selected], { ...defaults, currentSelectedRouteId: 'selected' }), selected);
  });
  it('replaces a stale past selection with today when no active session owns tracking', () => {
    const today = session('today');
    assert.equal(selectLoadedRouteSession([session('past', '2026-10-13'), today], { ...defaults, currentSelectedRouteId: 'past' }), today);
  });
  it('keeps existing selection while active-session restoration or cached recovery blocks pre-start tracking', () => {
    const selected = session('past', '2026-10-13');
    assert.equal(selectLoadedRouteSession([selected, session('today')], {
      ...defaults, currentSelectedRouteId: 'past', preferTodayReadyRoute: false,
    }), selected);
  });
  it('skips completed, in-progress and pending-end candidates', () => {
    const today = session('ready');
    assert.equal(selectLoadedRouteSession([
      session('completed', undefined, 'COMPLETED'), session('active', undefined, 'IN_PROGRESS'),
      { ...session('pending'), pendingRouteEnd: 'completion' }, today,
    ], defaults), today);
  });
  it('uses each route timezone near the calendar-day boundary', () => {
    const toronto = { ...session('toronto', '2026-10-13'), route: { id: 'toronto', deliveryDate: '2026-10-13', timezone: 'America/Toronto' } };
    assert.equal(selectLoadedRouteSession([session('seoul-yesterday', '2026-10-13'), toronto], {
      ...defaults, now: new Date('2026-10-14T02:00:00Z'),
    }), toronto);
  });
  it('keeps the selected or first route for display when no route is eligible today', () => {
    const first = session('past', '2026-10-13');
    const selected = session('future', '2026-10-15');
    assert.equal(selectLoadedRouteSession([first, selected], { ...defaults, currentSelectedRouteId: 'future' }), selected);
    assert.equal(selectLoadedRouteSession([first, selected], defaults), first);
    assert.equal(selectLoadedRouteSession([], defaults), undefined);
  });
});
