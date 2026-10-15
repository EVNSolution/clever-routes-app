import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('driver app update refresh behavior', () => {
  it('skips production update prompts only for the isolated debug client', () => {
    const start = appRootSource.indexOf('const driverAppReleaseService = useMemo(');
    const end = appRootSource.indexOf('const checkForDriverAppUpdate', start);
    const compiled = transpileModule(`(() => { ${appRootSource.slice(start, end)} return driverAppReleaseService; })()`, {});
    for (const [development, packageId, shouldCheck] of [
      [true, 'com.evnsolution.clever.routes.dev', false],
      [false, 'com.evnsolution.clever.routes.dev', true],
      [true, 'com.evnsolution.clever.routes', true],
      [false, 'com.evnsolution.clever.routes', true],
    ] as const) {
      const service = {};
      const actual = runInNewContext(compiled.outputText, {
        __DEV__: development, installedDriverAppVersion: { packageId },
        runtimeConfig: { mode: 'live', deliveryServerBaseUrl: 'https://example.invalid' },
        Platform: { OS: 'android' }, useMemo: (factory: () => unknown) => factory(),
        createDriverAppReleaseApiClient: () => service,
      });
      assert.equal(actual, shouldCheck ? service : null);
    }
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
