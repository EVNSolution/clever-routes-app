import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runSourceLayoutPreflight, type SourceLayoutPreflightInput } from './sourceLayoutPreflight';

const validFiles = [
  'src/app/AppRoot.tsx',
  'src/api/deliveryServer/driverApiClients.ts',
  'src/domain/routeAccess/routeAccess.ts',
  'src/features/routes/screens/RouteListScreen.tsx',
  'src/platform/expo/location/expoLocationPermissionService.ts',
  'src/release/evidence/releaseEvidenceSeed.ts',
  'src/shared/format/routeFormatters.ts',
  'src/test/fixtures/routeAccessFixtures.ts',
  'src/ui/components/TransientToast.tsx',
  'tests/integration/driverFlow.integration.test.ts',
  'tests/smoke/android-device-smoke.md',
];

function input(paths: string[]): SourceLayoutPreflightInput {
  return { sourcePaths: paths };
}

describe('source layout preflight', () => {
  it('accepts files that match the documented folder role index', () => {
    const result = runSourceLayoutPreflight(input(validFiles));

    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  });

  it('rejects new flat src files after the structure refactor starts', () => {
    const result = runSourceLayoutPreflight(input([...validFiles, 'src/newFlatModule.ts']));

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      {
        path: 'src/newFlatModule.ts',
        reason: 'Source files must live under an approved role folder from docs/code-organization.md.',
      },
    ]);
  });
});
