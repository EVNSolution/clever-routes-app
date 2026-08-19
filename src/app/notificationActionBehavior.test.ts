import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const appRootSource = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('notification action behavior', () => {
  it('runs Next Stop through the durable completion path before opening navigation', () => {
    assert.match(appRootSource, /action === 'next_stop'/u);
    assert.match(appRootSource, /setPendingStopArrivalCompletion\(data\)/u);
    assert.match(appRootSource, /handleTerminalStop\(currentStop, 'delivered', \{ openNextNavigation: true \}\)/u);
    assert.match(appRootSource, /completedStopIds: nextCompletedStopIds,[\s\S]*navigationStepIndex: nextNavigationStepIndex/u);
    assert.match(appRootSource, /activeRouteSession\?\.completedStopIds/u);

    const completionSource = appRootSource.slice(
      appRootSource.indexOf('async function handleTerminalStop'),
      appRootSource.indexOf('completeStopFromNotificationRef.current = async'),
    );
    const saveIndex = completionSource.indexOf('saveActiveRouteSession');
    const notificationIndex = completionSource.indexOf('updateLocationNotification');
    const navigationIndex = completionSource.indexOf('await handleOpenNavigationForStop(nextStop)');

    assert.ok(saveIndex >= 0);
    assert.ok(notificationIndex > saveIndex);
    assert.ok(navigationIndex > notificationIndex);
  });

  it('defers route-update refresh and navigation while proof work is protected', () => {
    const routeNotificationEffect = appRootSource.slice(
      appRootSource.indexOf('const receiveRouteNotification'),
      appRootSource.indexOf('const retryPendingSubmissionsAfterNetworkRecovery'),
    );

    assert.match(routeNotificationEffect, /refreshRequired: true/u);
    assert.match(routeNotificationEffect, /\|\| isNavigationInterruptionProtected/u);
    assert.match(routeNotificationEffect, /pendingDriverRouteNotification\.refreshRequired/u);
  });
});
