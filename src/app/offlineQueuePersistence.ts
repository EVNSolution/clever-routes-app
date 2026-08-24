import type { OfflineSubmissionQueue } from '../domain/offline/offlineSubmissionQueue';

export async function persistOfflineQueueAndSyncState<Queue extends Pick<OfflineSubmissionQueue, 'whenPersisted'>>(
  queue: Queue,
  syncState: (queue: Queue) => void,
): Promise<void> {
  try {
    await queue.whenPersisted();
  } finally {
    syncState(queue);
  }
}
