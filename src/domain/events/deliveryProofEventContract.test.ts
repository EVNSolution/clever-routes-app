import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createDriverEventsApiClient, type DriverEventInput } from './driverEvents';

it('attaches proof capability to fresh ordered events but preserves queued version42 input', async () => {
  const contract = { appVersion:'1.3.7', versionCode:43, assignmentGeneration:'2', expectedRouteVersionId:'version', driverContractVersion:2 as const, deliveryProofCapability:'delivery-proof-v1' as const };
  const sent: Record<string, unknown>[] = [];
  const service = createDriverEventsApiClient({ accessToken:'fixture', baseUrl:'https://example.test', orderedEventContract:contract,
    fetchImpl:async (_url,init)=>{ sent.push(JSON.parse(init!.body!)); return {ok:true,status:200,json:async()=>({data:{status:'recorded',duplicate:false,eventId:'event'}})}; } });
  const event: DriverEventInput = {clientEventId:'start',eventType:'ROUTE_STARTED',routePlanId:'route',occurredAt:new Date()};
  const prepared=service.prepareDriverEvent!(event);
  assert.equal(prepared.deliveryProofCapability,'delivery-proof-v1');
  await service.recordDriverEvent(prepared);
  assert.equal(sent[0]?.deliveryProofCapability,'delivery-proof-v1');
  const legacy = { ...event, appVersion:'1.3.6', versionCode:42, assignmentGeneration:'2', expectedRouteVersionId:'old-version',driverContractVersion:2 as const };
  const original=structuredClone(legacy);
  assert.deepEqual(service.prepareDriverEvent!(legacy),original);
  assert.equal(service.prepareDriverEvent!(legacy).deliveryProofCapability,undefined);
});
