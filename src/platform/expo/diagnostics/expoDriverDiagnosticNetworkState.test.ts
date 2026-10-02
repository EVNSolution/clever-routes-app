import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createExpoDriverDiagnosticNetworkState } from './expoDriverDiagnosticNetworkState';

describe('Expo driver diagnostic network state', () => {
  it('reports UNKNOWN on the initial binding before network evidence exists', () => {
    const network = createExpoDriverDiagnosticNetworkState();

    assert.deepEqual(network.bindingPatch('FOREGROUND'), {
      lifecycle: 'FOREGROUND',
      network: 'UNKNOWN',
    });
  });

  it('re-observes cached ONLINE state on a later binding', () => {
    const network = createExpoDriverDiagnosticNetworkState();
    network.update('online');

    assert.deepEqual(network.bindingPatch('FOREGROUND'), {
      lifecycle: 'FOREGROUND',
      network: 'ONLINE',
    });
  });

  it('re-observes cached OFFLINE state on a later binding', () => {
    const network = createExpoDriverDiagnosticNetworkState();
    network.update('offline');

    assert.deepEqual(network.bindingPatch('BACKGROUND'), {
      lifecycle: 'BACKGROUND',
      network: 'OFFLINE',
    });
  });

  it('keeps current network evidence across account and route bindings without another callback', () => {
    const network = createExpoDriverDiagnosticNetworkState();
    network.update('online');

    const accountBinding = network.bindingPatch('FOREGROUND');
    const routeBinding = network.bindingPatch('FOREGROUND');

    assert.equal(accountBinding.network, 'ONLINE');
    assert.equal(routeBinding.network, 'ONLINE');
  });
});
