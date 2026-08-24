export const OPERATION_TIMEOUT_CODE = 'OPERATION_TIMEOUT';

export class BoundedOperationTimeoutError extends Error {
  readonly code = OPERATION_TIMEOUT_CODE;

  constructor() {
    super(OPERATION_TIMEOUT_CODE);
    this.name = 'BoundedOperationTimeoutError';
  }
}

export type BoundedAsyncOperationOptions = {
  cancel?: (handle: unknown) => void;
  schedule?: (expire: () => void, timeoutMs: number) => unknown;
  timeoutMs: number;
};

export function runBoundedAsyncOperation<T>(
  operation: () => Promise<T>,
  options: BoundedAsyncOperationOptions,
): Promise<T> {
  const schedule = options.schedule ?? ((expire, timeoutMs) => setTimeout(expire, timeoutMs));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = schedule(() => {
      if (settled) return;
      settled = true;
      reject(new BoundedOperationTimeoutError());
    }, options.timeoutMs);
    let source: Promise<T>;
    try {
      source = operation();
    } catch (error) {
      settled = true;
      cancel(timer);
      reject(error);
      return;
    }
    source.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        reject(error);
      },
    );
  });
}
