import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

/** True while the OS may stop the app in the background; null when it cannot be read. */
export async function readBatteryOptimizationEnabled(): Promise<boolean | null> {
  if (Platform.OS !== 'android') return null;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return null;
  }
}

/** Opens the system battery optimization list directly; falls back to the app settings. */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      return;
    } catch {
      // Fall through to the app settings.
    }
  }
  await Linking.openSettings();
}
