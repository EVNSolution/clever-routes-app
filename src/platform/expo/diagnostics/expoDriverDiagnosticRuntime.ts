import { withNoStoreDriverApiRequest } from '../../../api/deliveryServer/driverApiRequestOptions';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { CONTINUOUS_LOCATION_TASK_NAME } from '../../../domain/location/continuousLocationStream';
import { createDiagnosticBindingPersistence } from '../../../app/diagnosticBindingPersistence';
import { finalizeDiagnosticLogoutCleanup, runBoundedDiagnosticRevocation } from '../../../app/diagnosticLogoutRevocation';
import { createDriverDiagnosticProjection } from '../../../app/driverDiagnosticProjection';
import { parseDriverDiagnosticResponse } from '../../../app/driverDiagnosticResponse';
import { runBoundedAsyncOperation } from '../../../domain/async/boundedAsyncOperation';
import type { DriverAccessRestoreResult } from '../../../domain/driver/driverAccessTokenStore';
import { equalDiagnosticContext, restoreDiagnosticBinding, type DiagnosticBinding as Binding } from '../../../app/diagnosticBindingRestore';
import { DRIVER_ACCESS_TOKEN_STORAGE_KEY } from '../../../domain/driver/driverAccessTokenStore';
import {
  captureDriverDiagnosticOperationObserverForOwner,
  emitDriverDiagnosticObservation,
  installDriverDiagnosticObserver,
  type DriverDiagnosticObservation,
  type DriverDiagnosticOperationObserver,
} from '../../../domain/diagnostics/driverDiagnosticObservation';
import { createDriverDiagnosticOutbox } from '../../../domain/diagnostics/driverDiagnosticOutbox';
import { createDriverDiagnosticRecorder, type DriverDiagnosticReportHandle } from '../../../domain/diagnostics/driverDiagnosticRecorder';
import { createDriverDiagnosticTransport } from '../../../domain/diagnostics/driverDiagnosticTransport';
import type { OfflineSubmissionQueue } from '../../../domain/offline/offlineSubmissionQueue';
import { getNetworkReachability } from '../../../domain/offline/offlineRetryTrigger';
import { readInstalledDriverAppVersion } from '../application/expoAppVersionService';
import { probeLocationDiagnosticStates } from '../location/locationDiagnosticOrchestration';
import { getExpoDriverSyncIdentity } from '../secureStore/expoDriverSyncIdentity';
import { getExpoDiagnosticStorage } from './expoDiagnosticStorage';
import { getExpoDiagnosticCredentialStore } from './expoDiagnosticCredentialStore';
import { createExpoDriverDiagnosticNetworkState } from './expoDriverDiagnosticNetworkState';
import {
  createDriverDiagnosticAmbientProbe,
  isDriverDiagnosticForegroundTransition,
} from './driverDiagnosticAmbientProbe';

const BINDING_KEY = 'clever.driverDiagnostics.binding.v1';
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
type Active = {
  binding: Binding;
  projection: ReturnType<typeof createDriverDiagnosticProjection>;
  recorder: ReturnType<typeof createDriverDiagnosticRecorder>;
  transport: ReturnType<typeof createDriverDiagnosticTransport>;
  outbox: ReturnType<typeof createDriverDiagnosticOutbox>;
};
let active: Active | null = null;
let started = false;
let accessRevision = 0;
let currentPhone: string | null = null;
let observerEnabled = false;
let early: DriverDiagnosticObservation[] = [];
const bindingPersistence = createDiagnosticBindingPersistence(value => value === null
  ? SecureStore.deleteItemAsync(BINDING_KEY, secureOptions)
  : SecureStore.setItemAsync(BINDING_KEY, value, secureOptions));
let accountBearer: { owner: string; token: string; expiresAt: string } | null = null;
let lastHeartbeat = 0;
let observedQueue: OfflineSubmissionQueue | null = null;
let probing = false;
let baseUrl: string | null = null;
let bootId: string | null = null;
let diagnosticSequence = 0;
let bindingReady: Promise<void> = Promise.resolve();
let suppressAccessUntilBusinessClear = false;
let revocationBarrier: Promise<void> | null = null;
const diagnosticNetworkState = createExpoDriverDiagnosticNetworkState();


function bounded<T>(operation: () => Promise<T>) { return runBoundedAsyncOperation(operation, { timeoutMs: 5000 }); }
function currentLifecycle() { return AppState.currentState === 'active' ? 'FOREGROUND' : AppState.currentState === 'background' ? 'BACKGROUND' : 'INACTIVE'; }
const ambientProbe = createDriverDiagnosticAmbientProbe({
  captureIdentity: () => active,
  getLifecycle: currentLifecycle,
  isCurrent: (identity) => active === identity,
  observe: (identity, patch) => {
    if (active !== identity) return;
    if (patch.network !== undefined) {
      diagnosticNetworkState.update(
        patch.network === 'ONLINE' ? 'online' : patch.network === 'OFFLINE' ? 'offline' : 'unknown',
      );
    }
    emitDriverDiagnosticObservation({ kind: 'STATE', patch });
  },
  readNetwork: () => bounded(async () => {
    const reachability = getNetworkReachability(await Network.getNetworkStateAsync());
    return reachability === 'online' ? 'ONLINE' : reachability === 'offline' ? 'OFFLINE' : 'UNKNOWN';
  }),
});
function persistBinding(binding: Binding | null) {
  void bounded(() => bindingPersistence.persist(binding === null ? null : JSON.stringify(binding))).catch(() => undefined);
}

function observe(event: DriverDiagnosticObservation) {
  const current = active;
  if (current === null) { early = [...early.slice(-99), event]; return; }
  if (event.kind === 'OPERATION' && event.routePlanId && current.binding.context.routePlanId !== event.routePlanId) return;
  refreshQueueProjection();
  const previousLifecycle = current.projection.snapshot().lifecycle;
  const changed = current.projection.observe(event);
  if (
    event.kind === 'STATE'
    && isDriverDiagnosticForegroundTransition(previousLifecycle, event.patch?.lifecycle)
  ) {
    current.recorder.notifyForeground();
    void probeLocation();
  }
  const failed = event.kind === 'OPERATION' ? event.phase === 'FAILED' || event.phase === 'WATCHDOG_TIMEOUT' : event.blocker !== undefined;
  if (failed) current.recorder.emitError({ blockers: [], identifiers: event.kind === 'OPERATION' ? { clientEventId: event.clientEventId, requestId: event.requestId } : undefined });
  else if (changed) current.recorder.emitStateChange();
  heartbeatIfDue();
}
function heartbeatIfDue(force = false) {
  if (!active || (!force && Date.now() - lastHeartbeat < 60000)) return;
  lastHeartbeat = Date.now();
  refreshQueueProjection();
  active.recorder.emitHeartbeat();
}
async function request(path: string, method: 'DELETE' | 'POST', token: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, withNoStoreDriverApiRequest({ method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }));
  if (!response.ok) throw Object.assign(new Error('DIAGNOSTIC_HTTP_ERROR'), { status: response.status });
  return response.json();
}
function bind(binding: Binding, preserveEarly: boolean) {
  if (!baseUrl || !bootId) return;
  const replaceObserver = active !== null || !observerEnabled;
  active?.transport.stop();
  active?.outbox.switchAccount('detached');
  const projection = createDriverDiagnosticProjection();
  projection.setLocationExpected(binding.locationExpected);
  const outbox = createDriverDiagnosticOutbox({
    accountOwnerHash: binding.accountOwnerHash,
    onStorageStateChange: state => {
      if (active?.outbox !== outbox) return;
      if (state.kind === 'FAILED') active.recorder.emitError({ blockers: [] });
      else active.recorder.emitStateChange();
    },
    storage: {
      read: async (owner) => (await getExpoDiagnosticStorage()).read(owner),
      append: async (owner, records) => (await getExpoDiagnosticStorage()).append(owner, records),
      quarantine: async (owner, entries) => (await getExpoDiagnosticStorage()).quarantine(owner, entries),
      remove: async (owner, ids) => (await getExpoDiagnosticStorage()).remove(owner, ids),
    },
  });
  const transport = createDriverDiagnosticTransport({
    outbox, batchIdFactory: () => Crypto.randomUUID(), deviceInstanceHash: binding.context.deviceInstanceHash,
    credentialStore: getExpoDiagnosticCredentialStore(),
    register: async ({ accountOwnerHash, deviceInstanceHash, signal }) => {
      if (revocationBarrier !== null) await revocationBarrier.catch(() => undefined);
      const bearer = accountBearer;
      if (!bearer || bearer.owner !== accountOwnerHash || Date.parse(bearer.expiresAt) <= Date.now()) throw new Error('AUTH_CREDENTIAL_MISSING');
      const result = await request('/driver/sync-health/registrations', 'POST', bearer.token, { schemaVersion: 1, deviceInstanceHash }, signal) as { token?: unknown; expiresAt?: unknown };
      if (typeof result?.token !== 'string' || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('INVALID_DIAGNOSTIC_CREDENTIAL');
      return { token: result.token, expiresAt: result.expiresAt };
    },
    send: async ({ credentialToken, envelope, signal }) => {
      const result = parseDriverDiagnosticResponse(
        await request('/driver/sync-health/diagnostics', 'POST', credentialToken, envelope, signal),
      );
      if (result === null) throw new Error('INVALID_DIAGNOSTIC_ACK');
      return result;
    },
  });
  const recorder = createDriverDiagnosticRecorder({ bootId, context: binding.context, outbox, transport, snapshot: projection.snapshot, idFactory: () => Crypto.randomUUID(), nextSequence: () => ++diagnosticSequence });
  active = { binding, projection, recorder, transport, outbox };
  if (replaceObserver) installDriverDiagnosticObserver(observe, { requestIdFactory: () => Crypto.randomUUID() });
  observerEnabled = true;
  const pending = preserveEarly ? early : [];
  early = [];
  pending.forEach(observe);
  emitDriverDiagnosticObservation({
    kind: 'STATE',
    patch: diagnosticNetworkState.bindingPatch(currentLifecycle()),
  });
  void ambientProbe.probe();
  void outbox.hydrate().then(() => { if (active?.outbox === outbox) heartbeatIfDue(true); });
  void probeLocation();
  heartbeatIfDue(true);
}

/** Starts independently of the account/route refresh and business evidence stores. */
export function startExpoDriverDiagnosticRuntime(): void {
  if (started || process.env.EXPO_PUBLIC_DRIVER_RUNTIME_MODE === 'mock' || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  const url = process.env.EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL?.replace(/\/$/u, '');
  if (!url?.startsWith('https://')) return;
  started = true; baseUrl = url; bootId = Crypto.randomUUID();
  installDriverDiagnosticObserver(observe, { requestIdFactory: () => Crypto.randomUUID() });
  observerEnabled = true;
  const revision = accessRevision;
  bindingReady = bounded(async () => {
    const [rawBinding, rawAccount] = await Promise.all([SecureStore.getItemAsync(BINDING_KEY, secureOptions), SecureStore.getItemAsync(DRIVER_ACCESS_TOKEN_STORAGE_KEY)]);
    return restoreDiagnosticBinding(rawBinding, rawAccount, phone => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `clever-driver-account:${phone}`));
  }).then(restored => {
    if (!restored || revision !== accessRevision || active) return;
    currentPhone = restored.phoneE164;
    const version = readInstalledDriverAppVersion();
    Object.assign(restored.binding.context, { appVersion: version?.versionName ?? 'unknown', versionCode: version?.versionCode ?? null, osVersion: String(Platform.Version) });
    bind(restored.binding, true);
  }).catch(() => undefined);
  AppState.addEventListener('change', () => { void ambientProbe.probe(); });
  setInterval(() => {
    if (AppState.currentState === 'active') {
      void ambientProbe.probe();
      heartbeatIfDue();
      void probeLocation();
    }
  }, 60000);
}

/** Tokens stay in memory/SecureStore adapters; they are never diagnostic event fields. */
export function observeExpoDriverDiagnosticAccess(access: DriverAccessRestoreResult): void {
  startExpoDriverDiagnosticRuntime();
  if (!started || suppressAccessUntilBusinessClear) return;
  const revision = ++accessRevision;
  if (access.kind !== 'active' && access.kind !== 'refresh_required') {
    accountBearer = null;
    if (active) emitDriverDiagnosticObservation({ kind: 'STATE', blocker: { stage: 'AUTH', reasonCode: 'AUTH_CREDENTIAL_MISSING' } });
    return;
  }
  const phone = access.driverProfile.phoneE164.trim();
  if (active && currentPhone !== phone) {
    active.transport.stop(); active.outbox.switchAccount('detached'); active = null; early = [];
    installDriverDiagnosticObserver(observe, { requestIdFactory: () => Crypto.randomUUID() });
    observerEnabled = true;
  } else if (!observerEnabled) {
    installDriverDiagnosticObserver(observe, { requestIdFactory: () => Crypto.randomUUID() }); observerEnabled = true;
  }
  currentPhone = phone;
  bindingReady = Promise.all([
    bounded(() => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `clever-driver-account:${access.driverProfile.phoneE164.trim()}`)),
    bounded(() => getExpoDriverSyncIdentity().getDeviceInstanceHash()),
  ]).then(([owner, deviceInstanceHash]) => {
    if (revision !== accessRevision) return;
    const version = readInstalledDriverAppVersion();
    accountBearer = { owner, token: access.accountAccess.accessToken, expiresAt: access.accountAccess.expiresAt };
    const route = access.activeRouteSession;
    const binding: Binding = {
      accountOwnerHash: owner, locationExpected: route?.status === 'active' && route.startedAt !== undefined, context: {
        appVersion: version?.versionName ?? 'unknown', versionCode: version?.versionCode ?? null, deviceInstanceHash, os: Platform.OS === 'ios' ? 'IOS' : 'ANDROID', osVersion: String(Platform.Version),
        routePlanId: route?.routePlanId ?? null, sessionGeneration: route?.startedAt ?? route?.updatedAt ?? null, ...(route && access.routeAccess?.assignmentGeneration ? { assignmentGeneration: access.routeAccess.assignmentGeneration } : {}),
      }
    };
    if (active?.binding.accountOwnerHash === owner && equalDiagnosticContext(active.binding.context, binding.context)) {
      const changed = active.binding.locationExpected !== binding.locationExpected;
      active.binding = binding;
      active.projection.setLocationExpected(binding.locationExpected);
      if (changed) { persistBinding(binding); active.recorder.emitStateChange(); }
    } else { bind(binding, active === null); persistBinding(binding); }
    if (Date.parse(access.accountAccess.expiresAt) > Date.now()) {
      emitDriverDiagnosticObservation({ kind: 'STATE', clearReasonCodes: ['AUTH_CREDENTIAL_MISSING'] });
      active?.recorder.notifyAuthenticated();
    }
  }).catch(() => undefined);
}
export function observeExpoDriverDiagnosticBusinessAccessCleared(): void {
  suppressAccessUntilBusinessClear = false;
  accessRevision += 1;
  accountBearer = null;
  if (active) {
    emitDriverDiagnosticObservation({ kind: 'STATE', blocker: { stage: 'AUTH', reasonCode: 'AUTH_CREDENTIAL_MISSING' } });
  }
}

export async function revokeExpoDriverDiagnosticRegistrationOnLogout(
  accountAccessToken: string | null,
): Promise<void> {
  suppressAccessUntilBusinessClear = true;
  const logoutRevision = ++accessRevision;
  early = [];
  currentPhone = null;
  observerEnabled = false;
  const detached = active;
  const owner = detached?.binding.accountOwnerHash ?? accountBearer?.owner ?? null;
  const credentialStore = getExpoDiagnosticCredentialStore();
  active = null;
  installDriverDiagnosticObserver(null, { requestIdFactory: () => Crypto.randomUUID() });
  const [deviceInstanceHash, credentialAtLogout] = await Promise.all([
    detached?.binding.context.deviceInstanceHash
      ? Promise.resolve(detached.binding.context.deviceInstanceHash)
      : bounded(() => getExpoDriverSyncIdentity().getDeviceInstanceHash()).catch(() => null),
    owner === null ? Promise.resolve(null) : bounded(() => credentialStore.get(owner)).catch(() => null),
  ]);
  if (detached !== null) {
    await runBoundedAsyncOperation(() => detached.recorder.flushBeforeDetach(), { timeoutMs: 5000 }).catch(() => undefined);
    detached.transport.stop();
    detached.outbox.switchAccount('detached');
  }
  accountBearer = null;

  if (baseUrl !== null && deviceInstanceHash !== null && accountAccessToken !== null && accountAccessToken.trim() !== '') {
    const previousRevocation = revocationBarrier;
    // Abort is best effort: the server may already have processed DELETE. Release
    // the barrier on timeout; a later registration recovers if that late DELETE won.
    const boundedRevocation = runBoundedDiagnosticRevocation({
      previous: previousRevocation,
      timeoutMs: 5000,
      revoke: async (signal) => {
        const result = await request(
          '/driver/sync-health/registrations',
          'DELETE',
          accountAccessToken.trim(),
          { schemaVersion: 1, deviceInstanceHash },
          signal,
        );
        const revokedCount = (result as { revokedCount?: unknown })?.revokedCount;
        if (!Number.isSafeInteger(revokedCount) || (revokedCount as number) < 0) throw new Error('INVALID_DIAGNOSTIC_REVOCATION');
      },
    });
    revocationBarrier = boundedRevocation;
    await boundedRevocation;
    if (revocationBarrier === boundedRevocation) revocationBarrier = null;
  }

  await finalizeDiagnosticLogoutCleanup({
    isCurrent: () => accessRevision === logoutRevision && active === null,
    removeCredential: () => owner !== null && credentialAtLogout !== null
      ? bounded(() => credentialStore.remove(owner, credentialAtLogout.token))
      : Promise.resolve(),
    clearBinding: () => persistBinding(null),
  });
}

export function clearExpoDriverDiagnosticAccount(): void {
  suppressAccessUntilBusinessClear = false;
  accessRevision++; accountBearer = null; early = []; currentPhone = null; observerEnabled = false;
  if (active) {
    const detached = active;
    const owner = detached.binding.accountOwnerHash;
    active = null;
    // Report the final auth failure with the cached write-only credential; business
    // logout does not await this bounded handoff. New-account observations are detached.
    void runBoundedAsyncOperation(() => detached.recorder.flushBeforeDetach(), { timeoutMs: 15000 })
      .catch(() => undefined).finally(() => {
        detached.transport.stop(); detached.outbox.switchAccount('detached');
        if (active?.binding.accountOwnerHash !== owner) void bounded(() => getExpoDiagnosticCredentialStore().remove(owner)).catch(() => undefined);
      });
  }
  installDriverDiagnosticObserver(null, { requestIdFactory: () => Crypto.randomUUID() });
  persistBinding(null);
}
export function updateExpoDriverDiagnosticQueue(queue: OfflineSubmissionQueue | null): void {
  observedQueue = queue;
  refreshQueueProjection(true);
}
function refreshQueueProjection(emit = false): void {
  const queue = observedQueue;
  if (!active || !queue || queue.getAccountOwnerHash() !== active.binding.accountOwnerHash) return;
  const pending = queue.listPending().filter(item => active?.binding.context.routePlanId === null || (item.kind === 'driver_event' ? item.event.routePlanId : item.request.routePlanId) === active?.binding.context.routePlanId);
  const previous = active.projection.snapshot().businessQueue;
  const value = { queueDepth: pending.length, oldestQueuedAt: pending.map(item => item.enqueuedAt).sort()[0] ?? null, retryCount: pending.reduce((sum, item) => sum + item.attempts, 0) };
  active.projection.setQueue({ ...value, nextRetryAt: previous.nextRetryAt });
  if (emit && (previous.queueDepth !== value.queueDepth || previous.retryCount !== value.retryCount || previous.oldestQueuedAt !== value.oldestQueuedAt)) active.recorder.emitStateChange();
}
export function updateExpoDriverDiagnosticNextRetry(at: string | null): void {
  if (active?.projection.setNextRetryAt(at)) active.recorder.emitStateChange();
}
export function updateExpoDriverDiagnosticNetwork(network: 'online' | 'offline' | 'unknown'): void {
  const normalizedNetwork = diagnosticNetworkState.update(network);
  startExpoDriverDiagnosticRuntime();
  emitDriverDiagnosticObservation({ kind: 'STATE', patch: { network: normalizedNetwork } });
  if (network === 'online') active?.recorder.notifyOnline();
}
export function captureExpoDriverDiagnosticOperationObserver(
  accountOwnerHash: string,
): DriverDiagnosticOperationObserver {
  return captureDriverDiagnosticOperationObserverForOwner(
    accountOwnerHash,
    active?.binding.accountOwnerHash ?? null,
  );
}

/** Reports only under a proven account binding; an unknown identity is never queued for a later login. */
export async function reportExpoDriverDiagnosticIssue(): Promise<DriverDiagnosticReportHandle | null> {
  startExpoDriverDiagnosticRuntime();
  const revision = accessRevision;
  if (active === null) {
    await bounded(() => bindingReady).catch(() => undefined);
  }
  const current = active;
  if (current === null || revision !== accessRevision) return null;
  refreshQueueProjection();
  return current.recorder.reportUserIssue();
}

async function probeLocation() {
  if (probing || !active) return;
  probing = true;
  const current = active;
  try {
    await probeLocationDiagnosticStates({
      emit: event => { if (current === active) emitDriverDiagnosticObservation(event); },
      getForegroundPermission: Location.getForegroundPermissionsAsync,
      getBackgroundPermission: Location.getBackgroundPermissionsAsync,
      getServicesEnabled: Location.hasServicesEnabledAsync,
      getTaskStarted: () => Location.hasStartedLocationUpdatesAsync(CONTINUOUS_LOCATION_TASK_NAME),
    });
  } catch { /* Missing probe evidence remains unknown/stale; no invented permission denial. */ }
  finally { probing = false; }
}
