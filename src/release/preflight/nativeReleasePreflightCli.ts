import { readFileSync } from 'node:fs';
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

function readInput(): NativeReleasePreflightInput {
  return {
    appConfig: readJson('app.json'),
    easConfig: readJson('eas.json'),
    envExample: readFileSync(resolve(repoRoot, '.env.example'), 'utf8')
  };
}

const result = runNativeReleasePreflight(readInput());

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
