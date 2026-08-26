import { Linking, NativeModules, Platform } from 'react-native';

import type { StopNavigationLinking } from '../../../domain/stop/stopNavigation';

type CleverMapNavigationModule = {
  open(url: string): Promise<void>;
};

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
