import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDetailedActiveRouteNotificationStore,
  getDetailedActiveRouteNotificationCopy,
} from './detailedActiveRouteNotification';

describe('detailed active-route notification preference', () => {
  it('defaults to the existing detailed notification and persists either switch state', async () => {
    let stored: string | null = null;
    const store = createDetailedActiveRouteNotificationStore({
      getItem: async () => stored,
      setItem: async (_key, value) => { stored = value; },
    });

    assert.equal(await store.load(), true);
    await store.save(false);
    assert.equal(await store.load(), false);
    await store.save(true);
    assert.equal(await store.load(), true);
  });

  it('describes one detail switch without a separate mode selector', () => {
    assert.deepEqual(getDetailedActiveRouteNotificationCopy('ko-KR'), {
      description: '진행 중 알림에 결제, 상품, 고객 메모와 동기화 상태를 표시합니다.',
      label: '경로 알림 상세 표시',
    });
    assert.equal(getDetailedActiveRouteNotificationCopy('en-CA').label, 'Detailed active-route notification');
  });
});
