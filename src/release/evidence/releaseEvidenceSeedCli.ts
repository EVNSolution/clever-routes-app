import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runNativeReleasePreflight, type NativeReleasePreflightInput } from '../preflight/nativeReleasePreflight';
import { buildReleaseEvidenceSeed } from './releaseEvidenceSeed';

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
    packageScripts: readJson<{ scripts?: Record<string, string> }>('package.json').scripts ?? {},
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

function git(args: string[], fallback: string): string {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const input = readInput();
const preflight = runNativeReleasePreflight(input);

console.log(buildReleaseEvidenceSeed({
  appConfig: input.appConfig,
  easConfig: input.easConfig,
  preflight,
  sourceCommitSha: git(['rev-parse', 'HEAD'], 'unknown'),
  sourceRef: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
  trackingIssues: {
    nativeBuildEvidence: 'EVNSolution/clever-routes-app#73',
    physicalDeviceSmoke: 'EVNSolution/clever-routes-app#72',
    proofMediaProduction: 'EVNSolution/clever-delivery-server#71'
  }
}));

if (!preflight.ok) {
  process.exitCode = 1;
}
