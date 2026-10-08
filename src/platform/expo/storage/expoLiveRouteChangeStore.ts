import { createLiveRouteChangeStore, type LiveRouteChangeStore } from '../../../domain/route/liveRouteChangeStore';
import { getExpoEncryptedEvidenceStore } from './expoOfflineSubmissionQueueStorage';

let liveRouteChangeStorePromise: Promise<LiveRouteChangeStore> | null = null;

export function createExpoLiveRouteChangeStore(): Promise<LiveRouteChangeStore> {
  if (liveRouteChangeStorePromise === null) {
    liveRouteChangeStorePromise = getExpoEncryptedEvidenceStore()
      .then(createLiveRouteChangeStore)
      .catch((error: unknown) => {
        liveRouteChangeStorePromise = null;
        throw error;
      });
  }
  return liveRouteChangeStorePromise;
}
