import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  buildDriverOperationalPillValues,
  buildOperationalPills,
} from './operationalPillModel';
import { projectRouteProgress } from '../../domain/route/routeProgressProjection';

describe('operational pills', () => {
  it('keeps Alert, Route, GPS, Device, Server, and Sync independently labeled', () => {
    assert.deepEqual(buildOperationalPills({
      alert: 'None', device: 'This device', gps: 'Fresh', route: 'Active', server: 'Healthy', sync: '1 pending',
    }).map((pill) => pill.label), ['Alert', 'Route', 'GPS', 'Device', 'Server', 'Sync']);
  });

  it('uses accessible pill values without separator-dot presentation', () => {
    const source = readFileSync(new URL('./OperationalPills.tsx', import.meta.url), 'utf8');
    assert.match(source, /accessibilityLabel=\{`\$\{pill\.label\}: \$\{pill\.value\}`\}/u);
    assert.doesNotMatch(source, /[•·]/u);
  });

  it('shows Kitchener device 11/11, server 1/11, gap 10, and GPS near stop 11 independently', () => {
    const values = buildDriverOperationalPillValues({
      activeRoutePlanId: 'route-kitchener',
      backgroundLocationGranted: true,
      completionQueued: false,
      currentStopSequence: 11,
      deviceConflict: false,
      gpsOperationalState: {
        accuracy: 'accurate', freshness: 'fresh', proximity: 'within', safeForProximity: true,
      },
      hasDurablePendingRouteEnd: false,
      hasReconciliation: false,
      offlineQueueCount: 1,
      offlineStorageState: 'READY',
      routeProgress: projectRouteProgress({
        localCompletedStopIds: Array.from({ length: 11 }, (_, index) => `stop-${index + 1}`),
        serverConfirmedStopIds: ['stop-1'],
        totalStops: 11,
      }),
      routeReconciliationCount: 0,
      routeSyncReady: true,
    });
    assert.deepEqual(Object.fromEntries(buildOperationalPills(values).map((pill) => [pill.label, pill.value])), {
      Alert: 'None',
      Device: '11/11',
      GPS: 'Near stop 11',
      Route: 'Active',
      Server: '1/11',
      Sync: 'Gap 10',
    });
  });
});
