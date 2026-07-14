import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getCurrentAndFutureRouteSessions } from './routeSchedule';

type TestRouteSession = {
  id: string;
  route: {
    deliveryDate: string;
    id: string;
    timezone: string;
  };
};

function createRouteSession(id: string, deliveryDate: string, timezone = 'Asia/Seoul'): TestRouteSession {
  return {
    id,
    route: {
      deliveryDate,
      id,
      timezone,
    },
  };
}

describe('route schedule list', () => {
  it('drops past route dates and orders current/future routes nearest first', () => {
    const sessions = [
      createRouteSession('future-far', '2026-05-25'),
      createRouteSession('past', '2026-05-17'),
      createRouteSession('future-near', '2026-05-19'),
      createRouteSession('today', '2026-05-18'),
    ];

    const visibleSessions = getCurrentAndFutureRouteSessions(sessions, {
      now: new Date('2026-05-18T10:00:00+09:00'),
    });

    assert.deepEqual(
      visibleSessions.map((session) => session.id),
      ['today', 'future-near', 'future-far'],
    );
  });

  it('uses the route timezone when deciding whether a delivery date is past', () => {
    const sessions = [
      createRouteSession('toronto-today', '2026-05-17', 'America/Toronto'),
      createRouteSession('seoul-yesterday', '2026-05-17', 'Asia/Seoul'),
      createRouteSession('seoul-today', '2026-05-18', 'Asia/Seoul'),
    ];

    const visibleSessions = getCurrentAndFutureRouteSessions(sessions, {
      now: new Date('2026-05-18T01:00:00.000Z'),
    });

    assert.deepEqual(
      visibleSessions.map((session) => session.id),
      ['toronto-today', 'seoul-today'],
    );
  });
});
