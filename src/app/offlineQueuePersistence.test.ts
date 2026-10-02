import assert from 'node:assert/strict';
import { it } from 'node:test';

import { persistOfflineQueueAndSyncState } from './offlineQueuePersistence';

it('syncs the degraded storage state even when terminal queue persistence rejects', async () => {
  const queue = {
    storageState: () => 'STORAGE_DEGRADED' as const,
    whenPersisted: async () => {
      throw new Error('disk full');
    },
  };
  let visibleStorageState = 'READY';

  await assert.rejects(
    persistOfflineQueueAndSyncState(queue, (settledQueue) => {
      visibleStorageState = settledQueue.storageState();
    }),
    /disk full/u,
  );

  assert.equal(visibleStorageState, 'STORAGE_DEGRADED');
});
it('background queue persistence reports the exact storage stage without blocking an independent observer',async()=>{
 const {observeOfflineQueuePersistence}=await import('./offlineQueuePersistence');
 const {installDriverDiagnosticObserver}=await import('../domain/diagnostics/driverDiagnosticObservation');
 const reasons:string[]=[];let expire:(()=>void)|undefined;
 installDriverDiagnosticObserver(event=>{if(event.kind==='OPERATION' && event.reasonCode) reasons.push(event.reasonCode);},{setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>undefined});
 const raw={listPending:()=>[{enqueuedAt:'2026-10-01T14:00:00.000Z'}],whenPersisted:()=>new Promise<void>(()=>undefined)};
 const observed=observeOfflineQueuePersistence(raw);
 void observed.whenPersisted();
 expire?.();
 assert.deepEqual(reasons,['STORAGE_OPERATION_TIMEOUT']);
 assert.equal(observed.listPending().length,1);
 installDriverDiagnosticObserver(null);
});
