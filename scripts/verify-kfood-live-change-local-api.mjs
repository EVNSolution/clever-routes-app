#!/usr/bin/env node
// Actual mobile services and controller, Shopify BFF, Fastify and Prisma over loopback HTTP.
// This command owns synthetic data in a temporary PostgreSQL cluster. It never loads .env.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverRoot = process.argv[2] && resolve(process.argv[2]);
const shopifyRoot = process.argv[3] && resolve(process.argv[3]);
if (!serverRoot || !shopifyRoot) {
  throw new Error('Usage: node scripts/verify-kfood-live-change-local-api.mjs <PR486 server checkout> <PR328 Shopify checkout> [PostgreSQL bin directory]');
}
const pgBin = process.argv[4] ?? '/opt/homebrew/opt/postgresql@17/bin';
const apiDir = join(serverRoot, 'apps/delivery-api');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = join(repoRoot, 'docs/verification/kfood-live-change-local-api-20261007.json');
const temp = await mkdtemp(join(tmpdir(), 'kfood-driver-live-api-'));
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C' };
const checks = [];
let pgStarted = false;
let app;
let prisma;
let unregister;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: childEnv, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command.split('/').at(-1)} failed: ${result.error?.message ?? result.stderr.slice(-1500)}`);
  return result.stdout.trim();
}
async function unusedPort() {
  const listener = createServer();
  await new Promise((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
  const port = listener.address().port;
  await new Promise((accept, reject) => listener.close((error) => error ? reject(error) : accept()));
  return port;
}
const source = (path) => import(pathToFileURL(join(apiDir, 'src', path)).href);
const mobile = (path) => import(pathToFileURL(join(repoRoot, 'src', path)).href);
const shopify = (path) => import(pathToFileURL(join(shopifyRoot, 'apps/shopify-app/app', path)).href);
const ok = (result) => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; };
const mark = (name) => checks.push({ name, result: 'pass' });

// The native adapter is SQLCipher. This file adapter exercises the same production
// domain store through a real close/reopen boundary without requiring an Expo runtime.
function durableStorage(directory) {
  let transaction = Promise.resolve();
  const pathFor = (ownerHash) => join(directory, `${createHash('sha256').update(ownerHash).digest('hex')}.json`);
  const read = async (ownerHash) => {
    try { return await readFile(pathFor(ownerHash), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  return {
    readLiveRouteChangeState: read,
    removeLiveRouteChangeState: (ownerHash) => rm(pathFor(ownerHash), { force: true }),
    updateLiveRouteChangeState(ownerHash, mutate) {
      const next = transaction.then(async () => {
        const content = mutate(await read(ownerHash));
        const path = pathFor(ownerHash);
        await writeFile(`${path}.next`, content);
        await rename(`${path}.next`, path);
        return content;
      });
      transaction = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}
async function sourceDigest(root, paths) {
  const hash = createHash('sha256');
  async function visit(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) hash.update(relative).update('\0').update(await readFile(join(root, relative))).update('\0');
    }
  }
  for (const path of paths) await visit(path);
  return hash.digest('hex');
}

try {
  const port = await unusedPort();
  run(join(pgBin, 'initdb'), ['-D', join(temp, 'pg'), '--auth-local=trust', '--auth-host=trust', '--no-locale', '-E', 'UTF8']);
  run(join(pgBin, 'pg_ctl'), ['-D', join(temp, 'pg'), '-l', join(temp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${temp} -c max_connections=16 -c shared_buffers=32MB`, '-w', 'start']);
  pgStarted = true;
  run(join(pgBin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), 'kfood_live_change']);
  const databaseUrl = `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}/kfood_live_change?schema=public`;
  assert.equal(new URL(databaseUrl).hostname, '127.0.0.1');
  run(process.execPath, [join(apiDir, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(apiDir, 'prisma/schema.prisma')], {
    cwd: temp, env: { ...childEnv, DATABASE_URL: databaseUrl },
  });
  const { register } = await import(pathToFileURL(join(apiDir, 'node_modules/tsx/dist/esm/api/index.mjs')).href);
  unregister = register({ tsconfig: join(apiDir, 'tsconfig.json') });
  const { PrismaClient } = await import(pathToFileURL(join(apiDir, 'node_modules/@prisma/client/default.js')).href);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const { buildApp } = await source('app.ts');
  const { PrismaLiveRouteChangeService } = await source('modules/route-plans/live-route-change.service.ts');
  const { PrismaRoutePlanRepository } = await source('modules/route-plans/route-plan.repository.ts');
  const { RoutePlanAdminService } = await source('modules/route-plans/route-plan.service.ts');
  const { ShopifySessionTokenVerifier } = await source('modules/shopify/session-token-verifier.ts');
  const { PrismaDriverEventRepository } = await source('modules/driver/driver-event.repository.ts');
  const { PrismaDriverAssignedRouteRepository } = await source('modules/driver/driver-assigned-route.repository.ts');
  const { PrismaDriverTokenAccessRepository } = await source('modules/driver/driver-token-access.repository.ts');
  const { signDriverRouteToken } = await source('modules/driver/driver-token-verifier.ts');
  const { KFOOD_DELIVERY_APP_ID: appId, KFOOD_DELIVERY_SHOP_DOMAIN: shopDomain } = await source('modules/route-plans/kfood-delivery-completion.ts');
  const { createDriverApiClientsFromPersistedDriverAccess } = await mobile('api/deliveryServer/driverApiClients.ts');
  const { applyLiveRoutePublication, mergeLiveRouteExecutionState } = await mobile('domain/route/liveRouteChange.ts');
  const { createLiveRouteChangeStore, emptyLiveRouteChangeState } = await mobile('domain/route/liveRouteChangeStore.ts');
  const { stageLiveRouteRefresh, hasPendingLiveRouteChange, applyLiveRouteChange, retryLiveRouteAcknowledgement } = await mobile('app/liveRouteChangeController.ts');
  const { createInMemoryOfflineSubmissionQueue, retryOfflineSubmissions } = await mobile('domain/offline/offlineSubmissionQueue.ts');
  const fixture = await seedFixture(prisma, appId, shopDomain);
  const clientId = 'synthetic-local-shopify-client';
  const clientSecret = randomUUID();
  const driverSecret = randomUUID();
  const liveService = new PrismaLiveRouteChangeService(prisma);
  app = await buildApp({
    adminRoutePlans: {
      liveRouteChangeService: liveService,
      routePlanService: new RoutePlanAdminService(new PrismaRoutePlanRepository(prisma)),
      sessionTokenVerifier: new ShopifySessionTokenVerifier({ appId, clientId, clientSecret }),
    },
    driverApi: {
      driverAssignedRouteService: new PrismaDriverAssignedRouteRepository(prisma),
      driverEventService: new PrismaDriverEventRepository(prisma),
      driverTokenAccessRepository: new PrismaDriverTokenAccessRepository(prisma),
      liveRouteChangeService: liveService,
      jwtSecret: driverSecret,
    },
  });
  const apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  process.env.CLEVER_APP_ID = appId;
  process.env.CLEVER_KFOOD_LIVE_CHANGE_ENABLED = 'true';
  process.env.CLEVER_DELIVERY_API_URL = apiUrl;
  const { fetchKfoodLiveChange, getKfoodLiveChangeContext, runKfoodLiveChangeCommand } = await shopify('features/delivery/live-change.server.js');
  const session = { shop: shopDomain, id: `offline_${shopDomain}` };
  const officeToken = jwt(shopDomain, clientId, clientSecret);
  const request = () => new Request(`http://127.0.0.1/app/routes/${fixture.route.id}`, { headers: { authorization: `Bearer ${officeToken}` } });
  const adminOptions = { session, scopeKey: getKfoodLiveChangeContext(session).liveChangeScopeKey, routePlanId: fixture.route.id, routeGroupId: fixture.group.id };
  const readAdmin = async () => ok(await fetchKfoodLiveChange(request(), fixture.route.id, adminOptions));
  const command = (draft, extra = {}) => ({ commandId: randomUUID(), expectedAssignmentGeneration: draft.assignmentGeneration, expectedRouteVersionId: draft.expectedRouteVersionId, expectedRevision: draft.revision, ...extra });
  const send = async (intent, payload) => ok(await runKfoodLiveChangeCommand(request(), fixture.route.id, intent, JSON.stringify(payload), adminOptions));
  const publish = async (extra) => {
    const saved = await send('liveChangeSave', command(await readAdmin(), { stopOverrides: [], ...extra }));
    return send('liveChangeDispatch', command(saved));
  };
  const driverToken = signDriverRouteToken({ accountId: fixture.account.id, routePlanId: fixture.route.id, tokenVersion: fixture.account.tokenVersion, subject: `driver-account:${fixture.account.id}`, expiresInSeconds: 1200 }, { secret: driverSecret }).token;
  const sentEvents = [];
  const acknowledgements = [];
  let beforeAck;
  let loseAck = false;
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal(init.cache, 'no-store');
    if (url.endsWith('/driver/events')) sentEvents.push(JSON.parse(init.body));
    if (url.endsWith('/live-change/applied')) {
      acknowledgements.push(JSON.parse(init.body));
      if (beforeAck) { const action = beforeAck; beforeAck = undefined; await action(); }
    }
    const response = await fetch(url, init);
    if (url.endsWith('/live-change') || url.endsWith('/assigned-route')) {
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    if (loseAck && url.endsWith('/live-change/applied')) {
      loseAck = false;
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      throw new Error('Synthetic lost ACK response after server commit');
    }
    return response;
  };
  const makeClients = (version = fixture.version.id) => createDriverApiClientsFromPersistedDriverAccess({
    baseUrl: apiUrl, appVersion: '1.3.4-local', versionCode: 40, fetchImpl,
    persistedAccess: {
      driverAccess: { accessToken: driverToken },
      routeAccess: { routePlanId: fixture.route.id, assignmentGeneration: '2', driverContractVersion: 2, expectedRouteVersionId: version },
    },
  });
  const clients = makeClients();
  const getRoute = async () => {
    const result = await clients.assignedRouteService.getAssignedRoute({ routeContext: fixture.route.id });
    assert.equal(result.status, 'ASSIGNED_ROUTE');
    return result.route;
  };
  const identity = { routePlanId: fixture.route.id };
  const accountOwnerHash = createHash('sha256').update('synthetic-account').digest('hex');
  const generation = '2';
  await mkdir(join(temp, 'state'));
  let store = createLiveRouteChangeStore(durableStorage(join(temp, 'state')));
  const readState = () => store.read(accountOwnerHash, fixture.route.id, generation);
  let renderedRoute = await getRoute();
  const originalRoute = structuredClone(renderedRoute);
  const uiDraft = { currentStopId: fixture.stops[1].id, selectedStopDetailsId: fixture.stops[6].id, proofDrafts: { [fixture.stops[1].id]: { additionalNotes: 'synthetic unsent note', locationTip: 'synthetic location tip', todayNote: 'synthetic current note' } }, proofPhotoResults: { [fixture.stops[1].id]: { kind: 'captured', source: 'camera', uri: 'file:///synthetic-proof.jpg' } }, proofMediaResults: {} };
  await store.update(accountOwnerHash, fixture.route.id, generation, () => ({
    ...emptyLiveRouteChangeState(fixture.route.id, generation),
    appliedRoute: renderedRoute,
    appliedPublicationVersionId: fixture.version.id,
    appliedPublicationSequence: 0,
    uiDraft,
  }));
  assert.equal(await clients.liveRouteChangeService.getLiveRouteChange(identity), null);
  const saved = await send('liveChangeSave', command(await readAdmin(), {
    stopOverrides: [{ deliveryStopId: fixture.stops[6].id, address1: '700 First Synthetic Avenue', latitude: 43.57, longitude: -80.57 }],
  }));
  const baseline = await clients.liveRouteChangeService.getLiveRouteChange(identity);
  assert.equal(baseline.sequence, 0);
  assert.equal(baseline.pending, false);
  assert.deepEqual((await getRoute()).stops.map((stop) => stop.address), originalRoute.stops.map((stop) => stop.address));
  mark('Actual Shopify BFF Save is private to the office; mobile GET remains at the baseline publication');

  const first = await send('liveChangeDispatch', command(saved));
  const publicationOne = await clients.liveRouteChangeService.getLiveRouteChange(identity);
  assert.equal(publicationOne.publicationVersionId, first.publicationVersionId);
  assert.equal(publicationOne.pending, true);
  const refreshed = await getRoute();
  assert.equal(refreshed.stops.find((stop) => stop.deliveryStopId === fixture.stops[6].id).address.address1, '700 First Synthetic Avenue');
  const staged = stageLiveRouteRefresh({ state: await readState(), route: refreshed, assignmentGeneration: generation, expectedRouteVersionId: first.publicationVersionId, publication: publicationOne });
  await store.update(accountOwnerHash, fixture.route.id, generation, () => staged);
  renderedRoute = staged.appliedRoute;
  assert.equal(hasPendingLiveRouteChange(staged), true);
  assert.equal(renderedRoute.stops.find((stop) => stop.deliveryStopId === fixture.stops[6].id).address.address1, '7 Integration Road');
  assert.equal(renderedRoute.stops[1].status, 'ARRIVED');
  assert.deepEqual(staged.uiDraft, uiDraft);
  const gated = stageLiveRouteRefresh({ state: null, route: refreshed, assignmentGeneration: generation, expectedRouteVersionId: first.publicationVersionId, publication: publicationOne });
  assert.equal(gated.appliedRoute, null);
  assert.equal(hasPendingLiveRouteChange(gated), true);
  mark('Dispatch creates pending state; actual refresh controller retains original content and gates missing local baseline recovery');

  let second;
  beforeAck = async () => { second = await publish({ stopOverrides: [{ deliveryStopId: fixture.stops[6].id, address1: '700 Second Synthetic Avenue', latitude: 43.58, longitude: -80.58 }] }); };
  const applyOptions = () => ({ store, accountOwnerHash, routePlanId: fixture.route.id, assignmentGeneration: generation, baseRoute: renderedRoute, service: clients.liveRouteChangeService, isCurrent: () => true, uiDraft, onApplied: (state) => { renderedRoute = state.appliedRoute; } });
  const afterApplyOne = await applyLiveRouteChange(applyOptions());
  assert.equal(afterApplyOne.appliedPublicationVersionId, first.publicationVersionId);
  assert.equal(afterApplyOne.pendingPublication.publicationVersionId, second.publicationVersionId);
  assert.equal(hasPendingLiveRouteChange(afterApplyOne), true);
  assert.equal(afterApplyOne.appliedRoute.stops.find((stop) => stop.deliveryStopId === fixture.stops[6].id).address.address1, '700 First Synthetic Avenue');
  assert.equal(acknowledgements.at(-1).publicationVersionId, first.publicationVersionId);
  assert.deepEqual(afterApplyOne.uiDraft, uiDraft);
  assert.equal(afterApplyOne.appliedRoute.routeGeometry, null);
  assert.equal(afterApplyOne.appliedRoute.etaSnapshot, null);
  assert.deepEqual(afterApplyOne.appliedRoute.routeStopPoints, []);
  assert.deepEqual(applyLiveRoutePublication(originalRoute, publicationOne), afterApplyOne.appliedRoute);
  assert.equal(afterApplyOne.appliedRoute.stops[6].totalPriceAmount, '122.25');
  assert.equal(afterApplyOne.appliedRoute.stops[6].normalizedPaymentStatus, 'CASH_COLLECT_REQUIRED');
  assert.equal(afterApplyOne.appliedRoute.stops[6].items[0].name, 'Synthetic groceries');
  mark('Explicit Apply uses exact immutable N; N+1 published during ACK keeps the banner and does not silently replace applied N');

  loseAck = true;
  await assert.rejects(() => applyLiveRouteChange(applyOptions()), /Synthetic lost ACK/);
  const lostAckState = await readState();
  assert.equal(lostAckState.appliedPublicationVersionId, second.publicationVersionId);
  assert.equal(lostAckState.ackPendingPublicationVersionId, second.publicationVersionId);
  assert.equal((await clients.liveRouteChangeService.getLiveRouteChange(identity)).pending, false);
  store = createLiveRouteChangeStore(durableStorage(join(temp, 'state')));
  const restarted = await readState();
  assert.deepEqual(restarted, lostAckState);
  const retried = await retryLiveRouteAcknowledgement({ store, accountOwnerHash, routePlanId: fixture.route.id, assignmentGeneration: generation, service: clients.liveRouteChangeService, isCurrent: () => true });
  assert.equal(retried.ackPendingPublicationVersionId, null);
  assert.equal(retried.appliedPublicationVersionId, second.publicationVersionId);
  assert.equal(hasPendingLiveRouteChange(retried), false);
  assert.equal(acknowledgements.at(-1).publicationVersionId, second.publicationVersionId);
  assert.equal(await store.read(accountOwnerHash, fixture.route.id, '3'), null);
  assert.equal(await store.read(createHash('sha256').update('other-account').digest('hex'), fixture.route.id, generation), null);
  mark('Lost ACK response retains durable applied snapshot and exact ACK identity; new store instance safely retries without cross-account or generation state');

  const originalEvent = (stopIndex, extra = {}) => ({
    clientEventId: randomUUID(), routePlanId: fixture.route.id, deliveryStopId: fixture.stops[stopIndex].id,
    eventType: 'STOP_ARRIVED', occurredAt: new Date(), assignmentGeneration: generation,
    expectedRouteVersionId: fixture.version.id, driverContractVersion: 2,
    appVersion: '1.3.4-local', versionCode: 40, payload: { source: 'synthetic-offline-before-publication' }, ...extra,
  });
  const flush = async (event, publicationVersionId, allow = true) => {
    const queue = createInMemoryOfflineSubmissionQueue({ accountOwnerHash });
    queue.enqueueDriverEvent(event);
    const original = structuredClone(queue.listPending()[0].event);
    const currentClients = makeClients(publicationVersionId);
    const result = await retryOfflineSubmissions({
      queue, routePlanId: fixture.route.id, driverEventService: currentClients.driverEventService,
      proofMediaUploadService: currentClients.proofMediaUploadService,
      orderedEventAccessIdentity: { routePlanId: fixture.route.id, assignmentGeneration: generation, driverContractVersion: 2, expectedRouteVersionId: publicationVersionId, allowPreviousPublicationStopEvents: allow },
    });
    return { queue, result, original };
  };
  const accepted = await flush(originalEvent(1, { eventType: 'STOP_DELIVERED' }), second.publicationVersionId);
  assert.equal(accepted.result.succeeded, 1);
  assert.equal(accepted.queue.listPending().length, 0);
  const persistedEvent = await prisma.driverEvent.findFirstOrThrow({ where: { clientEventId: accepted.original.clientEventId } });
  assert.equal(persistedEvent.expectedRouteVersionId, fixture.version.id);
  assert.equal(persistedEvent.assignmentGeneration.toString(), generation);
  assert.equal(persistedEvent.deliveryStopId, fixture.stops[1].id);
  const transmitted = sentEvents.find((event) => event.clientEventId === accepted.original.clientEventId);
  assert.equal(transmitted.expectedRouteVersionId, fixture.version.id);
  assert.equal(transmitted.assignmentGeneration, generation);
  assert.equal(transmitted.occurredAt, accepted.original.occurredAt.toISOString());
  assert.equal(transmitted.deliveryStopId, accepted.original.deliveryStopId);
  for (const [key, value] of Object.entries(accepted.original.payload)) assert.deepEqual(transmitted[key], value);
  mark('Actual offline queue submits unchanged stop 2 evidence with its original clientEventId, generation, publication and payload; server accepts it');

  const changed = await flush(originalEvent(6), second.publicationVersionId);
  assert.equal(changed.result.succeeded, 0);
  assert.ok(changed.result.blocked > 0, JSON.stringify({ result: changed.result, pending: changed.queue.listPending().map(item => ({ state: item.state, lastErrorCode: item.lastErrorCode, reconciliation: item.reconciliation })) }));
  assert.equal(changed.queue.listPending()[0].state, 'QUARANTINED');
  assert.equal(changed.queue.listPending()[0].event.expectedRouteVersionId, fixture.version.id);
  assert.equal(await prisma.driverEvent.count({ where: { clientEventId: changed.original.clientEventId } }), 0);
  assert.ok(sentEvents.some((event) => event.clientEventId === changed.original.clientEventId));
  mark('Changed stop 7 evidence reaches authoritative server validation and remains quarantined with its original identity after rejection');

  const third = await publish({ futureStopOrder: [fixture.stops[4], fixture.stops[3], fixture.stops[5], fixture.stops[6]].map((stop) => stop.id) });
  const reordered = await flush(originalEvent(3), third.publicationVersionId);
  assert.equal(reordered.result.succeeded, 0);
  assert.ok(reordered.result.blocked > 0);
  assert.ok(sentEvents.some((event) => event.clientEventId === reordered.original.clientEventId));
  assert.equal(await prisma.driverEvent.count({ where: { clientEventId: reordered.original.clientEventId } }), 0);
  mark('A reordered target rejects old-publication evidence through the same actual queue/API path');

  const countBeforeStrict = sentEvents.length;
  const strict = await flush(originalEvent(2), third.publicationVersionId, false);
  assert.ok(strict.result.blocked > 0);
  assert.equal(sentEvents.length, countBeforeStrict);
  const routeLevel = await flush(originalEvent(2, { eventType: 'ROUTE_COMPLETED', deliveryStopId: null }), third.publicationVersionId);
  assert.ok(routeLevel.result.blocked > 0);
  assert.equal(sentEvents.length, countBeforeStrict);
  const wrongGeneration = await flush(originalEvent(2, { assignmentGeneration: '1' }), third.publicationVersionId);
  assert.ok(wrongGeneration.result.blocked > 0);
  assert.equal(sentEvents.length, countBeforeStrict);
  await assert.rejects(() => clients.liveRouteChangeService.acknowledgeLiveRouteChange({ ...identity, publicationVersionId: third.publicationVersionId, assignmentGeneration: '1' }), (error) => error.status === 409);
  mark('Non-enrolled queue behavior, route-level evidence and wrong generations remain blocked; wrong-generation ACK is rejected by real HTTP server');

  const finalRoute = await getRoute();
  const executionMerge = mergeLiveRouteExecutionState(retried.appliedRoute, finalRoute);
  assert.equal(executionMerge.stops.find((stop) => stop.deliveryStopId === fixture.stops[1].id).status, 'DELIVERED');
  assert.deepEqual(executionMerge.stops.map((stop) => stop.deliveryStopId), retried.appliedRoute.stops.map((stop) => stop.deliveryStopId));
  assert.deepEqual(executionMerge.stops.map((stop) => stop.address), retried.appliedRoute.stops.map((stop) => stop.address));
  mark('Execution refresh advances delivered status while preserving applied addresses and order until the next explicit Apply');
  renderedRoute = executionMerge;
  const appliedThird = await applyLiveRouteChange(applyOptions());
  assert.equal(appliedThird.appliedPublicationVersionId, third.publicationVersionId);
  assert.equal(hasPendingLiveRouteChange(appliedThird), false);
  assert.deepEqual(appliedThird.appliedRoute.stops.map((stop) => stop.deliveryStopId), [0, 1, 2, 4, 3, 5, 6].map((index) => fixture.stops[index].id));
  assert.equal(appliedThird.appliedRoute.stops[1].status, 'DELIVERED');
  assert.deepEqual(appliedThird.uiDraft, uiDraft);
  assert.equal((await clients.liveRouteChangeService.getLiveRouteChange(identity)).pending, false);
  mark('Explicit Apply accepts the new future order and clears pending while preserving completion, proof drafts and monetary fields');

  const result = {
    verifiedAt: new Date().toISOString(), status: 'pass',
    serverSourceSha: run('git', ['rev-parse', 'HEAD'], { cwd: serverRoot }),
    shopifySourceSha: run('git', ['rev-parse', 'HEAD'], { cwd: shopifyRoot }),
    mobileBaseSha: run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    mobileSourceSha256: await sourceDigest(repoRoot, ['src']),
    environment: {
      database: 'temporary PostgreSQL 17 cluster, loopback only, PR486 Prisma migrations',
      transport: 'real Fastify HTTP, real Prisma repositories and locally signed synthetic route/account JWTs',
      office: 'actual PR328 Shopify BFF helpers with authenticated synthetic session',
      mobile: 'actual driver API clients, live-change controller/domain store and offline submission queue',
      persistence: 'production domain store using atomic temporary file adapter and store recreation',
      providers: 'disabled; no real push, geocoding, payment or store access',
    },
    checks,
    limitations: [
      'This run does not render React Native UI or replace physical-device acceptance.',
      'The file adapter proves domain-store restart behavior; native SQLCipher and SecureStore need device tests.',
      'Push delivery, background OS lifecycle, live Shopify authentication and provider routing are not exercised.',
    ],
    cleanup: 'Fastify, Prisma and temporary PostgreSQL are closed and temporary fixture/state files removed in finally',
  };
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, checks: checks.length, serverSourceSha: result.serverSourceSha, mobileSourceSha256: result.mobileSourceSha256, resultPath }));
} finally {
  try {
    const closed = await Promise.allSettled([app?.close(), prisma?.$disconnect()]);
    await unregister?.();
    const failed = closed.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  } finally {
    try {
      if (pgStarted) run(join(pgBin, 'pg_ctl'), ['-D', join(temp, 'pg'), '-m', 'immediate', '-w', 'stop']);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}

function jwt(shopDomain, clientId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ aud: clientId, dest: `https://${shopDomain}`, iss: `https://${shopDomain}/admin`, sub: "synthetic-office", exp: now + 300, nbf: now - 1 })).toString("base64url");
  return `${header}.${claims}.${createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url")}`;
}

async function seedFixture(database, appId, shopDomain) {
  // Mirrors PR486's seven-stop fixture: stop 1 completed, stop 2 arrived, stops 3–7 future.
  const now = new Date();
  const shop = await database.shop.create({ data: { appId, shopDomain } });
  const account = await database.driverAccount.create({ data: { phone: `synthetic-${randomUUID()}` } });
  const driver = await database.driver.create({ data: { accountId: account.id, authSubject: randomUUID(), displayName: "Synthetic Driver", shopId: shop.id } });
  const route = await database.routePlan.create({ data: { shopId: shop.id, driverId: driver.id, name: "Synthetic seven-stop route", planDate: now, constraints: { timezone: "America/Toronto" }, metrics: {}, optimizerVersion: "synthetic-local-integration", status: "IN_PROGRESS", assignmentGeneration: 2n } });
  const group = await database.routeGrouping.create({ data: { shopId: shop.id, name: "Synthetic group", planDate: now } });
  const parent = await database.routeGroupingVersion.create({ data: { shopId: shop.id, groupingId: group.id, version: 1 } });
  const version = await database.routeGroupingChildVersion.create({ data: { shopId: shop.id, groupingId: group.id, groupingVersionId: parent.id, routePlanId: route.id, driverId: driver.id, version: 1, snapshot: {}, publishedAt: now } });
  const stops = [];
  for (let index = 0; index < 7; index += 1) {
    const sourceOrderId = `gid://shopify/Order/synthetic-${index + 1}`;
    const order = await database.order.create({ data: { shopId: shop.id, name: `#synthetic-${index + 1}`, rawPayload: { shippingAddress: { address1: `${index + 1} Integration Road` }, source: "immutable-test-source", normalizedPaymentStatus: "CASH_COLLECT_REQUIRED", paymentMethodTitle: "Cash on delivery" }, totalPriceAmount: "122.25", currencyCode: "CAD", shopifyOrderGid: sourceOrderId, currentRouteVersionId: version.id } });
    await database.orderItem.create({ data: { shopId: shop.id, orderId: order.id, productId: index + 1, lineIndex: 0, name: "Synthetic groceries", quantity: 2, options: [], sku: "SYNTHETIC" } });
    const stop = await database.deliveryStop.create({ data: { shopId: shop.id, orderId: order.id, address1: `${index + 1} Integration Road`, city: "Synthetic City", province: "ON", postalCode: "N2G 1A1", countryCode: "CA", latitude: 43.4 + index / 100, longitude: -80.4 - index / 100, status: index === 0 ? "DELIVERED" : index === 1 ? "ARRIVED" : "ASSIGNED" } });
    await database.routePlanStop.create({ data: { shopId: shop.id, routePlanId: route.id, deliveryStopId: stop.id, sequence: index + 1, estimatedArrivalAt: new Date(now.getTime() + index * 60_000), durationFromPreviousSeconds: 60, distanceFromPreviousMeters: 1000, etaInputRouteVersionId: version.id, etaStatus: "READY", etaCalculatedAt: now, etaSource: "SYNTHETIC" } });
    stops.push(stop);
  }
  await database.routeGroupingChildVersion.update({ where: { id: version.id }, data: { snapshot: { membershipSchemaVersion: 1, stops: stops.map((stop, index) => ({ sequence: index + 1, deliveryStopId: stop.id, orderId: stop.orderId, sourceOrderId: `gid://shopify/Order/synthetic-${index + 1}`, address1: stop.address1, latitude: stop.latitude.toString(), longitude: stop.longitude.toString() })) } } });
  for (const [eventType, stopIndex] of [["ROUTE_STARTED", null], ["PICKUP_COMPLETED", null], ["STOP_DELIVERED", 0], ["STOP_ARRIVED", 1]]) {
    await database.driverEvent.create({ data: { shopId: shop.id, driverId: driver.id, routePlanId: route.id, routeVersionId: version.id, assignmentGeneration: 2n, expectedRouteVersionId: version.id, driverContractVersion: 2, clientEventId: randomUUID(), eventType, occurredAt: new Date(now.getTime() - 60_000), payload: { source: "synthetic-seed" }, ...(stopIndex === null ? {} : { deliveryStopId: stops[stopIndex].id }) } });
  }
  return { shop, account, driver, route, version, group, stops };
}
