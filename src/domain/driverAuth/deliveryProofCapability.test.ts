import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createDeliveryProofCapabilityReporter } from './deliveryProofCapability';

it('registers the authenticated session before any route exists and renews after token rotation', async () => {
  const sent: {url: string; body: unknown; bearer: string}[] = [];
  const report = createDeliveryProofCapabilityReporter({ baseUrl: 'https://example.test', installed: { packageId: 'com.evnsolution.clever.routes', versionCode: 43 }, enabled: true,
    fetchImpl: async (url, init) => { sent.push({url, body: JSON.parse(init!.body!), bearer: init!.headers!.Authorization! }); return {ok:true, status:200, json: async()=>({ data: {registered:true, capability:'delivery-proof-v1'} })}; } });
  await report({accessToken:'fixture-a', refreshToken:'fixture-r'});
  await report({accessToken:'fixture-a', refreshToken:'fixture-r'});
  await report({accessToken:'fixture-b', refreshToken:'fixture-r2'});
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {url:'https://example.test/driver/capabilities', bearer:'Bearer fixture-a', body:{refreshToken:'fixture-r',capability:'delivery-proof-v1',versionCode:43,packageId:'com.evnsolution.clever.routes'}});
});

it('does not claim support for old official builds, disabled Cash flow or QA packages', async () => {
  for (const [versionCode, packageId, enabled] of [[42,'com.evnsolution.clever.routes',true], [43,'com.evnsolution.clever.routes.qa',true], [43,'com.evnsolution.clever.routes',false]] as const) {
    const report = createDeliveryProofCapabilityReporter({ baseUrl:'https://example.test', installed:{versionCode,packageId}, enabled, fetchImpl:async()=>{throw new Error('must not call');} });
    await report({accessToken:'fixture',refreshToken:'fixture'});
  }
});
