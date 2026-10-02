export type NetworkReachability = 'offline' | 'online' | 'unknown';

export function getNetworkReachability(input: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): NetworkReachability {
  if (input.isConnected === false || input.isInternetReachable === false) {
    return 'offline';
  }
  if (input.isConnected === true && input.isInternetReachable === true) {
    return 'online';
  }
  return 'unknown';
}

export function shouldRetryOfflineSubmissionsAfterNetworkChange(input: {
  current: NetworkReachability;
  hasPendingSubmissions: boolean;
  previous: NetworkReachability;
}): boolean {
  return input.hasPendingSubmissions && input.previous === 'offline' && input.current === 'online';
}
