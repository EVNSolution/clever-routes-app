import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const updateScreenSource = readFileSync(new URL('../ui/components/DriverUpdateScreen.tsx', import.meta.url), 'utf8');

describe('driver app update refresh behavior', () => {
  it('opens current-package updates in the official Google Play listing', () => {
    assert.match(
      appRootSource,
      /const GOOGLE_PLAY_ROUTES_APP_URL = 'https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.evnsolution\.clever\.routes';/u,
    );
    assert.match(
      appRootSource,
      /driverAppUpdateState\.kind === 'required_reinstall'[\s\S]*pendingDriverAppRelease\.installation\.guideUrl[\s\S]*GOOGLE_PLAY_ROUTES_APP_URL/u,
    );
    assert.match(updateScreenSource, /'Open Google Play'/u);
  });

  it('forces a release check when an active route becomes inactive', () => {
    assert.match(
      appRootSource,
      /previousActiveRoutePlanIdRef\.current !== null[\s\S]*activeRoutePlanId === null[\s\S]*checkForDriverAppUpdate\(true\)/u,
    );
  });

  it('refreshes routes and release availability together from My Routes', () => {
    const pullRefreshSource = appRootSource.slice(
      appRootSource.indexOf('const handlePullRefresh = useCallback'),
      appRootSource.indexOf('const retryDriverRestore = useCallback'),
    );

    assert.match(
      pullRefreshSource,
      /Promise\.all\(\[[\s\S]*handleRefreshRoutes\(\)[\s\S]*checkForDriverAppUpdate\(true, true\)[\s\S]*\]\)/u,
    );
  });
});
