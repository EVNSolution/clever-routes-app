type DiagnosticLifecycle = 'BACKGROUND' | 'FOREGROUND' | 'INACTIVE';
type DiagnosticNetwork = 'OFFLINE' | 'ONLINE' | 'UNKNOWN';
type AmbientPatch = {
  lifecycle?: DiagnosticLifecycle;
  network?: DiagnosticNetwork;
};

export function isDriverDiagnosticForegroundTransition(
  previous: DiagnosticLifecycle | 'UNKNOWN',
  observed: DiagnosticLifecycle | 'UNKNOWN' | undefined,
): boolean {
  return observed === 'FOREGROUND' && previous !== 'FOREGROUND';
}

export function createDriverDiagnosticAmbientProbe<Identity extends object>(input: {
  captureIdentity(): Identity | null;
  getLifecycle(): DiagnosticLifecycle;
  isCurrent(identity: Identity): boolean;
  observe(identity: Identity, patch: AmbientPatch): void;
  readNetwork(): Promise<DiagnosticNetwork>;
}) {
  let inFlight: { identity: Identity; promise: Promise<void> } | null = null;

  function probe(): Promise<void> {
    const identity = input.captureIdentity();
    if (identity === null) return Promise.resolve();

    input.observe(identity, { lifecycle: input.getLifecycle() });
    if (inFlight?.identity === identity) return inFlight.promise;

    let networkRead: Promise<DiagnosticNetwork>;
    try {
      networkRead = input.readNetwork();
    } catch (error) {
      networkRead = Promise.reject(error);
    }
    const promise = networkRead
      .then((network) => {
        if (input.isCurrent(identity)) input.observe(identity, { network });
      })
      .catch(() => undefined)
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { identity, promise };
    return promise;
  }

  return { probe };
}
