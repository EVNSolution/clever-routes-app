#!/usr/bin/env node
// Actual app API parsers and persistent queue → TLS → PR489/PR486 HTTP → disposable PostgreSQL.
// No device, production environment, real customer or external provider is used.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [serverArg, shopifyArg, certArg, keyArg, outputArg, pgBin = '/opt/homebrew/opt/postgresql@17/bin'] = process.argv.slice(2);
if (!outputArg) throw new Error('Usage: node scripts/verify-kfood-cash-local-api.mjs <PR489 server> <PR328 Shopify> <TLS certificate> <TLS key> <output.json> [PostgreSQL bin]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(outputArg);
const temporary = await mkdtemp(join(tmpdir(), 'kfood-app-cash-http-'));
const checks = [];
let fixtureProcess;
let ready;
let unregister;
const cert = await readFile(resolve(certArg));
const sentEvents = [];
let fixtureLog = '';
const mark = (name) => checks.push({ name, result: 'pass' });
const mobile = (path) => import(pathToFileURL(join(root, 'src', path)).href);

async function mobileSourceDigest() {
  const digest = createHash('sha256');
  async function visit(relative) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) digest.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
    }
  }
  await visit('src');
  return digest.digest('hex');
}
let checkedSourceDigest;
async function unusedPort() {
  const listener = createServer();
  await new Promise((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
  const port = listener.address().port;
  await new Promise((accept) => listener.close(accept));
  return port;
}
// This wrapper only changes TLS trust. All app body construction and response parsing run unchanged.
function fetchLocal(url, init = {}) {
  assert.equal(new URL(url).origin, ready.baseUrl);
  if (url.endsWith('/driver/events') && init.body) sentEvents.push(JSON.parse(init.body));
  return new Promise((accept, reject) => {
    const req = request(url, { ca: cert, family: 4, method: init.method ?? 'GET', headers: init.headers, signal: init.signal }, (response) => {
      const bytes = [];
      response.on('data', (chunk) => bytes.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(bytes);
        accept({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
          json: async () => JSON.parse(body.toString('utf8')), text: async () => body.toString('utf8') });
      });
    });
    req.on('error', (error) => { error.message = `${new URL(url).pathname}: ${error.message}`; reject(error); });
    req.end(init.body);
  });
}
async function jsonCall(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetchLocal(`${ready.baseUrl}${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, value }));
  return value;
}
const control = (body) => jsonCall('/__qa/control', { token: ready.controlToken, body });
function fileStorage(directory) {
  const pathFor = (key) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  return {
    async getItem(key) { try { return await readFile(pathFor(key), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async setItem(key, value) { await writeFile(`${pathFor(key)}.next`, value); await rename(`${pathFor(key)}.next`, pathFor(key)); },
    removeItem: (key) => rm(pathFor(key), { force: true }),
  };
}

try {
  const port = await unusedPort();
  const fixtureEvidence = join(temporary, 'fixture.json');
  fixtureProcess = spawn(process.execPath, [join(root, 'scripts/kfood-native-qa-server.mjs'), resolve(serverArg), resolve(shopifyArg), resolve(certArg), resolve(keyArg), fixtureEvidence, String(port), pgBin, '--cash'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  ready = await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Disposable fixture startup exceeded 60 seconds')), 60_000);
    fixtureProcess.once('error', reject);
    fixtureProcess.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Fixture exited ${code}: ${fixtureLog.slice(-4000)}`)); });
    fixtureProcess.stderr.on('data', (chunk) => { fixtureLog += chunk.toString(); });
    let stdout = '';
    fixtureProcess.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split('\n').slice(0, -1)) {
        try { const result = JSON.parse(line); if (result.ready) { clearTimeout(timeout); accept(result); return; } } catch { /* Server logs are diagnostics. */ }
      }
    });
  });
  checkedSourceDigest = await mobileSourceDigest();
  const { register } = await import(pathToFileURL(join(root, 'node_modules/tsx/dist/esm/api/index.mjs')).href);
  unregister = register({ tsconfig: join(root, 'tsconfig.json') });
  const { createDriverApiClientsFromPersistedDriverAccess } = await mobile('api/deliveryServer/driverApiClients.ts');
  const { createDriverEventReceiptApiClient } = await mobile('domain/events/driverEventReceipt.ts');
  const { createPersistentOfflineSubmissionQueue, retryOfflineSubmissions } = await mobile('domain/offline/offlineSubmissionQueue.ts');
  const { createLiveRouteChangeStore, emptyLiveRouteChangeState } = await mobile('domain/route/liveRouteChangeStore.ts');
  const { stageLiveRouteRefresh, applyLiveRouteChange, hasPendingLiveRouteChange } = await mobile('app/liveRouteChangeController.ts');
  const firstAuth = (await jsonCall('/driver/auth/login', { body: { phone: ready.credentials[0].phone, pin: ready.credentials[0].pin } })).data;
  const secondAuth = (await jsonCall('/driver/auth/login', { body: { phone: ready.credentials[1].phone, pin: ready.credentials[1].pin } })).data;
  const access = (await jsonCall('/driver/route-access/lookup', { token: firstAuth.accessToken, body: { routeContext: ready.routePlanId } })).data;
  assert.equal(access.status, 'INVITED');
  const makeClients = (version = ready.baselineVersionId) => createDriverApiClientsFromPersistedDriverAccess({
    baseUrl: ready.baseUrl, appVersion: '1.3.4-cashqa', versionCode: 40, fetchImpl: fetchLocal,
    persistedAccess: { ...access, routeAccess: { ...access.routeAccess, expectedRouteVersionId: version } },
  });
  const clients = makeClients();
  const receipts = createDriverEventReceiptApiClient({ baseUrl: ready.baseUrl, accountAccessToken: firstAuth.accessToken, fetchImpl: fetchLocal });
  const otherReceipts = createDriverEventReceiptApiClient({ baseUrl: ready.baseUrl, accountAccessToken: secondAuth.accessToken, fetchImpl: fetchLocal });
  const owner = createHash('sha256').update('synthetic-cash-first-account').digest('hex');
  const stateDirectory = join(temporary, 'queue');
  await mkdir(stateDirectory);
  const storage = fileStorage(stateDirectory);
  let nextQueue = 0;
  const newQueue = () => createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage, storageKey: `cash-${nextQueue++}` });
  const event = (index, amount, extra = {}) => ({ clientEventId: randomUUID(), routePlanId: ready.routePlanId,
    deliveryStopId: ready.stopIds[index], eventType: 'STOP_DELIVERED', occurredAt: new Date(),
    assignmentGeneration: '2', expectedRouteVersionId: ready.baselineVersionId, driverContractVersion: 2,
    appVersion: '1.3.4-cashqa', versionCode: 40, completion: { version: 1, ...(amount === undefined ? {} : { cashReceived: { amount, currency: 'CAD' } }) }, ...extra });
  const flush = (queue, overrides = {}) => retryOfflineSubmissions({ queue, routePlanId: ready.routePlanId,
    driverEventService: clients.driverEventService, proofMediaUploadService: clients.proofMediaUploadService,
    driverEventReceiptService: receipts, orderedEventAccessIdentity: { routePlanId: ready.routePlanId, assignmentGeneration: '2',
      driverContractVersion: 2, expectedRouteVersionId: ready.baselineVersionId, allowPreviousPublicationStopEvents: true }, ...overrides });
  const route = (await clients.assignedRouteService.getAssignedRoute({ routeContext: ready.routePlanId })).route;
  assert.equal(route.stops.length, 14);
  assert.deepEqual(route.stops.slice(0, 4).map((stop) => stop.payment.expectedAmount), Array(4).fill('122.25'));
  assert.equal(route.stops[4].payment.method, 'ETRANSFER');
  assert.equal(route.stops[4].payment.requiresCashInput, false);
  assert.equal(route.stops[5].payment.expectedAmount, '0.00');
  assert.equal(route.stops[5].payment.requiresCashInput, false);
  assert.equal(route.stops[6].payment.method, 'UNKNOWN');
  assert.equal(route.stops[7].phone, null);
  assert.equal(route.stops[8].payment.expectedAmount, null);
  assert.equal(route.stops[13].payment.currencyCode, null);
  mark('Actual assigned-route DTO preserves Cash, eTransfer, paid, unknown method/balance/currency and missing phone');

  const zeroBefore = await control({ action: 'completion-status' });
  assert.equal(zeroBefore.receiptCount, 0);
  await assert.rejects(() => clients.driverEventService.recordDriverEvent(event(0, undefined)), (error) => error.status === 400 && error.code === 'CASH_RECEIVED_REQUIRED');
  assert.equal((await control({ action: 'completion-status' })).receiptCount, 0);
  mark('Missing Cash actual amount gets authoritative400 without a receipt');

  const completed = [];
  for (const [index, amount, actual, difference] of [[0, '122', '122.00', '-0.25'], [1, '122.25', '122.25', '0.00'], [2, '123', '123.00', '0.75'], [3, '0', '0.00', '-122.25']]) {
    const queue = await newQueue();
    const original = event(index, amount);
    queue.enqueueDriverEvent(original);
    queue.enqueueDriverEvent(original);
    assert.equal(queue.listPending().length, 1);
    await queue.whenPersisted();
    const submitted = await flush(queue);
    assert.equal(submitted.succeeded, 1, JSON.stringify({ submitted, pending: queue.listPending() }));
    await queue.whenPersisted();
    const receipt = queue.getStopCompletion(ready.routePlanId, ready.stopIds[index]);
    assert.equal(receipt.expectedAmount, '122.25');
    assert.equal(receipt.actualAmount, actual);
    assert.equal(receipt.differenceAmount, difference);
    const retry = await clients.driverEventService.recordDriverEvent(original);
    assert.equal(retry.duplicate, true);
    assert.deepEqual(retry.completion, receipt);
    completed.push({ index, original, receipt });
  }
  assert.equal((await control({ action: 'completion-status' })).receiptCount, 4);
  await assert.rejects(() => clients.driverEventService.recordDriverEvent({ ...completed[0].original, completion: { version: 1, cashReceived: { amount: '123', currency: 'CAD' } } }), (error) => error.status === 409 && error.code === 'CASH_COMPLETION_CONFLICT');
  mark('Actual122/122.25/123/0 persist exact results; double-tap and identical retries create one receipt each');

  for (const index of [4, 5, 6]) {
    const result = await clients.driverEventService.recordDriverEvent(event(index, undefined));
    assert.equal(result.completion.actualAmount, null);
  }
  const unsupportedQueue = await newQueue();
  const unsupportedEvent = event(7, undefined);
  unsupportedQueue.enqueueDriverEvent(unsupportedEvent);
  await unsupportedQueue.whenPersisted();
  await control({ action: 'omit-completion-responses' });
  assert.equal((await flush(unsupportedQueue)).succeeded, 0);
  assert.equal(unsupportedQueue.listPending().length, 1);
  assert.equal(unsupportedQueue.getStopCompletion(ready.routePlanId, ready.stopIds[7]), null);
  assert.equal((await flush(unsupportedQueue)).succeeded, 0);
  assert.equal(unsupportedQueue.listPending().length, 1);
  assert.deepEqual(unsupportedQueue.listPending()[0].event.completion, unsupportedEvent.completion);
  await control({ action: 'omit-completion-responses', enabled: false });
  assert.equal((await flush(unsupportedQueue)).succeeded, 1);
  assert.equal(unsupportedQueue.getStopCompletion(ready.routePlanId, ready.stopIds[7]).actualAmount, null);
  mark('Successful POST without completion and APPLIED receipt without completion cannot acknowledge or erase opt-in request');
  const unknown = await clients.driverEventService.recordDriverEvent(event(8, '22'));
  assert.equal(unknown.completion.expectedAmount, null);
  assert.equal(unknown.completion.actualAmount, '22.00');
  assert.equal(unknown.completion.differenceAmount, null);
  mark('eTransfer/paid/unknown methods complete without Cash; unknown expected amount stays null');

  await control({ action: 'set-stop-payment', index: 0, scenario: 'currency-usd' });
  const immutableRoute = (await clients.assignedRouteService.getAssignedRoute({ routeContext: ready.routePlanId })).route;
  assert.equal(immutableRoute.stops[0].payment.currencyCode, 'USD');
  assert.equal(immutableRoute.stops[0].completion.currencyCode, 'CAD');
  assert.deepEqual(immutableRoute.stops[0].completion, completed[0].receipt);
  const originalReceipt = await receipts.lookupReceipt({ routePlanId: ready.routePlanId, clientEventId: completed[0].original.clientEventId });
  assert.equal(originalReceipt.status, 'APPLIED');
  assert.deepEqual(originalReceipt.completion, completed[0].receipt);
  await assert.rejects(() => otherReceipts.lookupReceipt({ routePlanId: ready.routePlanId, clientEventId: completed[0].original.clientEventId }), (error) => error.status === 404 && error.code === 'DRIVER_EVENT_RECEIPT_NOT_FOUND');
  mark('Current source changes cannot rewrite completion; account receipt restores immutable result and rejects other accounts');

  const offlineKey = 'offline-restart';
  let offlineQueue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage, storageKey: offlineKey });
  const offlineEvent = event(9, '123');
  offlineQueue.enqueueDriverEvent(offlineEvent);
  await offlineQueue.whenPersisted();
  await control({ action: 'offline' });
  assert.equal((await flush(offlineQueue)).succeeded, 0);
  await control({ action: 'offline', enabled: false });
  await control({ action: 'service-unavailable' });
  assert.equal((await flush(offlineQueue)).succeeded, 0);
  await control({ action: 'service-unavailable', enabled: false });
  await offlineQueue.whenPersisted();
  offlineQueue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage, storageKey: offlineKey });
  assert.equal(offlineQueue.listPending()[0].event.clientEventId, offlineEvent.clientEventId);
  assert.deepEqual(offlineQueue.listPending()[0].event.completion, offlineEvent.completion);
  assert.equal((await flush(offlineQueue)).succeeded, 1);
  assert.equal(offlineQueue.getStopCompletion(ready.routePlanId, ready.stopIds[9]).actualAmount, '123.00');
  mark('Offline and503 preserve original durable request; recreated queue sends same identity/time/version/amount');

  const invalidQueue = await newQueue();
  const invalidEvent = event(10, '122');
  invalidQueue.enqueueDriverEvent(invalidEvent);
  await invalidQueue.whenPersisted();
  await control({ action: 'set-stop-payment', index: 10, scenario: 'currency-usd' });
  assert.equal((await flush(invalidQueue)).succeeded, 0);
  assert.equal(invalidQueue.listPending()[0].state, 'QUARANTINED');
  const sentBefore = sentEvents.length;
  await flush(invalidQueue);
  assert.equal(sentEvents.length, sentBefore);
  assert.deepEqual(invalidQueue.listPending()[0].event.completion, invalidEvent.completion);
  await control({ action: 'set-stop-payment', index: 10, scenario: 'cash-400' });
  mark('Authoritative400 currency mismatch quarantines original money; no infinite retry or legacy fallback');

  // This is a socket interruption + queue recreation test. Physical process termination is separate evidence.
  const heldEvent = event(10, '122');
  const heldKey = 'held-response';
  let heldQueue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage, storageKey: heldKey });
  heldQueue.enqueueDriverEvent(heldEvent);
  await heldQueue.whenPersisted();
  await control({ action: 'hold-next-completion-response' });
  const controller = new AbortController();
  const firstPost = clients.driverEventService.recordDriverEvent(heldEvent, { signal: controller.signal }).catch((error) => error);
  let held;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    held = await control({ action: 'completion-status' });
    if (held.heldCompletionResponse) break;
    await new Promise((accept) => setTimeout(accept, 50));
  }
  assert.ok(held.heldCompletionResponse);
  assert.equal(held.heldCompletionResponse.receiptCount, 1);
  assert.equal(held.heldCompletionResponse.eventCount, 1);
  assert.equal(held.heldCompletionResponse.responseDelivered, false);
  controller.abort();
  await firstPost;
  heldQueue = await createPersistentOfflineSubmissionQueue({ accountOwnerHash: owner, storage, storageKey: heldKey });
  const sendsBeforeRecovery = sentEvents.length;
  assert.equal((await flush(heldQueue)).succeeded, 1);
  assert.equal(sentEvents.length, sendsBeforeRecovery);
  assert.equal(heldQueue.getStopCompletion(ready.routePlanId, ready.stopIds[10]).actualAmount, '122.00');
  assert.equal((await control({ action: 'completion-status' })).receipts.filter((receipt) => receipt.clientEventId === heldEvent.clientEventId).length, 1);
  mark('Post-DB response hold confirms one receipt; socket interruption and queue recreation recover via receipt without another POST');

  const baseline = (await clients.assignedRouteService.getAssignedRoute({ routeContext: ready.routePlanId })).route;
  let persistedState = null;
  const store = createLiveRouteChangeStore({
    readLiveRouteChangeState: async () => persistedState,
    removeLiveRouteChangeState: async () => { persistedState = null; },
    updateLiveRouteChangeState: async (_owner, mutate) => { persistedState = mutate(persistedState); return persistedState; },
  });
  const uiDraft = { currentStopId: ready.stopIds[11], selectedStopDetailsId: ready.stopIds[12], proofDrafts: { [ready.stopIds[11]]: { additionalNotes: 'Synthetic retained note', locationTip: 'Synthetic location tip', todayNote: 'Synthetic today note' } }, proofPhotoResults: {}, proofMediaResults: {} };
  await store.update(owner, ready.routePlanId, '2', () => ({ ...emptyLiveRouteChangeState(ready.routePlanId, '2'), appliedRoute: baseline, appliedPublicationVersionId: ready.baselineVersionId, appliedPublicationSequence: 0, uiDraft }));
  const dispatched = await control({ action: 'publish', address: '700 Synthetic Cash Dispatch', stopIndex: 12 });
  const publication = await clients.liveRouteChangeService.getLiveRouteChange({ routePlanId: ready.routePlanId });
  const refreshed = (await clients.assignedRouteService.getAssignedRoute({ routeContext: ready.routePlanId })).route;
  const staged = stageLiveRouteRefresh({ state: await store.read(owner, ready.routePlanId, '2'), route: refreshed, assignmentGeneration: '2', expectedRouteVersionId: dispatched.publicationVersionId, publication });
  assert.equal(hasPendingLiveRouteChange(staged), true);
  assert.equal(staged.appliedRoute.stops[12].address.address1, '13 Integration Road');
  await store.update(owner, ready.routePlanId, '2', () => staged);
  const applied = await applyLiveRouteChange({ store, accountOwnerHash: owner, routePlanId: ready.routePlanId, assignmentGeneration: '2', baseRoute: baseline, service: clients.liveRouteChangeService, isCurrent: () => true, uiDraft, onApplied: async () => undefined });
  assert.equal(applied.appliedRoute.stops[12].address.address1, '700 Synthetic Cash Dispatch');
  assert.deepEqual(applied.uiDraft, uiDraft);
  assert.deepEqual(applied.appliedRoute.stops[0].completion, completed[0].receipt);
  mark('PR486 Dispatch remains pending until explicit Apply; retained inputs and immutable completion survive');

  const assignmentQueue = await newQueue();
  const assignmentEvent = event(11, '122');
  assignmentQueue.enqueueDriverEvent(assignmentEvent);
  await assignmentQueue.whenPersisted();
  assignmentQueue.bindAccountOwnerHash(createHash('sha256').update('synthetic-second-owner').digest('hex'));
  assert.equal(assignmentQueue.listPending().length, 0);
  assignmentQueue.bindAccountOwnerHash(owner);
  assert.equal(assignmentQueue.listPending()[0].event.clientEventId, assignmentEvent.clientEventId);
  await control({ action: 'reassign', account: 'first' });
  assert.equal((await flush(assignmentQueue)).succeeded, 0);
  assert.equal(assignmentQueue.listPending()[0].state, 'QUARANTINED');
  assert.deepEqual(assignmentQueue.listPending()[0].event.completion, assignmentEvent.completion);
  await control({ action: 'reassign', account: 'second' });
  assert.equal((await receipts.lookupReceipt({ routePlanId: ready.routePlanId, clientEventId: completed[0].original.clientEventId })).status, 'APPLIED');
  mark('Account switch hides other owner queue; assignment conflict retains original pending money and original driver receipt remains recoverable');

  await control({ action: 'evidence' });
  const databaseEvidence = JSON.parse(await readFile(fixtureEvidence, 'utf8'));
  assert.equal(databaseEvidence.events.filter((item) => item.eventType === 'STOP_ARRIVED').length, 0);
  assert.equal(databaseEvidence.completionReceipts.length, 11);
  assert.ok(sentEvents.filter((item) => item.eventType === 'STOP_DELIVERED').every((item) => item.completion?.version === 1 && item.payload?.completion === undefined));
  mark('No STOP_ARRIVED generated; all opt-in completion fields stay top-level and database stores exactly11 receipts');
  assert.equal(await mobileSourceDigest(), checkedSourceDigest, 'App sources changed during integration; rerun after source freeze');
  const mobileBaseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ mobileBaseSha, mobileSourceSha256: checkedSourceDigest, status: 'pass', verifiedAt: new Date().toISOString(), serverSourceSha: ready.serverSourceSha,
    shopifySourceSha: ready.shopifySourceSha, transport: ready.transport, checks,
    cashReceipts: databaseEvidence.completionReceipts.map(({ clientEventId, expectedAmount, actualAmount, differenceAmount, currencyCode }) => ({ clientEventId, expectedAmount, actualAmount, differenceAmount, currencyCode })),
    heldResponse: databaseEvidence.heldCompletion,
    limitations: ['Real app API/parser/queue with temporary file persistence; native SQLCipher and app-process termination require separate physical-device evidence.', 'No external providers, real customers or production deployment.'],
  }, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'pass', checks: checks.length, output }));
} catch (error) {
  await mkdir(dirname(output), { recursive: true });
  let fixtureEvidence = null;
  if (ready) await control({ action: 'evidence' }).catch(() => undefined);
  try { fixtureEvidence = JSON.parse(await readFile(join(temporary, 'fixture.json'), 'utf8')); } catch { /* Startup can fail before evidence exists. */ }
  await writeFile(output, `${JSON.stringify({ status: 'failed', checks, error: error.stack, fixtureLog: fixtureLog.slice(-4000), fixtureEvidence }, null, 2)}\n`);
  throw error;
} finally {
  await unregister?.();
  if (ready && fixtureProcess?.exitCode === null) await control({ action: 'shutdown' }).catch(() => fixtureProcess.kill('SIGTERM'));
  if (fixtureProcess?.exitCode === null) await new Promise((accept) => fixtureProcess.once('exit', accept));
  await rm(temporary, { recursive: true, force: true });
}
