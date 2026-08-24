export type GpsOperationalState = {
  accuracy: 'accurate' | 'poor' | 'unknown';
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  proximity: 'within' | 'outside' | 'unknown';
  safeForProximity: boolean;
};

export function classifyGpsOperationalState(input: {
  accuracyMeters: number | null;
  capturedAt: string | null;
  distanceMeters: number | null;
  now?: Date;
  proximityMeters?: number;
}): GpsOperationalState {
  const capturedAtMs = input.capturedAt === null ? Number.NaN : Date.parse(input.capturedAt);
  const ageMs = (input.now ?? new Date()).getTime() - capturedAtMs;
  const freshness = !Number.isFinite(ageMs) || ageMs < 0
    ? 'unknown'
    : ageMs <= 30_000 ? 'fresh' : ageMs <= 120_000 ? 'aging' : 'stale';
  const accuracy = input.accuracyMeters === null || !Number.isFinite(input.accuracyMeters)
    ? 'unknown'
    : input.accuracyMeters <= 100 ? 'accurate' : 'poor';
  const safeForProximity = accuracy === 'accurate' && (freshness === 'fresh' || freshness === 'aging');
  return {
    accuracy,
    freshness,
    proximity: !safeForProximity || input.distanceMeters === null || !Number.isFinite(input.distanceMeters)
      ? 'unknown'
      : input.distanceMeters <= (input.proximityMeters ?? 150) ? 'within' : 'outside',
    safeForProximity,
  };
}
