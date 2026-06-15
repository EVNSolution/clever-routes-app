export const DRIVER_MAIN_TAB_IDS = ['home', 'routes', 'earnings', 'profile'] as const;

export type DriverMainTabId = typeof DRIVER_MAIN_TAB_IDS[number];

export type DriverMainTab = {
  accessibilityLabel: string;
  id: DriverMainTabId;
  label: 'Earnings' | 'Home' | 'Profile' | 'Routes';
};

export const DRIVER_MAIN_TABS: DriverMainTab[] = [
  { id: 'home', label: 'Home', accessibilityLabel: 'Home tab' },
  { id: 'routes', label: 'Routes', accessibilityLabel: 'Routes tab' },
  { id: 'earnings', label: 'Earnings', accessibilityLabel: 'Earnings tab' },
  { id: 'profile', label: 'Profile', accessibilityLabel: 'Profile tab' },
];

export const DRIVER_APP_SERVER_BACKED_FEATURE_GATES = {
  accountDeletion: false,
  earnings: false,
  profileUpdate: false,
  routeHistory: false,
} as const;

export type DriverAppScreenId =
  | 'arrivalCheck'
  | 'completedDeliveries'
  | 'liveTracking'
  | 'liveMapPreview'
  | 'loginDetail'
  | 'loginPhone'
  | 'mainTabs'
  | 'routePreview'
  | 'routeSession'
  | 'stopCompleted'
  | 'stopDetails';

export type DriverRouteStatusForTabs = 'active' | 'completed' | 'unfinished' | 'upcoming';

export function getDriverMainTabs(): DriverMainTab[] {
  return [...DRIVER_MAIN_TABS];
}

export function shouldShowDriverBottomTabs(screen: DriverAppScreenId): boolean {
  return screen !== 'loginPhone' && screen !== 'loginDetail' && screen !== 'liveMapPreview' && screen !== 'routePreview';
}

export function getVisibleBottomTab(input: {
  screen: DriverAppScreenId;
  selectedMainTab: DriverMainTabId;
}): DriverMainTabId {
  return input.screen === 'mainTabs' ? input.selectedMainTab : 'home';
}

export function getDriverRouteStatusForTabs(input: {
  routeId: string;
  selectedRouteId: string | null;
  selectedRouteStatus: DriverRouteStatusForTabs;
}): DriverRouteStatusForTabs {
  return input.routeId === input.selectedRouteId ? input.selectedRouteStatus : 'upcoming';
}

export function getDriverPlaceholderCopy(feature: keyof typeof DRIVER_APP_SERVER_BACKED_FEATURE_GATES): string {
  switch (feature) {
    case 'accountDeletion':
      return 'Account deletion is not available in the app yet. Contact dispatch support to request account changes.';
    case 'earnings':
      return 'Earnings are coming soon. Payout rules and history are not connected to this beta yet.';
    case 'profileUpdate':
      return 'Profile editing is local-only in this beta. Server profile updates require a future API.';
    case 'routeHistory':
      return 'Past route history is not available in this beta. Completed shows only this session until a route-history API exists.';
  }
}
