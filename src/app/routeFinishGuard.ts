/** Serialize completion and release across automatic and manual callers. */
export function createRouteFinishGuard() {
  let request: object | null = null;
  return {
    tryAcquire(): (() => void) | null {
      if (request !== null) return null;
      const currentRequest = {};
      request = currentRequest;
      return () => {
        if (request === currentRequest) request = null;
      };
    },
  };
}
