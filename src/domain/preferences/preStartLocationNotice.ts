export const PRE_START_LOCATION_NOTICE_STORAGE_KEY = 'clever.preStartLocationNotice.v1';

/** Play prominent disclosure for location collected before Start (change control #344). */
export const BACKGROUND_LOCATION_DISCLOSURE_TEXT = 'CLEVER Routes collects precise location data for today\'s dispatched route, from when the route is shown in the app, before you press Start, until the route ends, to update delivery progress, even when the app is closed or not in use.';

type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type PreStartLocationNoticeStore = {
  accept(): Promise<void>;
  isAccepted(): Promise<boolean>;
};

// ponytail: one acceptance per device, not per driver account; key it by account if phones are shared.
export function createPreStartLocationNoticeStore(storage: PreferenceStorage): PreStartLocationNoticeStore {
  return {
    accept() {
      return storage.setItem(PRE_START_LOCATION_NOTICE_STORAGE_KEY, 'accepted');
    },
    async isAccepted() {
      return (await storage.getItem(PRE_START_LOCATION_NOTICE_STORAGE_KEY)) === 'accepted';
    },
  };
}
