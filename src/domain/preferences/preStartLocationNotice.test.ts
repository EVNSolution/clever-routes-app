import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKGROUND_LOCATION_DISCLOSURE_TEXT,
  createPreStartLocationNoticeStore,
} from './preStartLocationNotice';

describe('pre-start location notice', () => {
  it('is not accepted until the driver accepts it, then stays accepted', async () => {
    let stored: string | null = null;
    const store = createPreStartLocationNoticeStore({
      getItem: async () => stored,
      setItem: async (_key, value) => { stored = value; },
    });

    assert.equal(await store.isAccepted(), false);
    await store.accept();
    assert.equal(await store.isAccepted(), true);
  });

  it('tells the driver that location is collected before Start', () => {
    assert.match(BACKGROUND_LOCATION_DISCLOSURE_TEXT, /before you press Start/u);
    assert.match(BACKGROUND_LOCATION_DISCLOSURE_TEXT, /even when the app is closed or not in use/u);
    assert.doesNotMatch(BACKGROUND_LOCATION_DISCLOSURE_TEXT, /during an active route/u);
  });
});
