export const TRANSIENT_TOAST_DISMISS_DELAY_MS = 2_000;
export const TRANSIENT_TOAST_BOTTOM_GAP = 16;
export const TRANSIENT_TOAST_ANDROID_ELEVATION = 12;
export const TRANSIENT_TOAST_Z_INDEX = 10_000;

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
