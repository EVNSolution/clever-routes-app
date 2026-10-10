import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createDriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import { createDeliveryProofCapabilityReporter, reportDeliveryProofCapabilityBestEffort } from './deliveryProofCapability';

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

it('does not let a failed capability registration hide the driver routes, but still reports an expired session', async () => {
  const account = { accessToken: 'fixture', refreshToken: 'fixture' };
  for (const failure of [
    new Error('network request failed'),
    new Error('OPERATION_TIMEOUT'),
    new Error('Delivery proof capability was not confirmed.'),
    createDriverApiHttpError({ endpoint: 'Delivery proof capability', status: 400 }),
    createDriverApiHttpError({ endpoint: 'Delivery proof capability', status: 403 }),
    createDriverApiHttpError({ endpoint: 'Delivery proof capability', status: 404 }),
    createDriverApiHttpError({ endpoint: 'Delivery proof capability', status: 500 }),
  ]) {
    let calls = 0;
    await reportDeliveryProofCapabilityBestEffort(async () => { calls += 1; throw failure; }, account);
    assert.equal(calls, 1, String(failure));
  }
  const expired = createDriverApiHttpError({ endpoint: 'Delivery proof capability', status: 401 });
  await assert.rejects(reportDeliveryProofCapabilityBestEffort(async () => { throw expired; }, account), expired);
  let reported = 0;
  await reportDeliveryProofCapabilityBestEffort(async (received) => { reported += 1; assert.equal(received, account); }, account);
  assert.equal(reported, 1);
});

it('tries to register again at the next lookup after a failed registration', async () => {
  let attempts = 0;
  const report = createDeliveryProofCapabilityReporter({ baseUrl: 'https://example.test', installed: { packageId: 'com.evnsolution.clever.routes', versionCode: 43 }, enabled: true,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ data: { registered: true, capability: 'delivery-proof-v1' } }) };
    } });
  const account = { accessToken: 'fixture-a', refreshToken: 'fixture-r' };
  await reportDeliveryProofCapabilityBestEffort(report, account);
  await reportDeliveryProofCapabilityBestEffort(report, account);
  await reportDeliveryProofCapabilityBestEffort(report, account);
  assert.equal(attempts, 2);
});

it('looks the routes up through the best-effort registration in both the first and the refreshed attempt', () => {
  const source = readFileSync(new URL('../../app/AppRoot.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const submitAccountRouteAccess = useCallback(');
  const lookup = source.slice(start, source.indexOf('const sendCompletionAcknowledgedHeartbeatBeforeCleanup = useCallback(', start));
  assert.equal((lookup.match(/reportDeliveryProofCapabilityBestEffort\(reportDeliveryProofCapability, /gu) ?? []).length, 2);
  assert.doesNotMatch(lookup.replace(/reportDeliveryProofCapabilityBestEffort\(reportDeliveryProofCapability, /gu, ''), /await reportDeliveryProofCapability\(/u);
});
