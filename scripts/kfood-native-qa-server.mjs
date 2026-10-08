#!/usr/bin/env node
// Disposable native QA fixture. Reviewed product sources and real authentication stay unchanged.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [serverArg, shopifyArg, certificateArg, keyArg, evidenceArg, portArg = '8443', pgBin = '/opt/homebrew/opt/postgresql@17/bin'] = process.argv.slice(2);
if (!serverArg || !shopifyArg || !certificateArg || !keyArg || !evidenceArg) {
  throw new Error('Usage: node scripts/kfood-native-qa-server.mjs <server snapshot> <Shopify snapshot> <TLS certificate> <TLS key> <evidence.json> [HTTPS port] [PostgreSQL bin]');
}
const serverRoot = resolve(serverArg);
const shopifyRoot = resolve(shopifyArg);
const apiDir = join(serverRoot, 'apps/delivery-api');
const evidencePath = resolve(evidenceArg);
const httpsPort = Number(portArg);
assert.ok(Number.isInteger(httpsPort) && httpsPort > 0 && httpsPort <= 65535);
const expectedServerSha = '9bd6e7b8408508c83b1e4255a62c37ee9b983bf0';
const expectedShopifySha = 'e3f5a2a9819cb0ddd58766912b8ff31de2c759ae';
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C' };
const temp = await mkdtemp(join(tmpdir(), 'kfood-native-qa-'));
const proofStorageRoot = join(temp, 'synthetic-proof-media');
const controlToken = randomUUID();
const requests = [];
const requestAttempts = [];
const controls = [];
const extraFixtures = [];
let pgStarted = false;
let app;
let prisma;
let unregister;
let proxy;
let fixture;
let stopped = false;
let offline = false;
let proofStorageUnavailable = false;
let nextProofResponseHoldMs = 0;
let heldProofResponse = null;
let nextPublicationOnAck = null;
let lostAckResponses = 0;
let lostEventResponses = 0;
let lostEventType = null;
let adminRead;
let adminSave;
let adminDispatch;
let publicInfo;
let controlQueue = Promise.resolve();
let evidenceQueue = Promise.resolve();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: childEnv, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command.split('/').at(-1)} failed: ${result.error?.message ?? result.stderr.slice(-1500)}`);
  return result.stdout.trim();
}
async function unusedPort() {
  const listener = createTcpServer();
  await new Promise((accept, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', accept); });
  const port = listener.address().port;
  await new Promise((accept, reject) => listener.close((error) => error ? reject(error) : accept()));
  return port;
}
const source = (path) => import(pathToFileURL(join(apiDir, 'src', path)).href);
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const data = (result) => { assert.equal(result.error, null, json(result.error)); return result.data; };
function officeToken(shopDomain, clientId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ aud: clientId, dest: `https://${shopDomain}`, iss: `https://${shopDomain}/admin`, sub: 'synthetic-native-qa-office', exp: now + 300, nbf: now - 1 })).toString('base64url');
  return `${header}.${claims}.${createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url')}`;
}
function proofFilePath(storageKey) {
  const target = resolve(proofStorageRoot, ...storageKey.split('/'));
  assert.ok(target.startsWith(`${proofStorageRoot}${sep}`), 'Proof storage key must remain inside temporary synthetic storage');
  return target;
}
// The reviewed Prisma repository owns scope validation, reservations, hashes and commits.
// This provider-free backend writes actual bytes only inside this fixture's temporary directory.
const proofStorage = {
  async write({ storageKey, fileBytes }, signal) {
    if (proofStorageUnavailable) {
      const error = new Error('Synthetic local QA proof storage is deliberately unavailable');
      error.code = 'EROFS';
      throw error;
    }
    const target = proofFilePath(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, fileBytes, { flag: 'wx', signal });
  },
  async remove(storageKey) {
    try { await rm(proofFilePath(storageKey)); return 'removed'; }
    catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
  },
};
function evidence(reason) {
  const pending = evidenceQueue.then(() => writeEvidence(reason));
  evidenceQueue = pending.catch(() => undefined);
  return pending;
}
async function writeEvidence(reason) {
  if (!prisma || !fixture) return;
  const routeIds = [fixture.route.id, ...extraFixtures.map((item) => item.routePlanId)];
  const [route, state, publications, events, attempts, consents, proofMedia, runtimeDiagnostics] = await Promise.all([
    prisma.routePlan.findUnique({ where: { id: fixture.route.id }, select: { id: true, driverId: true, assignmentGeneration: true, status: true } }),
    prisma.routeLiveChangeState.findUnique({ where: { routePlanId: fixture.route.id } }),
    prisma.routeLiveChangePublication.findMany({ where: { routePlanId: fixture.route.id }, orderBy: { publishedAt: 'asc' } }),
    prisma.driverEvent.findMany({ where: { routePlanId: { in: routeIds } }, orderBy: { createdAt: 'asc' } }),
    prisma.driverEventAttempt.findMany({ where: { routePlanId: { in: routeIds } }, orderBy: { createdAt: 'asc' } }),
    prisma.driverConsentRecord.findMany({ where: { routeContext: { in: routeIds } } }),
    prisma.driverProofMedia.findMany({ where: { routePlanId: { in: routeIds } }, orderBy: { uploadedAt: 'asc' } }),
    prisma.driverRuntimeDiagnosticRecord.findMany({ where: { routePlanId: { in: routeIds } }, orderBy: { observedAt: 'asc' }, select: { diagnosticId: true, routePlanId: true, bootId: true, sequence: true, kind: true, observedAt: true, receivedAt: true, context: true, snapshot: true } }),
  ]);
  const localProofFiles = await Promise.all(proofMedia.filter((media) => media.uploadStatus === 'READY' && media.deletedAt === null).map(async (media) => {
    try {
      const bytes = await readFile(proofFilePath(media.storageKey));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return { mediaId: media.id, storageKey: media.storageKey, sizeBytes: bytes.length, sha256, matchesCommittedHash: sha256 === media.sha256 };
    } catch (error) { if (error.code === 'ENOENT') return { mediaId: media.id, missing: true }; throw error; }
  }));
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${json({ recordedAt: new Date().toISOString(), reason, environment: publicInfo, extraFixtures, route, state, publications, events, attempts, consents, proofMedia, localProofFiles, runtimeDiagnostics, requestAttempts, requests, controls, limits: ['Synthetic local office session; no live Shopify authentication.', 'Proof bytes use temporary local synthetic storage; cloud storage and physical camera provider are not exercised.', 'No real push; this fixture alone does not establish GPS hardware or OS background behavior.', 'Reassignment control changes only synthetic fixture database rows.'], cleanup: stopped ? 'Shutdown requested; cleanup in progress' : 'Running isolated fixture' })}\n`);
}
async function close() {
  if (stopped) return;
  stopped = true;
  nextProofResponseHoldMs = 0;
  heldProofResponse?.release('shutdown');
  try {
    await evidence('shutdown');
    if (proxy) await new Promise((accept) => { proxy.close(accept); proxy.closeAllConnections(); });
    await evidenceQueue;
    const closed = await Promise.allSettled([app?.close(), prisma?.$disconnect()]);
    await unregister?.();
    const failure = closed.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  } finally {
    try { if (pgStarted) run(join(pgBin, 'pg_ctl'), ['-D', join(temp, 'pg'), '-m', 'immediate', '-w', 'stop']); }
    finally { await rm(temp, { recursive: true, force: true }); }
  }
  if (fixture) {
    const finalEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    finalEvidence.cleanup = 'HTTPS/Fastify/Prisma closed; temporary PostgreSQL and local synthetic proof files stopped/removed';
    await writeFile(evidencePath, `${json(finalEvidence)}\n`);
  }
}
async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 12 * 1024 * 1024) throw new Error('QA request exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(json(value));
}
function readAttemptedLocationEvent(body) {
  let input;
  try { input = JSON.parse(body.toString('utf8')); } catch { return null; }
  if (!input || Array.isArray(input) || input.eventType !== 'LOCATION_UPDATED') return null;
  const fields = ['clientEventId', 'eventType', 'occurredAt', 'routePlanId', 'assignmentGeneration', 'expectedRouteVersionId'];
  return Object.fromEntries(fields.filter((field) => typeof input[field] === 'string' && input[field].length <= 160)
    .map((field) => [field, input[field]]));
}
async function holdProofResponse(attempt, durationMs) {
  let release;
  const waiting = new Promise((accept) => {
    const timer = setTimeout(() => release('timeout'), durationMs);
    release = (reason) => {
      if (heldProofResponse?.attempt !== attempt) return false;
      clearTimeout(timer);
      Object.assign(attempt, { proofResponseReleasedAt: new Date().toISOString(), proofResponseReleaseReason: reason });
      heldProofResponse = null;
      accept();
      return true;
    };
    Object.assign(attempt, { proofResponseHeldAt: new Date().toISOString(), proofResponseHoldTimeoutMs: durationMs });
    heldProofResponse = { attempt, release };
  });
  try { await evidence('proof-response-held'); await waiting; }
  finally { release('response-handler-ended'); }
}
async function control(command) {
  assert.ok(command && typeof command === 'object' && !Array.isArray(command));
  let result;
  switch (command.action) {
    case 'status': result = { ...publicInfo, extraFixtures, offline, proofStorageUnavailable, nextProofResponseHoldMs,
      heldProofResponse: heldProofResponse === null ? null : { heldAt: heldProofResponse.attempt.proofResponseHeldAt, timeoutMs: heldProofResponse.attempt.proofResponseHoldTimeoutMs,
        status: heldProofResponse.attempt.status, proofCommit: heldProofResponse.attempt.proofCommit },
      nextPublicationOnAck, lostAckResponses, lostEventResponses, office: await adminRead() }; break;
    case 'save': result = await adminSave(command); break;
    case 'dispatch': result = await adminDispatch(); break;
    case 'publish': await adminSave(command); result = await adminDispatch(); break;
    case 'arm-next-publication-on-ack': nextPublicationOnAck = { address: command.address ?? '700 Next Synthetic Avenue', reorder: Boolean(command.reorder) }; result = { armed: true }; break;
    case 'lose-next-ack-response': lostAckResponses = 1; result = { armed: true }; break;
    case 'lose-next-event-response':
      assert.ok(command.eventType === undefined || ['STOP_ARRIVED', 'STOP_DELIVERED', 'LOCATION_UPDATED'].includes(command.eventType));
      lostEventResponses = 1; lostEventType = command.eventType ?? null;
      result = { armed: true, eventType: lostEventType }; break;
    case 'offline': offline = command.enabled !== false; result = { offline }; break;
    case 'proof-storage-unavailable': proofStorageUnavailable = command.enabled !== false; result = { proofStorageUnavailable }; break;
    case 'hold-next-proof-response': {
      assert.equal(heldProofResponse, null, 'A synthetic proof response is already held');
      assert.equal(nextProofResponseHoldMs, 0, 'The next synthetic proof response is already armed');
      const durationMs = command.durationMs ?? 30_000;
      assert.ok(Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= 30_000);
      nextProofResponseHoldMs = durationMs;
      result = { armed: true, durationMs: nextProofResponseHoldMs, onlyStatus: 201, requiresReadyLocalFile: true }; break;
    }
    case 'release-proof-response': {
      const canceledArmedResponse = nextProofResponseHoldMs > 0;
      nextProofResponseHoldMs = 0;
      result = { released: heldProofResponse?.release('control') ?? false, canceledArmedResponse }; break;
    }
    case 'set-route-status': {
      assert.ok(['READY', 'IN_PROGRESS'].includes(command.status));
      const routePlanId = command.routePlanId ?? fixture.route.id;
      assert.ok([fixture.route.id, ...extraFixtures.map((item) => item.routePlanId)].includes(routePlanId));
      result = await prisma.routePlan.update({ where: { id: routePlanId }, data: { status: command.status }, select: { id: true, status: true } });
      break;
    }
    case 'add-ready-route':
    case 'add-dsv-route': {
      const isDsv = command.action === 'add-dsv-route';
      const kind = isDsv ? 'dsv' : 'ready';
      result = extraFixtures.find((item) => item.kind === kind);
      if (!result) {
        const phone = isDsv ? '+15195550104' : '+15195550103';
        const pin = isDsv ? '223344' : '112233';
        const extra = await seedFixture(prisma, isDsv ? 'clever' : fixture.shop.appId, isDsv ? 'dsv-demo.local' : fixture.shop.shopDomain, { credentials: [[3, phone, pin]], status: 'READY', name: `Synthetic ${kind.toUpperCase()} QA route`, dsv: isDsv });
        result = { kind, routePlanId: extra.route.id, baselineVersionId: extra.version.id, shopDomain: extra.shop.shopDomain, credentials: { phone, pin }, stopIds: extra.stops.map((stop) => stop.id), executionStatus: 'READY' };
        extraFixtures.push(result);
      }
      break;
    }
    case 'reassign': {
      const target = command.account === 'first' ? fixture.driver : fixture.secondDriver;
      await prisma.$transaction(async (tx) => {
        const route = await tx.routePlan.update({ where: { id: fixture.route.id }, data: { driverId: target.id, assignmentGeneration: { increment: 1 } } });
        await tx.routeGroupingChildVersion.update({ where: { id: fixture.version.id }, data: { driverId: target.id } });
        result = { routePlanId: route.id, driverId: target.id, assignmentGeneration: route.assignmentGeneration.toString() };
      });
      break;
    }
    case 'evidence': result = { evidencePath }; break;
    case 'shutdown': result = { shuttingDown: true }; break;
    default: throw new Error('Unknown local QA control action');
  }
  controls.push({ at: new Date().toISOString(), command, result });
  await evidence(command.action);
  return result;
}

try {
  for (const root of [serverRoot, shopifyRoot]) {
    assert.equal(resolve(run('git', ['rev-parse', '--show-toplevel'], { cwd: root })), root, 'Supply the exact fixture repository root');
    assert.equal(run('git', ['status', '--porcelain'], { cwd: root }), '', 'Reviewed fixture sources must be clean');
  }
  assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: serverRoot }), expectedServerSha);
  assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: shopifyRoot }), expectedShopifySha);
  const pgPort = await unusedPort();
  run(join(pgBin, 'initdb'), ['-D', join(temp, 'pg'), '--auth-local=trust', '--auth-host=trust', '--no-locale', '-E', 'UTF8']);
  run(join(pgBin, 'pg_ctl'), ['-D', join(temp, 'pg'), '-l', join(temp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${temp} -c max_connections=16 -c shared_buffers=32MB`, '-w', 'start']);
  pgStarted = true;
  run(join(pgBin, 'createdb'), ['-h', '127.0.0.1', '-p', String(pgPort), 'kfood_native_qa']);
  const databaseUrl = `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${pgPort}/kfood_native_qa?schema=public`;
  run(process.execPath, [join(apiDir, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(apiDir, 'prisma/schema.prisma')], { cwd: temp, env: { ...childEnv, DATABASE_URL: databaseUrl } });
  const { register } = await import(pathToFileURL(join(apiDir, 'node_modules/tsx/dist/esm/api/index.mjs')).href);
  unregister = register({ tsconfig: join(apiDir, 'tsconfig.json') });
  const { PrismaClient } = await import(pathToFileURL(join(apiDir, 'node_modules/@prisma/client/default.js')).href);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const { buildApp } = await source('app.ts');
  const { PrismaLiveRouteChangeService } = await source('modules/route-plans/live-route-change.service.ts');
  const { PrismaRoutePlanRepository } = await source('modules/route-plans/route-plan.repository.ts');
  const { RoutePlanAdminService } = await source('modules/route-plans/route-plan.service.ts');
  const { ShopifySessionTokenVerifier } = await source('modules/shopify/session-token-verifier.ts');
  const { PrismaDriverAuthRepository } = await source('modules/driver/driver-auth.repository.ts');
  const { PrismaDriverConsentRepository } = await source('modules/driver/driver-consent.repository.ts');
  const { PrismaDriverRouteAccessRepository } = await source('modules/driver/driver-route-access.repository.ts');
  const { PrismaDriverEventRepository } = await source('modules/driver/driver-event.repository.ts');
  const { PrismaDriverAssignedRouteRepository } = await source('modules/driver/driver-assigned-route.repository.ts');
  const { PrismaDriverTokenAccessRepository } = await source('modules/driver/driver-token-access.repository.ts');
  const { PrismaDriverRouteSessionRepository } = await source('modules/driver/driver-route-session.repository.ts');
  const { PrismaDriverEventReceiptRepository } = await source('modules/driver/driver-event-receipt.repository.ts');
  const { PrismaDriverSyncHealthService } = await source('modules/driver/driver-sync-health.service.ts');
  const { PrismaDriverRuntimeDiagnosticsRepository } = await source('modules/driver/driver-runtime-diagnostics.repository.ts');
  const { PrismaCompletionAssistanceService } = await source('modules/driver/completion-assistance.service.ts');
  const { PrismaDriverProofMediaRepository } = await source('modules/driver/driver-proof-media.repository.ts');
  const { KFOOD_DELIVERY_APP_ID: appId, KFOOD_DELIVERY_SHOP_DOMAIN: shopDomain } = await source('modules/route-plans/kfood-delivery-completion.ts');
  fixture = await seedFixture(prisma, appId, shopDomain);
  const clientId = 'synthetic-native-qa-shopify-client';
  const clientSecret = randomUUID();
  const driverSecret = randomUUID();
  const assignedRoute = new PrismaDriverAssignedRouteRepository(prisma);
  const liveService = new PrismaLiveRouteChangeService(prisma);
  const accessRepository = new PrismaDriverTokenAccessRepository(prisma);
  app = await buildApp({
    adminRoutePlans: { liveRouteChangeService: liveService, routePlanService: new RoutePlanAdminService(new PrismaRoutePlanRepository(prisma)), sessionTokenVerifier: new ShopifySessionTokenVerifier({ appId, clientId, clientSecret }) },
    driverAuth: { driverAuthRepository: new PrismaDriverAuthRepository(prisma), driverTokenAccessRepository: accessRepository, diagnosticsService: new PrismaDriverRuntimeDiagnosticsRepository(prisma), jwtSecret: driverSecret },
    driverApi: { driverAssignedRouteService: assignedRoute, driverConsentService: new PrismaDriverConsentRepository(prisma), routeAccessService: new PrismaDriverRouteAccessRepository(prisma), driverRouteSessionRestoreService: new PrismaDriverRouteSessionRepository(prisma, assignedRoute), driverEventReceiptService: new PrismaDriverEventReceiptRepository(prisma), driverSyncHealthService: new PrismaDriverSyncHealthService(prisma), driverEventService: new PrismaDriverEventRepository(prisma), driverTokenAccessRepository: accessRepository, liveRouteChangeService: liveService, completionAssistanceService: new PrismaCompletionAssistanceService(prisma, { env: {} }), proofMediaService: new PrismaDriverProofMediaRepository(prisma, { storage: proofStorage, reservationWritesEnabled: true }), jwtSecret: driverSecret },
  });
  const apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  process.env.CLEVER_APP_ID = appId;
  process.env.CLEVER_KFOOD_LIVE_CHANGE_ENABLED = 'true';
  process.env.CLEVER_DELIVERY_API_URL = apiUrl;
  const { fetchKfoodLiveChange, getKfoodLiveChangeContext, runKfoodLiveChangeCommand } = await import(pathToFileURL(join(shopifyRoot, 'apps/shopify-app/app/features/delivery/live-change.server.js')).href);
  const session = { shop: shopDomain, id: `offline_${shopDomain}` };
  const request = () => new Request(`http://127.0.0.1/app/routes/${fixture.route.id}`, { headers: { authorization: `Bearer ${officeToken(shopDomain, clientId, clientSecret)}` } });
  const adminOptions = { session, scopeKey: getKfoodLiveChangeContext(session).liveChangeScopeKey, routePlanId: fixture.route.id, routeGroupId: fixture.group.id, fetch: (url, init) => { assert.equal(new URL(url).origin, apiUrl); return fetch(url, init); } };
  adminRead = async () => data(await fetchKfoodLiveChange(request(), fixture.route.id, adminOptions));
  const command = (draft, extra = {}) => ({ commandId: randomUUID(), expectedAssignmentGeneration: draft.assignmentGeneration, expectedRouteVersionId: draft.expectedRouteVersionId, expectedRevision: draft.revision, ...extra });
  adminSave = async ({ address = '700 First Synthetic Avenue', reorder = false } = {}) => {
    assert.equal(typeof address, 'string');
    assert.ok(address.length > 0 && address.length < 120);
    return data(await runKfoodLiveChangeCommand(request(), fixture.route.id, 'liveChangeSave', json(command(await adminRead(), { stopOverrides: [{ deliveryStopId: fixture.stops[6].id, address1: address, latitude: 43.57, longitude: -80.57 }], ...(reorder ? { futureStopOrder: [2, 6, 3, 4, 5].map((index) => fixture.stops[index].id) } : {}) })), adminOptions));
  };
  adminDispatch = async () => data(await runKfoodLiveChangeCommand(request(), fixture.route.id, 'liveChangeDispatch', json(command(await adminRead())), adminOptions));
  publicInfo = { serverSourceSha: expectedServerSha, shopifySourceSha: expectedShopifySha, sourceSnapshots: { server: serverRoot, shopify: shopifyRoot }, baseUrl: `https://localhost:${httpsPort}`, transport: 'Loopback TLS proxy → real Fastify HTTP → isolated PostgreSQL', routePlanId: fixture.route.id, baselineVersionId: fixture.version.id, assignmentGeneration: '2', stopIds: fixture.stops.map((stop) => stop.id), credentials: [{ account: 'first', phone: '+15195550101', pin: '246810' }, { account: 'second', phone: '+15195550102', pin: '135790' }], proofStorage: 'Actual reviewed Prisma proof service with temporary local synthetic filesystem storage; no cloud provider or remote read access', providers: 'No external provider dependencies, notification workers or production environment files loaded' };
  proxy = createHttpsServer({ cert: await readFile(resolve(certificateArg)), key: await readFile(resolve(keyArg)) }, async (incoming, outgoing) => {
    let attempt;
    try {
      const path = new URL(incoming.url, publicInfo.baseUrl).pathname;
      const body = await readBody(incoming);
      if (path === '/qa-map-style.json' && incoming.method === 'GET') {
        return sendJson(outgoing, 200, { version: 8, sources: {}, layers: [{ id: 'qa-background', type: 'background', paint: { 'background-color': '#eef2f3' } }] });
      }
      if (path.startsWith('/__qa/')) {
        if (incoming.headers.authorization !== `Bearer ${controlToken}`) return sendJson(outgoing, 403, { error: 'Local QA control credential required' });
        if (path !== '/__qa/control' || incoming.method !== 'POST') return sendJson(outgoing, 404, { error: 'Unknown QA endpoint' });
        const payload = JSON.parse(body.toString('utf8'));
        const pending = controlQueue.then(() => control(payload));
        controlQueue = pending.catch(() => undefined);
        sendJson(outgoing, 200, await pending);
        if (payload.action === 'shutdown') setImmediate(() => close().then(() => process.exit(0)));
        return;
      }
      if (!path.startsWith('/driver/') && !path.startsWith('/api/driver/') && path !== '/health') return sendJson(outgoing, 404, { error: 'Only native driver QA APIs are exposed' });
      const proofIdempotencyKey = path === '/driver/proof-media' ? incoming.headers['idempotency-key'] : undefined;
      const locationEvent = path === '/driver/events' && incoming.method === 'POST'
        && incoming.headers['content-type']?.includes('application/json') ? readAttemptedLocationEvent(body) : null;
      // Count before fault injection. Retain only the GPS identity whitelist; never authentication or raw bodies.
      attempt = { startedAt: new Date().toISOString(), method: incoming.method, path, status: null, category: 'received',
        ...(locationEvent === null ? {} : { locationEvent }),
        ...(typeof proofIdempotencyKey === 'string' && /^proof-media-v1:[0-9a-f]{32}$/u.test(proofIdempotencyKey) ? { proofIdempotencyKey } : {}) };
      requestAttempts.push(attempt);
      if (offline) {
        Object.assign(attempt, { completedAt: new Date().toISOString(), category: 'offline_transport_rejected' });
        return outgoing.destroy();
      }
      let input = null;
      if (incoming.headers['content-type']?.includes('application/json') && body.length) input = JSON.parse(body.toString('utf8'));
      if (path.endsWith('/live-change/applied') && nextPublicationOnAck) {
        const next = nextPublicationOnAck;
        nextPublicationOnAck = null;
        await control({ action: 'publish', ...next });
      }
      const headers = { ...incoming.headers };
      delete headers.host;
      delete headers.connection;
      delete headers['transfer-encoding'];
      Object.assign(attempt, { forwardedAt: new Date().toISOString(), category: 'forwarding' });
      const response = await fetch(`${apiUrl}${incoming.url}`, { method: incoming.method, headers, ...(body.length ? { body } : {}) });
      const bytes = Buffer.from(await response.arrayBuffer());
      Object.assign(attempt, { completedAt: new Date().toISOString(), status: response.status, category: 'server_response' });
      let result;
      try { result = JSON.parse(bytes.toString('utf8')); } catch { result = null; }
      if (path === '/driver/proof-media' && incoming.method === 'POST' && response.status === 201 && nextProofResponseHoldMs > 0) {
        let proofCommit = null;
        try {
          const media = typeof result?.data?.mediaId === 'string'
            ? await prisma.driverProofMedia.findUnique({ where: { id: result.data.mediaId }, select: { id: true, uploadStatus: true, deletedAt: true, storageKey: true, sizeBytes: true, sha256: true } }) : null;
          if (media?.uploadStatus === 'READY' && media.deletedAt === null) {
            const savedBytes = await readFile(proofFilePath(media.storageKey));
            const sha256 = createHash('sha256').update(savedBytes).digest('hex');
            if (savedBytes.length === media.sizeBytes && sha256 === media.sha256) {
              proofCommit = { mediaId: media.id, uploadStatus: 'READY', sizeBytes: savedBytes.length, sha256, localFileVerified: true };
            }
          }
        } catch { /* A failed observation must not change the actual server response or consume the armed hold. */ }
        attempt.proofCommitVerified = proofCommit !== null;
        if (proofCommit !== null) {
          attempt.proofCommit = proofCommit;
          const durationMs = nextProofResponseHoldMs;
          nextProofResponseHoldMs = 0;
          await holdProofResponse(attempt, durationMs);
        }
      }
      const trackedInput = (path === '/driver/events' || path.endsWith('/live-change/applied')) ? input : null;
      requests.push({ at: new Date().toISOString(), method: incoming.method, path: incoming.url, status: response.status, ...(trackedInput ? { input: trackedInput, result } : { errorCode: result?.error?.code ?? null }) });
      const loseAckResponse = path.endsWith('/live-change/applied') && response.ok && lostAckResponses > 0;
      const loseEventResponse = path === '/driver/events' && response.ok && lostEventResponses > 0
        && (lostEventType === null || input?.eventType === lostEventType);
      if (loseAckResponse) lostAckResponses -= 1;
      if (loseEventResponse) lostEventResponses -= 1;
      const loseResponse = loseAckResponse || loseEventResponse;
      if (loseResponse) {
        attempt.category = 'post_commit_response_lost';
        requests.at(-1).responseIntentionallyLostAfterCommit = true;
        await evidence('committed-response-lost');
        return outgoing.destroy();
      }
      outgoing.writeHead(response.status, Object.fromEntries([...response.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name))));
      outgoing.end(bytes);
      attempt.deliveredAt = new Date().toISOString();
      if (trackedInput || path === '/driver/proof-media') await evidence('driver-write');
    } catch (error) {
      if (attempt && (attempt.category === 'received' || attempt.category === 'forwarding')) {
        Object.assign(attempt, { completedAt: new Date().toISOString(), status: 500, category: 'fixture_transport_error' });
      }
      if (!outgoing.headersSent) sendJson(outgoing, 500, { error: error.message });
      else outgoing.destroy(error);
    }
  });
  await new Promise((accept, reject) => { proxy.once('error', reject); proxy.listen(httpsPort, '127.0.0.1', accept); });
  await evidence('ready');
  const ready = { ready: true, ...publicInfo, controlEndpoint: `${publicInfo.baseUrl}/__qa/control`, controlToken, evidencePath };
  await writeFile(`${evidencePath}.ready.json`, `${json(ready)}\n`);
  console.log(json(ready));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); }));
} catch (error) {
  await close();
  throw error;
}

async function seedFixture(database, appId, shopDomain, options = {}) {
  const now = new Date();
  const shop = await database.shop.findFirst({ where: { appId, shopDomain } }) ?? await database.shop.create({ data: { appId, shopDomain } });
  const accounts = [];
  const drivers = [];
  for (const [index, phone, pin] of options.credentials ?? [[1, '+15195550101', '246810'], [2, '+15195550102', '135790']]) {
    const pinSalt = randomUUID();
    const account = await database.driverAccount.create({ data: { phone, name: `Synthetic QA Driver ${index}`, pinSalt, pinHash: scryptSync(pin, pinSalt, 64).toString('base64url') } });
    accounts.push(account);
    drivers.push(await database.driver.create({ data: { accountId: account.id, phone, authSubject: randomUUID(), displayName: `Synthetic QA Driver ${index}`, shopId: shop.id } }));
  }
  const status = options.status ?? 'IN_PROGRESS';
  const route = await database.routePlan.create({ data: { shopId: shop.id, driverId: drivers[0].id, name: options.name ?? 'Synthetic seven-stop QA route', planDate: now, constraints: { timezone: options.dsv ? 'Asia/Seoul' : 'America/Toronto' }, metrics: {}, optimizerVersion: 'synthetic-native-qa', status, assignmentGeneration: 2n } });
  const group = await database.routeGrouping.create({ data: { shopId: shop.id, name: 'Synthetic QA group', planDate: now } });
  const parent = await database.routeGroupingVersion.create({ data: { shopId: shop.id, groupingId: group.id, version: 1 } });
  const version = await database.routeGroupingChildVersion.create({ data: { shopId: shop.id, groupingId: group.id, groupingVersionId: parent.id, routePlanId: route.id, driverId: drivers[0].id, version: 1, snapshot: {}, publishedAt: now } });
  const stops = [];
  for (let index = 0; index < 7; index += 1) {
    const sourceOrderId = `gid://shopify/Order/synthetic-${index + 1}`;
    const destination = options.dsv ? await database.deliveryCustomerProfile.create({ data: { shopId: shop.id, addressFingerprint: `synthetic-qa-${randomUUID()}`, canonicalName: `Synthetic DSV destination ${index + 1}`, normalizedAddress: { address1: `${index + 1} Integration Road` } } }) : null;
    const order = await database.order.create({ data: { shopId: shop.id, name: `#synthetic-${index + 1}`, rawPayload: { shippingAddress: { address1: `${index + 1} Integration Road` }, source: 'immutable-test-source', normalizedPaymentStatus: 'CASH_COLLECT_REQUIRED', paymentMethodTitle: 'Cash on delivery', ...(destination ? { dsv: { normalized: { destinationId: destination.id, sellerOrderKey: `synthetic-dsv-${index + 1}`, shippedBoxes: 2 } } } : {}) }, totalPriceAmount: '122.25', currencyCode: 'CAD', shopifyOrderGid: `${sourceOrderId}-${route.id}`, currentRouteVersionId: version.id, ...(destination ? { destinationId: destination.id, sellerOrderSourceKind: 'DSV', sellerOrderKey: `synthetic-dsv-${index + 1}`, serviceDate: now } : {}) } });
    await database.orderItem.create({ data: { shopId: shop.id, orderId: order.id, productId: index + 1, lineIndex: 0, name: 'Synthetic groceries', quantity: 2, options: [], sku: 'SYNTHETIC' } });
    const stop = await database.deliveryStop.create({ data: { shopId: shop.id, orderId: order.id, address1: `${index + 1} Integration Road`, city: 'Synthetic City', province: 'ON', postalCode: 'N2G 1A1', countryCode: 'CA', latitude: 43.4 + index / 100, longitude: -80.4 - index / 100, status: status === 'IN_PROGRESS' ? (index === 0 ? 'DELIVERED' : index === 1 ? 'ARRIVED' : 'ASSIGNED') : 'ASSIGNED' } });
    await database.routePlanStop.create({ data: { shopId: shop.id, routePlanId: route.id, deliveryStopId: stop.id, sequence: index + 1, estimatedArrivalAt: new Date(now.getTime() + index * 60_000), durationFromPreviousSeconds: 60, distanceFromPreviousMeters: 1000, etaInputRouteVersionId: version.id, etaStatus: 'READY', etaCalculatedAt: now, etaSource: 'SYNTHETIC' } });
    stops.push(stop);
  }
  await database.routeGroupingChildVersion.update({ where: { id: version.id }, data: { snapshot: { membershipSchemaVersion: 1, stops: stops.map((stop, index) => ({ sequence: index + 1, deliveryStopId: stop.id, orderId: stop.orderId, sourceOrderId: `gid://shopify/Order/synthetic-${index + 1}-${route.id}`, address1: stop.address1, latitude: stop.latitude.toString(), longitude: stop.longitude.toString() })) } } });
  for (const [eventType, stopIndex] of status === 'IN_PROGRESS' ? [['ROUTE_STARTED', null], ['PICKUP_COMPLETED', null], ['STOP_DELIVERED', 0], ['STOP_ARRIVED', 1]] : []) {
    await database.driverEvent.create({ data: { shopId: shop.id, driverId: drivers[0].id, routePlanId: route.id, routeVersionId: version.id, assignmentGeneration: 2n, expectedRouteVersionId: version.id, driverContractVersion: 2, clientEventId: randomUUID(), eventType, occurredAt: new Date(now.getTime() - 60_000), payload: { source: 'synthetic-seed' }, ...(stopIndex === null ? {} : { deliveryStopId: stops[stopIndex].id }) } });
  }
  return { shop, account: accounts[0], secondAccount: accounts[1], driver: drivers[0], secondDriver: drivers[1], route, version, group, stops };
}
