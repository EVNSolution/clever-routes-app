import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requestRouteStartPickupConfirmation, ROUTE_START_PICKUP_CONFIRMATION } from './routeStartConfirmation';

describe('route start pickup confirmation', () => {
  it('asks drivers to confirm depot pickup before starting the route', () => {
    let confirmed = false;
    let alertPayload: Parameters<Parameters<typeof requestRouteStartPickupConfirmation>[0]['alertApi']['alert']> | null = null;

    requestRouteStartPickupConfirmation({
      alertApi: {
        alert: (...args) => {
          alertPayload = args;
        },
      },
      onConfirm: () => {
        confirmed = true;
      },
    });

    assert.notEqual(alertPayload, null);
    const [title, message, buttons, options] = alertPayload!;
    assert.equal(title, ROUTE_START_PICKUP_CONFIRMATION.title);
    assert.match(message, /delivery items/i);
    assert.match(message, /depot\/pickup point/i);
    assert.deepEqual(options, { cancelable: true });
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0]?.text, ROUTE_START_PICKUP_CONFIRMATION.cancelLabel);
    assert.equal(buttons[0]?.style, 'cancel');
    assert.equal(buttons[1]?.text, ROUTE_START_PICKUP_CONFIRMATION.confirmLabel);
    assert.equal(buttons[1]?.style, 'default');

    buttons[0]?.onPress?.();
    assert.equal(confirmed, false);

    buttons[1]?.onPress?.();
    assert.equal(confirmed, true);
  });
});
