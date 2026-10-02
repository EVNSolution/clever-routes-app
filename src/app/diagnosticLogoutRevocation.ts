type TimerHandle = ReturnType<typeof setTimeout>;

export function runBoundedDiagnosticRevocation(input: {
  cancel?: (handle: TimerHandle) => void;
  previous?: Promise<void> | null;
  revoke(signal: AbortSignal): Promise<void>;
  schedule?: (expire: () => void, timeoutMs: number) => TimerHandle;
  timeoutMs: number;
}): Promise<void> {
  const schedule = input.schedule ?? ((expire, timeoutMs) => setTimeout(expire, timeoutMs));
  const cancel = input.cancel ?? clearTimeout;
  const controller = new AbortController();
  let cancelled = false;
  let resolveBarrier: () => void = () => undefined;
  const barrier = new Promise<void>(resolve => { resolveBarrier = resolve; });
  const timer = schedule(() => {
    cancelled = true;
    controller.abort();
    resolveBarrier();
  }, input.timeoutMs);

  void (async () => {
    try {
      await (input.previous ?? Promise.resolve()).catch(() => undefined);
      if (!cancelled) await input.revoke(controller.signal);
    } catch {
      // Logout cleanup is best effort and must not block the next account.
    } finally {
      cancel(timer);
      resolveBarrier();
    }
  })();

  return barrier;
}

export async function finalizeDiagnosticLogoutCleanup(input: {
  clearBinding(): void;
  isCurrent(): boolean;
  removeCredential(): Promise<void>;
}): Promise<void> {
  if (!input.isCurrent()) return;
  await input.removeCredential().catch(() => undefined);
  if (input.isCurrent()) input.clearBinding();
}
