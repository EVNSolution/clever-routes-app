export const TRANSIENT_TOAST_DISMISS_DELAY_MS = 2_000;
export const TRANSIENT_TOAST_ANDROID_TOP_OFFSET = 54;
export const TRANSIENT_TOAST_BORDER_ALPHA = 0.42;
export const TRANSIENT_TOAST_SURFACE_ALPHA = 0.58;

export type TransientToastScheduler<TTimer = unknown> = {
  clearTimeout(timer: TTimer): void;
  setTimeout(callback: () => void, delayMs: number): TTimer;
};

const defaultTransientToastScheduler: TransientToastScheduler<ReturnType<typeof setTimeout>> = {
  clearTimeout: (timer) => clearTimeout(timer),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export function scheduleTransientToastDismiss<TTimer = ReturnType<typeof setTimeout>>(input: {
  dismiss(): void;
  message: string | null;
  scheduler?: TransientToastScheduler<TTimer>;
}): () => void {
  if (input.message === null) {
    return () => undefined;
  }

  const scheduler = input.scheduler ?? (defaultTransientToastScheduler as unknown as TransientToastScheduler<TTimer>);
  const timer = scheduler.setTimeout(input.dismiss, TRANSIENT_TOAST_DISMISS_DELAY_MS);

  return () => scheduler.clearTimeout(timer);
}
