import { Linking, NativeModules, Platform } from 'react-native';

import {
  openWithAndroidMapHandler,
  type AndroidMapHandlerBridge,
} from '../../../domain/navigation/androidMapHandlerSelection';
import type { StopNavigationLinking } from '../../../domain/stop/stopNavigation';
import { createExpoAndroidMapHandlerStore } from '../storage/expoAndroidMapHandlerStore';

type CleverMapNavigationModule = AndroidMapHandlerBridge;

const androidMapHandlerStore = createExpoAndroidMapHandlerStore();

export function resetExpoDefaultMapApp(): Promise<void> {
  return androidMapHandlerStore.clear();
}

export function createExpoStopNavigationLinking(): StopNavigationLinking {
  return {
    openURL(url) {
      if (Platform.OS !== 'android') {
        return Linking.openURL(url);
      }

      return openWithAndroidMapHandler({
        bridge: getAndroidMapHandlerBridge(),
        store: androidMapHandlerStore,
        url,
      });
    },
  };
}

function getAndroidMapHandlerBridge(): CleverMapNavigationModule {
  const nativeModule = NativeModules.CleverMapNavigation as CleverMapNavigationModule | undefined;
  if (nativeModule?.open === undefined || nativeModule.pickMapApp === undefined) {
    throw new Error('Android map navigation module is unavailable.');
  }
  return nativeModule;
}
