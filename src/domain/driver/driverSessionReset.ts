import type { DriverAccessTokenStore } from './driverAccessTokenStore';
import type { OfflineSubmissionQueue } from '../offline/offlineSubmissionQueue';

export type DriverSessionResetResult = {
  clearedDriverAccess: true;
  clearedOfflineSubmissions: number;
  kind: 'reset';
  sealedOfflineSubmissions: number;
};

export async function resetDriverSession(input: {
  driverAccessTokenStore: Pick<DriverAccessTokenStore, 'clear'>;
  offlineQueue: Pick<OfflineSubmissionQueue, 'clear' | 'sealForAccountChange' | 'whenPersisted'>;
}): Promise<DriverSessionResetResult> {
  await input.driverAccessTokenStore.clear();
  const accountChange = input.offlineQueue.sealForAccountChange();
  const sealedOfflineSubmissions = accountChange.sealed;
  const clearedOfflineSubmissions = accountChange.discardedLocations;
  await input.offlineQueue.whenPersisted();

  return {
    clearedDriverAccess: true,
    clearedOfflineSubmissions,
    kind: 'reset',
    sealedOfflineSubmissions,
  };
}
