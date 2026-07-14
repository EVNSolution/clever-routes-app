import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRIVER_APP_SERVER_BACKED_FEATURE_GATES,
  getDriverMainTabs,
  getDriverPlaceholderCopy,
  getDriverRouteStatusForTabs,
  getVisibleBottomTab,
  shouldShowDriverBottomTabs,
} from './driverMainTabs';

describe('driver main tab IA', () => {
  it('defines the bottom tabs in the approved app-level order with accessibility labels', () => {
    assert.deepEqual(
      getDriverMainTabs().map((tab) => ({ id: tab.id, label: tab.label, accessibilityLabel: tab.accessibilityLabel })),
      [
        { id: 'home', label: 'Home', accessibilityLabel: 'Home tab' },
        { id: 'routes', label: 'Routes', accessibilityLabel: 'Routes tab' },
        { id: 'earnings', label: 'Earnings', accessibilityLabel: 'Earnings tab' },
        { id: 'profile', label: 'Profile', accessibilityLabel: 'Profile tab' },
      ],
    );
  });

  it('excludes auth and dedicated preview screens from the bottom tab shell', () => {
    assert.equal(shouldShowDriverBottomTabs('loginPhone'), false);
    assert.equal(shouldShowDriverBottomTabs('loginDetail'), false);
    assert.equal(shouldShowDriverBottomTabs('arrivalCheck'), false);
    assert.equal(shouldShowDriverBottomTabs('liveMapPreview'), false);
    assert.equal(shouldShowDriverBottomTabs('proofCamera'), false);
    assert.equal(shouldShowDriverBottomTabs('routePreview'), false);
    assert.equal(shouldShowDriverBottomTabs('mainTabs'), true);
    assert.equal(shouldShowDriverBottomTabs('routeSession'), true);
    assert.equal(shouldShowDriverBottomTabs('liveTracking'), true);
  });

  it('keeps active route subflow visually owned by Home', () => {
    assert.equal(getVisibleBottomTab({ screen: 'mainTabs', selectedMainTab: 'routes' }), 'routes');
    assert.equal(getVisibleBottomTab({ screen: 'routeSession', selectedMainTab: 'routes' }), 'home');
    assert.equal(getVisibleBottomTab({ screen: 'routePreview', selectedMainTab: 'routes' }), 'home');
    assert.equal(getVisibleBottomTab({ screen: 'completedDeliveries', selectedMainTab: 'profile' }), 'home');
  });

  it('classifies route filter status deterministically for the selected current-session route only', () => {
    assert.equal(getDriverRouteStatusForTabs({ routeId: 'route-1', selectedRouteId: 'route-1', selectedRouteStatus: 'active' }), 'active');
    assert.equal(getDriverRouteStatusForTabs({ routeId: 'route-1', selectedRouteId: 'route-1', selectedRouteStatus: 'completed' }), 'completed');
    assert.equal(getDriverRouteStatusForTabs({ routeId: 'route-2', selectedRouteId: 'route-1', selectedRouteStatus: 'completed' }), 'upcoming');
  });

  it('keeps server-backed history profile earnings and deletion disabled for this phase', () => {
    assert.deepEqual(DRIVER_APP_SERVER_BACKED_FEATURE_GATES, {
      accountDeletion: false,
      earnings: false,
      profileUpdate: false,
      routeHistory: false,
    });
    assert.match(getDriverPlaceholderCopy('routeHistory'), /Past route history is not available/u);
    assert.match(getDriverPlaceholderCopy('earnings'), /coming soon/u);
    assert.match(getDriverPlaceholderCopy('profileUpdate'), /future API/u);
    assert.match(getDriverPlaceholderCopy('accountDeletion'), /not available/u);
  });
});
