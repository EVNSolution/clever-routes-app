/** Polls a check until it passes or the time limit ends; a failing check counts as not yet passed. */
export async function waitUntil(
  check: () => Promise<boolean>,
  options: { pollMs: number; timeoutMs: number },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => { setTimeout(resolve, options.pollMs); });
  }
}
