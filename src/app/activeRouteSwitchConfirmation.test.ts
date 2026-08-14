import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVE_ROUTE_SWITCH_CONFIRMATION,
  requestActiveRouteSwitchConfirmation,
} from './activeRouteSwitchConfirmation';

describe('active route switch confirmation', () => {
  it('offers go back, cancel, and the existing completion flow without changing state on dismiss', () => {
    const actions: string[] = [];
    let alertPayload: Parameters<
      Parameters<typeof requestActiveRouteSwitchConfirmation>[0]['alertApi']['alert']
    > | null = null;

    requestActiveRouteSwitchConfirmation({
      alertApi: {
        alert: (...args) => {
          alertPayload = args;
        },
      },
      onCancelCurrentDelivery: () => actions.push('cancel'),
      onCompleteCurrentDelivery: () => actions.push('complete'),
    });

    assert.notEqual(alertPayload, null);
    const [title, message, buttons, options] = alertPayload!;
    assert.equal(title, ACTIVE_ROUTE_SWITCH_CONFIRMATION.title);
    assert.match(message, /delivery.*in progress/i);
    assert.match(message, /cancel or complete/i);
    assert.deepEqual(options, { cancelable: true });
    assert.deepEqual(
      buttons.map(({ style, text }) => ({ style, text })),
      [
        { style: 'cancel', text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.backLabel },
        { style: 'destructive', text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.cancelDeliveryLabel },
        { style: 'default', text: ACTIVE_ROUTE_SWITCH_CONFIRMATION.completeDeliveryLabel },
      ],
    );

    buttons[0]?.onPress?.();
    assert.deepEqual(actions, []);
    buttons[1]?.onPress?.();
    buttons[2]?.onPress?.();
    assert.deepEqual(actions, ['cancel', 'complete']);
  });
});
