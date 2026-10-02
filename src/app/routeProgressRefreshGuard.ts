export type RouteProgressRefreshGuard = {
  beginMutation(): (() => void) | null;
  beginRefresh(): (() => void) | null;
};

export function createRouteProgressRefreshGuard(onIdle?: () => void): RouteProgressRefreshGuard {
  let activeMutations = 0;
  let refreshInFlight = false;

  const releaseOnce = (release: () => void): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  };

  return {
    beginMutation: () => {
      if (refreshInFlight) return null;
      activeMutations += 1;
      return releaseOnce(() => {
        activeMutations -= 1;
        if (activeMutations === 0) onIdle?.();
      });
    },
    beginRefresh: () => {
      if (refreshInFlight || activeMutations > 0) return null;
      refreshInFlight = true;
      return releaseOnce(() => {
        refreshInFlight = false;
      });
    },
  };
}
