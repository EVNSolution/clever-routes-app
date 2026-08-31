import { Linking, NativeModules, Platform } from 'react-native';

import type { StopNavigationLinking } from '../../../domain/stop/stopNavigation';

type CleverMapNavigationModule = {
  open(url: string): Promise<void>;
  openDefaultAppsSettings(): Promise<void>;
};

export function openExpoDefaultMapAppSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    return Linking.openSettings();
  }

  const nativeModule = NativeModules.CleverMapNavigation as CleverMapNavigationModule | undefined;
  if (nativeModule?.openDefaultAppsSettings === undefined) {
    return Promise.reject(new Error('Android default app settings module is unavailable.'));
  }
  return nativeModule.openDefaultAppsSettings();
}

export function createExpoStopNavigationLinking(): StopNavigationLinking {
  return {
    openURL(url) {
      if (Platform.OS !== 'android') {
        return Linking.openURL(url);
      }

      const nativeModule = NativeModules.CleverMapNavigation as CleverMapNavigationModule | undefined;
      if (nativeModule?.open === undefined) {
        return Promise.reject(new Error('Android map navigation module is unavailable.'));
      }
      return nativeModule.open(url);
    },
  };
}
