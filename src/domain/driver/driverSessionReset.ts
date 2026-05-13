import type { DriverAccessTokenStore } from './driverAccessTokenStore';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

export type DriverSessionResetResult = {
  clearedDriverAccess: true;
  clearedOfflineSubmissions: number;
  kind: 'reset';
};

export async function resetDriverSession(input: {
  driverAccessTokenStore: Pick<DriverAccessTokenStore, 'clear'>;
  offlineQueue: Pick<OfflineSubmissionQueue, 'clear' | 'whenPersisted'>;
}): Promise<DriverSessionResetResult> {
  await input.driverAccessTokenStore.clear();
  const clearedOfflineSubmissions = input.offlineQueue.clear();
  await input.offlineQueue.whenPersisted();

  return {
    clearedDriverAccess: true,
    clearedOfflineSubmissions,
    kind: 'reset',
  };
}
