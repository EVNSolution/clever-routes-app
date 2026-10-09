#!/usr/bin/env node
// Builds a separate local-only package. Does not install, publish, or read .env.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certificate = process.argv[2];
const proofQa = process.argv[3] === '--proof';
const cashQa = process.argv[3] === '--cash' || proofQa;
if (!certificate || certificate === '--help' || (process.argv.length !== 3 && !(cashQa && process.argv.length === 4))) {
  console.log('Usage: node scripts/build-kfood-native-qa.mjs <local HTTPS public CA certificate.pem> [--cash|--proof]');
  process.exit(certificate === '--help' ? 0 : 1);
}
const verify = spawnSync('openssl', ['x509', '-in', resolve(certificate), '-noout', '-checkend', '3600'], { stdio: 'inherit' });
if (verify.status !== 0) throw new Error('The QA trust certificate must be valid for at least one hour.');
const publicCertificate = spawnSync('openssl', ['x509', '-in', resolve(certificate), '-outform', 'PEM'], { encoding: 'utf8' });
if (publicCertificate.status !== 0) throw new Error('The QA public certificate could not be extracted.');
const destination = resolve(root, 'android/app/src/qa/res/raw/kfood_qa_ca.pem');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, publicCertificate.stdout);
const buildEnvironment = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('EXPO_') && !name.startsWith('EAS_')));
const result = spawnSync('./gradlew', [
  'app:assembleQa', '-PreactNativeArchitectures=arm64-v8a',
  ...(cashQa ? ['-PkfoodCashQa=true'] : []),
  ...(proofQa ? ['-PkfoodProofQa=true'] : []),
  '--max-workers=2', '--no-parallel', '--no-daemon', '--build-cache',
], {
  cwd: resolve(root, 'android'), stdio: 'inherit',
  env: {
    ...buildEnvironment, NODE_ENV: 'production', EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_DRIVER_RUNTIME_MODE: 'live',
    EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL: `https://localhost:${cashQa ? 8445 : 8443}`,
    EXPO_PUBLIC_DRIVER_MAP_STYLE_URL: `https://localhost:${cashQa ? 8445 : 8443}/qa-map-style.json`,
    ...(cashQa ? { EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA: 'true' } : {}),
    CMAKE_BUILD_PARALLEL_LEVEL: '2',
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
