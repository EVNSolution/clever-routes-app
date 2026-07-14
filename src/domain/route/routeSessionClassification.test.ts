import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyAssignedRouteSession,
  filterVisibleAssignedRouteSessions,
  getInitialAssignedRouteTab,
  type RouteSessionClassificationRoute,
} from './routeSessionClassification';

const now = new Date('2026-06-02T13:00:00.000Z');

describe('assigned route session classification', () => {
  it('retains past assigned routes as unfinished instead of dropping them', () => {
    const sessions = [
      session('past', '2026-05-30', 'America/Toronto'),
      session('today', '2026-06-02', 'America/Toronto'),
      session('future', '2026-06-03', 'America/Toronto'),
    ];

    assert.deepEqual(
      filterVisibleAssignedRouteSessions(sessions, {
        now,
        selectedRouteId: null,
        selectedRouteStatus: 'upcoming',
        selectedTab: 'unfinished',
      }).map((item) => item.route.id),
      ['past'],
    );
    assert.deepEqual(
      filterVisibleAssignedRouteSessions(sessions, {
        now,
        selectedRouteId: null,
        selectedRouteStatus: 'upcoming',
        selectedTab: 'upcoming',
      }).map((item) => item.route.id),
      ['today', 'future'],
    );
  });

  it('uses the route timezone for date boundaries', () => {
    const boundaryNow = new Date('2026-06-02T03:30:00.000Z');

    assert.equal(
      classifyAssignedRouteSession({
        now: boundaryNow,
        route: route('toronto-today', '2026-06-01', 'America/Toronto'),
        selectedRouteId: null,
        selectedRouteStatus: 'upcoming',
      }),
      'upcoming',
    );
    assert.equal(
      classifyAssignedRouteSession({
        now: boundaryNow,
        route: route('seoul-past', '2026-06-01', 'Asia/Seoul'),
        selectedRouteId: null,
        selectedRouteStatus: 'upcoming',
      }),
      'unfinished',
    );
  });

  it('lets the current selected route active state override date classification', () => {
    assert.equal(
      classifyAssignedRouteSession({
        now,
        route: route('selected', '2026-05-30', 'America/Toronto'),
        selectedRouteId: 'selected',
        selectedRouteStatus: 'active',
      }),
      'active',
    );
  });

  it('lets current-session completion override unfinished only for the selected route', () => {
    assert.equal(
      classifyAssignedRouteSession({
        now,
        route: route('selected', '2026-05-30', 'America/Toronto'),
        selectedRouteId: 'selected',
        selectedRouteStatus: 'completed',
      }),
      'completed',
    );
    assert.equal(
      classifyAssignedRouteSession({
        now,
        route: route('other', '2026-05-30', 'America/Toronto'),
        selectedRouteId: 'selected',
        selectedRouteStatus: 'completed',
      }),
      'unfinished',
    );
  });

  it('opens the first loaded past assigned route on the Unfinished tab', () => {
    assert.equal(
      getInitialAssignedRouteTab({
        now,
        route: route('past-assigned', '2026-05-30', 'America/Toronto'),
      }),
      'unfinished',
    );
  });
});

function route(id: string, deliveryDate: string, timezone: string): RouteSessionClassificationRoute {
  return { deliveryDate, id, timezone };
}

function session(id: string, deliveryDate: string, timezone: string): { route: RouteSessionClassificationRoute } {
  return { route: route(id, deliveryDate, timezone) };
}
