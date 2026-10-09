import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMockDriverEventService, type DriverEventInput } from '../events/driverEvents';
import { createMockProofMediaUploadService, createProofMediaRejectedError } from '../proof/proofMediaUpload';
import { createPersistentOfflineSubmissionQueue, createInMemoryOfflineSubmissionQueue, retryOfflineSubmissions, resolveEventProofMedia } from './offlineSubmissionQueue';

const owner = 'a'.repeat(64);
const scope = { assignmentGeneration: '3' };
const access = { ...scope, routePlanId: 'route', driverContractVersion: 2 as const, expectedRouteVersionId: 'publication' };
const photo = { deliveryStopId: 'stop', fileName: 'photo.jpg', routePlanId: 'route', source: 'camera' as const, uri: 'file:///photo.jpg' };
const signature = { ...photo, kind: 'signature' as const, fileName: 'signature.png', source: 'signature' as const, uri: 'file:///signature.png' };
const event: DriverEventInput = { ...access, clientEventId: 'completion-identity', deliveryStopId: 'stop', eventType: 'STOP_DELIVERED', occurredAt: new Date('2026-10-09T01:00:00Z'), payload: { proof: { type: 'DELIVERED_NOTE', media: [{ kind: 'photo', requiresUpload: true, uri: photo.uri }, { kind: 'signature', requiresUpload: true, uri: signature.uri }] } } };

describe('configured proof survives update and offline replay', () => {
  it('persists uploaded media IDs, reopens and sends stable photo/signature references before completion', async () => {
    let raw: string | null = null;
    const storage = { getItem: async () => raw, setItem: async (_key: string, value: string) => { raw = value; }, removeItem: async () => { raw = null; } };
    const open = () => createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage });
    const queue = await open();
    queue.enqueueProofMediaUpload(photo, scope);
    queue.enqueueProofMediaUpload(signature, scope);
    queue.enqueueDriverEvent(event);
    await queue.whenPersisted();
    assert.throws(() => resolveEventProofMedia(queue, event), /waiting/i);
    const sent: DriverEventInput[] = [];
    const reopened = await open();
    const result = await retryOfflineSubmissions({ queue: reopened, orderedEventAccessIdentity: access,
      driverEventService: { ...createMockDriverEventService(), recordDriverEvent: async value => { sent.push(value); return { status: 'recorded', duplicate: false, eventId: 'server-event' }; } },
      proofMediaUploadService: { uploadProofMedia: async request => ({ ...await createMockProofMediaUploadService().uploadProofMedia(request), mediaId: request.kind === 'signature' ? 'signature-id' : 'photo-id' }) } });
    assert.equal(result.failed, 0);
    assert.equal(sent.length, 1);
    assert.equal((sent[0]!.payload?.proof as Record<string, unknown>).photoMediaId, 'photo-id');
    assert.equal((sent[0]!.payload?.proof as Record<string, unknown>).signatureMediaId, 'signature-id');
    assert.deepEqual(resolveEventProofMedia(await open(), event), sent[0]);
    const foreign = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: 'b'.repeat(64), storage });
    assert.throws(() => resolveEventProofMedia(foreign, event), /waiting/i);
  });
});

it('replaces only rejected uploads without changing the original Cash completion or a receipt-backed request', async () => {
  let raw: string | null = null;
  const storage = {getItem:async()=>raw,setItem:async(_key:string,value:string)=>{raw=value;},removeItem:async()=>{raw=null;}};
  const open = () => createPersistentOfflineSubmissionQueue({accountOwnerHash:owner,storage});
  const queue = await open();
  const original = {...event, completion:{version:1 as const,cashReceived:{amount:'122.00',currency:'CAD'}}};
  const photoItem = queue.enqueueProofMediaUpload(photo,scope);
  const signatureItem = queue.enqueueProofMediaUpload(signature,scope);
  queue.recordProofMediaUpload(photoItem.queueItemId,await createMockProofMediaUploadService().uploadProofMedia(photo));
  queue.acknowledge(photoItem.queueItemId);
  queue.enqueueDriverEvent(original);
  assert.equal(queue.rejectProofMedia(signatureItem.queueItemId),true);
  assert.equal(queue.rejectProofMedia(photoItem.queueItemId),false);
  assert.deepEqual(queue.rejectedProofForCompletion(original),[{kind:'signature',uri:signature.uri}]);
  const replacementRequest={...signature,uri:'file:///replacement.png',fileName:'replacement.png'};
  const replacement=queue.replaceRejectedProofMedia(signature.uri,replacementRequest,scope);
  const receipt={...await createMockProofMediaUploadService().uploadProofMedia(replacementRequest),mediaId:'new-signature'};
  queue.recordProofMediaUpload(replacement.queueItemId,receipt);queue.acknowledge(replacement.queueItemId);
  await queue.whenPersisted();
  const reopened=await open();
  const stored=reopened.listPending().find(item=>item.kind==='driver_event');
  assert.ok(stored?.kind==='driver_event'); assert.deepEqual(stored.event,original);
  assert.equal((resolveEventProofMedia(reopened,stored.event).payload?.proof as Record<string,unknown>).signatureMediaId,'new-signature');
  assert.deepEqual(reopened.rejectedProofForCompletion(original),[]);
  assert.throws(()=>reopened.replaceRejectedProofMedia(signature.uri,{...replacementRequest,uri:'file:///again.png'},scope),/Only rejected/);
  assert.throws(()=>reopened.replaceRejectedProofMedia(photo.uri,{...photo,uri:'file:///new.jpg'},scope),/Only rejected/);
  reopened.bindAccountOwnerHash('b'.repeat(64));
  assert.deepEqual(reopened.rejectedProofForCompletion(original),[]);
});

it('never posts a completion until a permanently rejected upload has a valid replacement', async () => {
  let now=new Date('2026-10-09T01:00:00Z');
  const original={...event,completion:{version:1 as const,cashReceived:{amount:'122.00',currency:'CAD'}}};
  let receiptUnavailable=true;let receiptLookups=0;
  const completion:import('../stop/stopCompletion').StopCompletion={id:'receipt',eventId:'server',routePlanId:'route',deliveryStopId:'stop',driverId:'driver',assignmentGeneration:'3',expectedRouteVersionId:'publication',method:'CASH',payment:{method:'CASH',methodTitle:'Cash',gatewayNames:['Cash'],financialStatus:'PENDING',expectedAmount:'122.25',currencyCode:'CAD',expectedAmountSource:'UNPAID_ORDER_TOTAL',requiresCashInput:true},expectedAmount:'122.25',actualAmount:'122.00',differenceAmount:'-0.25',currencyCode:'CAD',occurredAt:event.occurredAt.toISOString(),recordedAt:now.toISOString()};
  const queue=createInMemoryOfflineSubmissionQueue({accountOwnerHash:owner,now:()=>now});
  queue.enqueueProofMediaUpload(photo,scope);queue.enqueueProofMediaUpload(signature,scope);queue.enqueueDriverEvent(original);
  const sent:DriverEventInput[]=[];
  const retry={queue,now:()=>now,orderedEventAccessIdentity:access,driverEventReceiptService:{lookupReceipt:async()=>{receiptLookups+=1;if(receiptUnavailable)throw new Error('offline receipt GET');return {status:'UNKNOWN' as const,assignmentGeneration:null,clientEventId:event.clientEventId,errorCode:null,expectedRouteVersionId:null,routePlanId:'route',routeStatus:'IN_PROGRESS'};}},driverEventService:{...createMockDriverEventService(),recordDriverEvent:async(input:DriverEventInput)=>{sent.push(input);return {status:'recorded' as const,duplicate:false,eventId:'server',completion};}},proofMediaUploadService:{uploadProofMedia:async(request:import('../proof/proofMediaUpload').ProofMediaUploadRequest)=>{if(request.uri===signature.uri) throw createProofMediaRejectedError();return {...await createMockProofMediaUploadService().uploadProofMedia(request),uploadedAt:now.toISOString()};}}};
  for(let attempt=0;attempt<12;attempt+=1) await retryOfflineSubmissions(retry);
  assert.equal(sent.length,0);
  const pending=queue.listPending().find(item=>item.kind==='driver_event');
  assert.ok(pending?.kind==='driver_event');assert.equal(pending.state,'PENDING');assert.equal(pending.attempts,0);
  assert.deepEqual(queue.rejectedProofForCompletion(original),[{kind:'signature',uri:signature.uri}]);
  assert.equal(receiptLookups,0);
  now=new Date('2026-11-15T01:00:00Z');
  await retryOfflineSubmissions(retry);
  assert.deepEqual(queue.rejectedProofForCompletion(original),[{kind:'signature',uri:signature.uri}]);
  receiptUnavailable=false;
  const replacementRequest={...signature,uri:'file:///valid-signature.png',fileName:'valid-signature.png'};
  queue.replaceRejectedProofMedia(signature.uri,replacementRequest,scope);
  await retryOfflineSubmissions(retry);await retryOfflineSubmissions(retry);
  assert.equal(sent.length,1);assert.deepEqual(sent[0]!.completion,original.completion);assert.equal(sent[0]!.clientEventId,event.clientEventId);
  assert.equal(sent[0]!.occurredAt.getTime(),event.occurredAt.getTime());
});
