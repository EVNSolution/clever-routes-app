import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const manifest = readFileSync(join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const nativeModule = readFileSync(
  join(process.cwd(), 'android/app/src/main/java/com/evnsolution/clever/routes/CleverMapNavigationModule.kt'),
  'utf8',
);
const mainApplication = readFileSync(
  join(process.cwd(), 'android/app/src/main/java/com/evnsolution/clever/routes/MainApplication.kt'),
  'utf8',
);
const platformAdapter = readFileSync(
  join(process.cwd(), 'src/platform/expo/navigation/expoStopNavigationLinking.ts'),
  'utf8',
);

describe('Android map navigation handoff', () => {
  it('keeps geo handlers visible and routes selection through the native module', () => {
    assert.match(manifest, /<data android:scheme="geo"\/>/u);
    assert.doesNotMatch(manifest, /MapNavigationActivity/u);
    assert.doesNotMatch(manifest, /android:scheme="clever-routes-map"/u);
    assert.match(mainApplication, /add\(CleverMapNavigationPackage\(\)\)/u);
    assert.match(platformAdapter, /NativeModules\.CleverMapNavigation/u);
    assert.match(platformAdapter, /return Linking\.openURL\(url\)/u);
  });

  it('uses the Android activity picker and returns only the selected handler package', () => {
    assert.match(nativeModule, /ActivityEventListener/u);
    assert.match(nativeModule, /Intent\(Intent\.ACTION_PICK_ACTIVITY\)/u);
    assert.match(nativeModule, /putExtra\(Intent\.EXTRA_INTENT, targetIntent\)/u);
    assert.match(nativeModule, /activity\.startActivityForResult/u);
    assert.match(nativeModule, /data\?\.component\?\.packageName/u);
    assert.match(nativeModule, /promise\.resolve\(packageName\)/u);
    assert.doesNotMatch(nativeModule, /ACTION_MANAGE_DEFAULT_APPS_SETTINGS/u);
  });

  it('opens the requested destination only in the package selected by the driver', () => {
    assert.match(nativeModule, /fun open\(url: String, packageName: String, promise: Promise\)/u);
    assert.match(nativeModule, /Intent\(Intent\.ACTION_VIEW, uri\)\s*\.setPackage\(packageName\)/u);
    assert.match(nativeModule, /map_app_unavailable/u);
    assert.match(nativeModule, /catch \([^)]*: ActivityNotFoundException\)/u);
    assert.match(nativeModule, /catch \([^)]*: SecurityException\)/u);
  });

  it('always gives Waze its supported address search without forcing an impossible route', () => {
    assert.match(nativeModule, /const val WAZE_PACKAGE = "com\.waze"/u);
    assert.match(nativeModule, /destination\.address\?\.let \{ builder\.appendQueryParameter\("q", it\) \}/u);
    assert.match(nativeModule, /coordinates\?\.let \{ builder\.appendQueryParameter\("ll", it\) \}/u);
    assert.doesNotMatch(nativeModule, /appendQueryParameter\("navigate", "yes"\)/u);
    assert.match(nativeModule, /Uri\.parse\("geo:\$coordinates"\)/u);
  });

  it('persists the selected handler outside Settings UI and resets it without opening the picker', () => {
    assert.match(platformAdapter, /createExpoAndroidMapHandlerStore/u);
    assert.match(platformAdapter, /openWithAndroidMapHandler/u);
    assert.match(platformAdapter, /androidMapHandlerStore\.clear\(\)/u);
    assert.match(platformAdapter, /resetExpoDefaultMapApp/u);
    assert.doesNotMatch(platformAdapter, /changeAndroidMapHandler/u);
  });
});
