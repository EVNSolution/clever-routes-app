import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  requestRouteReconciliationClearConfirmation,
  ROUTE_RECONCILIATION_CLEAR_CONFIRMATION,
} from './routeReconciliationClearConfirmation';

describe('route reconciliation record clear confirmation', () => {
  it('requires explicit destructive confirmation without changing the server route', () => {
    let confirmed = false;
    let alertPayload: Parameters<
      Parameters<
        typeof requestRouteReconciliationClearConfirmation
      >[0]['alertApi']['alert']
    > | null = null;

    requestRouteReconciliationClearConfirmation({
      alertApi: {
        alert: (...args) => {
          alertPayload = args;
        },
      },
      count: 2,
      onConfirm: () => {
        confirmed = true;
      },
    });

    assert.notEqual(alertPayload, null);
    const [title, message, buttons, options] = alertPayload!;
    assert.equal(title, ROUTE_RECONCILIATION_CLEAR_CONFIRMATION.title);
    assert.match(message, /2 unsynced delivery results or proof items/u);
    assert.match(message, /only from this device/u);
    assert.match(message, /server Route and its Ready status stay unchanged/u);
    assert.match(message, /cannot be undone/u);
    assert.deepEqual(options, { cancelable: true });
    assert.deepEqual(buttons.map(({ style, text }) => ({ style, text })), [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Clear Record' },
    ]);

    buttons[0]?.onPress?.();
    assert.equal(confirmed, false);
    buttons[1]?.onPress?.();
    assert.equal(confirmed, true);
  });
});
