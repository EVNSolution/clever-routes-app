import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDriverDiagnosticProjection } from '../../../app/driverDiagnosticProjection';
import {
  createDriverDiagnosticAmbientProbe,
  isDriverDiagnosticForegroundTransition,
} from './driverDiagnosticAmbientProbe';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('driver diagnostic ambient probe', () => {
  it('runs foreground resume effects only on a real transition', () => {
    assert.equal(isDriverDiagnosticForegroundTransition('FOREGROUND', 'FOREGROUND'), false);
    assert.equal(isDriverDiagnosticForegroundTransition('BACKGROUND', 'FOREGROUND'), true);
    assert.equal(isDriverDiagnosticForegroundTransition('INACTIVE', 'FOREGROUND'), true);
    assert.equal(isDriverDiagnosticForegroundTransition('UNKNOWN', 'FOREGROUND'), true);
    assert.equal(isDriverDiagnosticForegroundTransition('BACKGROUND', 'BACKGROUND'), false);
  });

  it('refreshes stable lifecycle and network evidence after the server freshness TTL', async () => {
    let now = new Date('2026-10-01T14:00:00.000Z');
    const identity = {};
    const projection = createDriverDiagnosticProjection(() => now);
    const observe = (patch: {
      lifecycle?: 'BACKGROUND' | 'FOREGROUND' | 'INACTIVE';
      network?: 'OFFLINE' | 'ONLINE' | 'UNKNOWN';
    }) => {
      projection.observe({ kind: 'STATE', observedAt: now.toISOString(), patch });
    };
    observe({ lifecycle: 'FOREGROUND', network: 'ONLINE' });
    now = new Date('2026-10-01T14:04:00.000Z');
    const probe = createDriverDiagnosticAmbientProbe({
      captureIdentity: () => identity,
      getLifecycle: () => 'FOREGROUND',
      isCurrent: (candidate) => candidate === identity,
      observe: (_candidate, patch) => observe(patch),
      readNetwork: async () => 'ONLINE',
    });

    await probe.probe();

    assert.equal(projection.snapshot().stateObservedAt.lifecycle, now.toISOString());
    assert.equal(projection.snapshot().stateObservedAt.network, now.toISOString());
  });

  it('refreshes lifecycle but leaves network evidence stale when the bounded read fails', async () => {
    let now = new Date('2026-10-01T14:00:00.000Z');
    const identity = {};
    const projection = createDriverDiagnosticProjection(() => now);
    projection.observe({ kind: 'STATE', observedAt: now.toISOString(), patch: { lifecycle: 'FOREGROUND', network: 'ONLINE' } });
    now = new Date('2026-10-01T14:04:00.000Z');
    const probe = createDriverDiagnosticAmbientProbe({
      captureIdentity: () => identity,
      getLifecycle: () => 'FOREGROUND',
      isCurrent: (candidate) => candidate === identity,
      observe: (_candidate, patch) => projection.observe({ kind: 'STATE', observedAt: now.toISOString(), patch }),
      readNetwork: async () => { throw new Error('bounded network probe failed'); },
    });

    await probe.probe();

    assert.equal(projection.snapshot().stateObservedAt.lifecycle, now.toISOString());
    assert.equal(projection.snapshot().stateObservedAt.network, '2026-10-01T14:00:00.000Z');
  });

  it('does not serialize the caller, coalesces one identity, and discards a late previous-owner result', async () => {
    const identityA = {};
    const identityB = {};
    let current = identityA;
    const networkA = deferred<'ONLINE'>();
    const networkB = deferred<'OFFLINE'>();
    const observations: { identity: object; patch: object }[] = [];
    let reads = 0;
    const probe = createDriverDiagnosticAmbientProbe({
      captureIdentity: () => current,
      getLifecycle: () => 'FOREGROUND',
      isCurrent: (candidate) => candidate === current,
      observe: (identity, patch) => { observations.push({ identity, patch }); },
      readNetwork: () => (++reads === 1 ? networkA.promise : networkB.promise),
    });

    const first = probe.probe();
    const coalesced = probe.probe();
    assert.equal(reads, 1);
    assert.equal(observations.length, 2);

    current = identityB;
    const replacement = probe.probe();
    assert.equal(reads, 2);
    networkA.resolve('ONLINE');
    await Promise.all([first, coalesced]);
    assert.equal(observations.some(({ identity, patch }) => identity === identityA && 'network' in patch), false);

    networkB.resolve('OFFLINE');
    await replacement;
    assert.equal(observations.some(({ identity, patch }) => identity === identityB && 'network' in patch), true);
  });

  it('runs the bounded actual-state probe beside heartbeat and location work on bind, foreground, and interval', () => {
    const runtime = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'expoDriverDiagnosticRuntime.ts'),
      'utf8',
    );

    assert.match(runtime, /readNetwork: \(\) => bounded\(async \(\) => \{[\s\S]*getNetworkReachability\(await Network\.getNetworkStateAsync\(\)\)/u);
    assert.match(runtime, /patch: diagnosticNetworkState\.bindingPatch\(currentLifecycle\(\)\),[\s\S]*void ambientProbe\.probe\(\)/u);
    assert.match(runtime, /AppState\.addEventListener\('change', \(\) => \{ void ambientProbe\.probe\(\); \}\)/u);
    assert.match(runtime, /setInterval\(\(\) => \{[\s\S]*void ambientProbe\.probe\(\);[\s\S]*heartbeatIfDue\(\);[\s\S]*void probeLocation\(\);/u);
    assert.match(runtime, /const previousLifecycle = current\.projection\.snapshot\(\)\.lifecycle;[\s\S]*isDriverDiagnosticForegroundTransition\(previousLifecycle, event\.patch\?\.lifecycle\)[\s\S]*current\.recorder\.notifyForeground\(\)/u);
  });
});
