import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONVENIENCE_NOTICES_STORAGE_KEY,
  createConvenienceNoticesStore,
  getConvenienceNoticesCopy,
} from './convenienceNotices';

describe('convenience notices preference', () => {
  it('defaults to enabled and persists an explicit disabled choice', async () => {
    const values = new Map<string, string>();
    const store = createConvenienceNoticesStore({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value); },
    });

    assert.equal(await store.load(), true);
    await store.save(false);
    assert.equal(values.get(CONVENIENCE_NOTICES_STORAGE_KEY), 'disabled');
    assert.equal(await store.load(), false);
  });

  it('treats unknown stored values as the safe enabled default', async () => {
    const store = createConvenienceNoticesStore({
      getItem: async () => 'unexpected',
      setItem: async () => undefined,
    });

    assert.equal(await store.load(), true);
  });

  it('localizes the affected setting without changing notification policy', () => {
    assert.deepEqual(getConvenienceNoticesCopy('ko-KR'), {
      description: '배송지 근처에서 도착 안내를 표시합니다.',
      label: '근처 배송지 알림',
      section: '알림',
    });
    assert.equal(getConvenienceNoticesCopy('en-CA').label, 'Nearby stop reminders');
  });
});
