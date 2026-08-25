export const OPERATION_TIMEOUT_CODE = 'OPERATION_TIMEOUT';

export class BoundedOperationTimeoutError extends Error {
  readonly code = OPERATION_TIMEOUT_CODE;

  constructor() {
    super(OPERATION_TIMEOUT_CODE);
    this.name = 'BoundedOperationTimeoutError';
  }
}

export class BoundedOperationAbortedError extends Error {
  constructor() {
    super('OPERATION_ABORTED');
    this.name = 'AbortError';
  }
}

export type BoundedAsyncOperationOptions = {
  cancel?: (handle: unknown) => void;
  schedule?: (expire: () => void, timeoutMs: number) => unknown;
  signal?: AbortSignal;
  timeoutMs: number;
};

export function runBoundedAsyncOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: BoundedAsyncOperationOptions,
): Promise<T> {
  const schedule = options.schedule ?? ((expire, timeoutMs) => setTimeout(expire, timeoutMs));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const controller = new AbortController();
    const inputSignal = options.signal;
    const abortFromLifecycle = () => {
      if (settled) return;
      settled = true;
      controller.abort();
      cancel(timer);
      reject(new BoundedOperationAbortedError());
    };
    const timer = schedule(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      inputSignal?.removeEventListener('abort', abortFromLifecycle);
      reject(new BoundedOperationTimeoutError());
    }, options.timeoutMs);
    if (inputSignal?.aborted === true) {
      abortFromLifecycle();
      return;
    }
    inputSignal?.addEventListener('abort', abortFromLifecycle, { once: true });
    let source: Promise<T>;
    try {
      source = operation(controller.signal);
    } catch (error) {
      settled = true;
      cancel(timer);
      inputSignal?.removeEventListener('abort', abortFromLifecycle);
      reject(error);
      return;
    }
    source.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        inputSignal?.removeEventListener('abort', abortFromLifecycle);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        inputSignal?.removeEventListener('abort', abortFromLifecycle);
        reject(error);
      },
    );
  });
}
