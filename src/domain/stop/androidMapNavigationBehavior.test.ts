import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const manifest = readFileSync(join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const activity = readFileSync(
  join(process.cwd(), 'android/app/src/main/java/com/evnsolution/clever/routes/MapNavigationActivity.kt'),
  'utf8',
);
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
  it('registers a private explicit bridge activity and makes geo handlers visible', () => {
    assert.match(manifest, /<data android:scheme="geo"\/>/u);
    assert.match(
      manifest,
      /<activity android:name="\.MapNavigationActivity" android:exported="false"/u,
    );
    assert.doesNotMatch(manifest, /android:scheme="clever-routes-map"/u);
    assert.match(nativeModule, /Intent\(reactApplicationContext, MapNavigationActivity::class\.java\)/u);
    assert.match(nativeModule, /putExtra\(MapNavigationActivity\.EXTRA_DESTINATION_URL, url\)/u);
    assert.match(mainApplication, /add\(CleverMapNavigationPackage\(\)\)/u);
    assert.match(platformAdapter, /NativeModules\.CleverMapNavigation/u);
    assert.match(platformAdapter, /return Linking\.openURL\(url\)/u);
  });

  it('honors an Android default handler and otherwise presents installed map choices', () => {
    assert.match(activity, /resolveDefaultPackage\(genericIntent\)/u);
    assert.match(activity, /queryMapHandlers\(genericIntent\)/u);
    assert.match(activity, /Intent\.createChooser\(genericIntent, "Open navigation with"\)/u);
    assert.match(activity, /Intent\.EXTRA_INITIAL_INTENTS/u);
    assert.match(activity, /Intent\.EXTRA_EXCLUDE_COMPONENTS/u);
    assert.match(activity, /ComponentName\(it\.packageName, it\.name\)/u);
    assert.match(activity, /Intent\(Intent\.ACTION_VIEW, uri\)\.setPackage\(packageName\)/u);
    assert.match(activity, /catch \(_: ActivityNotFoundException\)/u);
    assert.match(activity, /catch \(_: SecurityException\)/u);
    assert.doesNotMatch(activity, /startActivity\(launchIntent\)/u);
  });

  it('gives Waze its supported address search while retaining trusted coordinates', () => {
    assert.match(activity, /const val WAZE_PACKAGE = "com\.waze"/u);
    assert.match(activity, /builder\.appendQueryParameter\("q", destination\.address\)/u);
    assert.match(activity, /builder\.appendQueryParameter\("ll", it\)/u);
    assert.match(activity, /appendQueryParameter\("navigate", "yes"\)/u);
    assert.match(activity, /Uri\.parse\("geo:\$coordinates"\)/u);
  });
});
