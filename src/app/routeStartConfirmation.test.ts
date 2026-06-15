import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRouteStartSessionConfirmationMessage,
  requestRouteStartSessionConfirmation,
  ROUTE_START_SESSION_CONFIRMATION,
} from './routeStartConfirmation';

const today = new Date('2026-06-15T03:00:00.000Z');

describe('route start session confirmation', () => {
  it('asks to enter the selected route session without treating it as pickup completion', () => {
    let confirmed = false;
    let alertPayload: Parameters<
      Parameters<
        typeof requestRouteStartSessionConfirmation
      >[0]['alertApi']['alert']
    > | null = null;

    requestRouteStartSessionConfirmation({
      alertApi: {
        alert: (...args) => {
          alertPayload = args;
        },
      },
      now: today,
      route: { deliveryDate: '2026-06-15', timezone: 'Asia/Seoul' },
      onConfirm: () => {
        confirmed = true;
      },
    });

    assert.notEqual(alertPayload, null);
    const [title, message, buttons, options] = alertPayload!;
    assert.equal(title, ROUTE_START_SESSION_CONFIRMATION.title);
    assert.match(message, /opens the route session/i);
    assert.match(message, /Pickup completion stays inside the session workflow/i);
    assert.doesNotMatch(message, /inside Route Details/i);
    assert.doesNotMatch(message, /Start pickup/i);
    assert.doesNotMatch(message, /Warning:/i);
    assert.deepEqual(options, { cancelable: true });
    assert.equal(buttons.length, 2);
    assert.equal(
      buttons[0]?.text,
      ROUTE_START_SESSION_CONFIRMATION.cancelLabel,
    );
    assert.equal(buttons[0]?.style, 'cancel');
    assert.equal(
      buttons[1]?.text,
      ROUTE_START_SESSION_CONFIRMATION.confirmLabel,
    );
    assert.equal(buttons[1]?.style, 'default');

    buttons[0]?.onPress?.();
    assert.equal(confirmed, false);

    buttons[1]?.onPress?.();
    assert.equal(confirmed, true);
  });

  it('warns before starting a past-dated route session', () => {
    const message = buildRouteStartSessionConfirmationMessage(
      { deliveryDate: '2026-06-14', timezone: 'Asia/Seoul' },
      today,
    );

    assert.match(message, /already passed/i);
    assert.match(message, /2026-06-14/u);
  });

  it('warns before starting a route session scheduled for a different future day', () => {
    const message = buildRouteStartSessionConfirmationMessage(
      { deliveryDate: '2026-06-16', timezone: 'Asia/Seoul' },
      today,
    );

    assert.match(message, /scheduled for a different day/i);
    assert.match(message, /2026-06-16/u);
  });

  it('uses the route timezone when deciding date warnings', () => {
    const message = buildRouteStartSessionConfirmationMessage(
      { deliveryDate: '2026-06-14', timezone: 'America/Toronto' },
      today,
    );

    assert.doesNotMatch(message, /Warning:/i);
  });
});
