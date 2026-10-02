export type RouteProgressProjection = {
  localCompletedCount: number;
  localCompletedStopIds: string[];
  serverConfirmedCount: number;
  serverConfirmedStopIds: string[];
  syncState: 'blocked' | 'confirmed';
  totalStops: number;
};

export function projectRouteProgress(input: {
  localCompletedStopIds: string[];
  serverConfirmedStopIds: string[];
  totalStops: number;
}): RouteProgressProjection {
  const localCompletedStopIds = normalizeStopIds(input.localCompletedStopIds);
  const serverConfirmedStopIds = normalizeStopIds(input.serverConfirmedStopIds);
  const localSet = new Set(localCompletedStopIds);
  const serverSet = new Set(serverConfirmedStopIds);
  const confirmed = localSet.size === serverSet.size
    && [...localSet].every((stopId) => serverSet.has(stopId));

  return {
    localCompletedCount: localCompletedStopIds.length,
    localCompletedStopIds,
    serverConfirmedCount: serverConfirmedStopIds.length,
    serverConfirmedStopIds,
    syncState: confirmed ? 'confirmed' : 'blocked',
    totalStops: Math.max(0, Math.trunc(input.totalStops)),
  };
}

function normalizeStopIds(stopIds: string[]) {
  return [...new Set(stopIds.map((stopId) => stopId.trim()).filter(Boolean))];
}
