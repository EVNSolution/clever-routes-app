import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runNativeReleasePreflight,
  type NativeReleasePreflightInput
} from './nativeReleasePreflight';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as T;
}

function readOptional(relativePath: string): string | undefined {
  const absolutePath = resolve(repoRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : undefined;
}

function readInput(): NativeReleasePreflightInput {
  const iosProjectPbxproj = readOptional('ios/CleverRoutes.xcodeproj/project.pbxproj');

  return {
    appConfig: readJson('app.json'),
    easConfig: readJson('eas.json'),
    envExample: readFileSync(resolve(repoRoot, '.env.example'), 'utf8'),
    ...(iosProjectPbxproj === undefined
      ? {}
      : {
          iosNativeProject: {
            infoPlist: readOptional('ios/CleverRoutes/Info.plist'),
            privacyManifest: readOptional('ios/CleverRoutes/PrivacyInfo.xcprivacy'),
            projectPbxproj: iosProjectPbxproj,
          },
        }),
  };
}

const result = runNativeReleasePreflight(readInput());

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
