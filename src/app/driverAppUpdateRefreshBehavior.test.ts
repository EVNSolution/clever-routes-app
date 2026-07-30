import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('driver app update refresh behavior', () => {
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
      /Promise\.all\(\[[\s\S]*handleRefreshRoutes\(\)[\s\S]*checkForDriverAppUpdate\(true\)[\s\S]*\]\)/u,
    );
  });
});
