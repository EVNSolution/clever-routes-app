export type ForegroundLocationSnapshot = {
  accuracyMeters: number | null;
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

export type ForegroundLocationSnapshotService = {
  getCurrentForegroundLocation(): Promise<ForegroundLocationSnapshot>;
};
