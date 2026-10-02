type DiagnosticLifecycle = 'BACKGROUND' | 'FOREGROUND' | 'INACTIVE';
type DiagnosticNetwork = 'OFFLINE' | 'ONLINE' | 'UNKNOWN';
type RuntimeNetwork = 'offline' | 'online' | 'unknown';

export function createExpoDriverDiagnosticNetworkState() {
  let current: DiagnosticNetwork = 'UNKNOWN';

  return {
    bindingPatch: (lifecycle: DiagnosticLifecycle) => ({ lifecycle, network: current }),
    update: (network: RuntimeNetwork): DiagnosticNetwork => {
      current = network === 'online' ? 'ONLINE' : network === 'offline' ? 'OFFLINE' : 'UNKNOWN';
      return current;
    },
  };
}
