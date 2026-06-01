export type DriverApiNoStoreRequestOptions<TInit extends { headers?: Record<string, string> }> = Omit<TInit, 'headers'> & {
  cache: 'no-store';
  credentials: 'omit';
  headers: Record<string, string>;
};

const noStoreHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
} as const;

export function withNoStoreDriverApiRequest<TInit extends { headers?: Record<string, string> }>(
  init: TInit,
): DriverApiNoStoreRequestOptions<TInit> {
  return {
    ...init,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...noStoreHeaders,
      ...(init.headers ?? {}),
    },
  };
}
