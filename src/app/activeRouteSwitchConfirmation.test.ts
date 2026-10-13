import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideActiveRouteSwitch,
  getActiveRouteSwitchCopy,
  requestActiveRouteSwitchConfirmation,
} from './activeRouteSwitchConfirmation';

describe('active route switch', () => {
  it('switches at once for another delivery date and asks first for the same date', () => {
    assert.equal(decideActiveRouteSwitch({ activeDeliveryDate: '2026-10-12', targetDeliveryDate: '2026-10-13' }), 'switch_now');
    assert.equal(decideActiveRouteSwitch({ activeDeliveryDate: '2026-10-13', targetDeliveryDate: '2026-10-13' }), 'confirm');
  });

  it('asks Go Back or Stop and Start, and only Stop and Start stops the route', () => {
    let stopped = 0;
    const dialogs: { buttons: { onPress?: () => void; text: string }[]; message: string; title: string }[] = [];
    requestActiveRouteSwitchConfirmation({
      alertApi: { alert: (title, message, buttons) => { dialogs.push({ buttons, message, title }); } },
      locale: 'ko-KR',
      onStopActiveRoute: () => { stopped += 1; },
    });

    const [dialog] = dialogs;
    assert.ok(dialog !== undefined);
    assert.equal(dialog.title, '진행 중인 경로가 있습니다');
    assert.equal(dialog.message, '새 경로를 시작하면 현재 경로는 중단됩니다.');
    assert.deepEqual(dialog.buttons.map((button) => button.text), ['취소', '중단하고 시작']);
    dialog.buttons[0]?.onPress?.();
    assert.equal(stopped, 0);
    dialog.buttons[1]?.onPress?.();
    assert.equal(stopped, 1);
  });

  it('keeps an English copy for non-Korean locales', () => {
    assert.equal(getActiveRouteSwitchCopy('en-CA').stopAndStartLabel, 'Stop and Start');
  });
});
