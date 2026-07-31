import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const EXPECTED_PACKAGE = 'com.evnsolution.clever.routes';
const EXPECTED_PROJECT = 'clever-routes-prod';
const source = process.env.CLEVER_ROUTES_GOOGLE_SERVICES_FILE?.trim();

function fail(message) {
  console.error(`Firebase Android configuration blocked: ${message}`);
  process.exit(1);
}

if (!source) {
  fail('CLEVER_ROUTES_GOOGLE_SERVICES_FILE must point to the protected google-services.json file.');
}

let config;
try {
  config = JSON.parse(readFileSync(source, 'utf8'));
} catch {
  fail(`cannot read valid JSON from ${source}.`);
}

const packages = (config.client ?? [])
  .map((client) => client.client_info?.android_client_info?.package_name)
  .filter(Boolean);

if (config.project_info?.project_id !== EXPECTED_PROJECT) {
  fail(`expected Firebase project ${EXPECTED_PROJECT}.`);
}
if (!packages.includes(EXPECTED_PACKAGE)) {
  fail(`expected Android package ${EXPECTED_PACKAGE}.`);
}

const destination = resolve('android/app/google-services.json');
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.info(`Firebase Android configuration prepared for ${EXPECTED_PACKAGE}.`);
