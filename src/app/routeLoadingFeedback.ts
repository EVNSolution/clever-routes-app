export function shouldShowRouteLoading(input: {
  isApplyingLiveRoute: boolean;
  isInitialRouteRestoreComplete: boolean;
  isManualRouteRefresh: boolean;
  routeCount: number;
  routeSyncState: 'error' | 'idle' | 'loading' | 'ready';
  screen: string;
}): boolean {
  return input.isManualRouteRefresh || input.isApplyingLiveRoute
    || (input.screen === 'mainTabs' && !input.isInitialRouteRestoreComplete
      && input.routeSyncState === 'loading' && input.routeCount === 0);
}
