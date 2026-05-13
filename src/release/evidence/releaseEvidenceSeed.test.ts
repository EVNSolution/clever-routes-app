import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReleaseEvidenceSeed, type ReleaseEvidenceSeedInput } from './releaseEvidenceSeed';

const baseInput: ReleaseEvidenceSeedInput = {
  appConfig: {
    expo: {
      android: { versionCode: 1 },
      ios: { buildNumber: '1' },
      version: '0.1.0'
    }
  },
  easConfig: {
    build: {
      preview: { distribution: 'internal', environment: 'preview' },
      production: { autoIncrement: true, distribution: 'store', environment: 'production' }
    }
  },
  preflight: {
    checks: [
      { id: 'expo.identity', message: 'Expo identity is pinned.', ok: true },
      { id: 'eas.preview', message: 'Preview profile exists.', ok: true }
    ],
    externalBlockers: [
      'Expo/EAS project ownership and preview/production environment values must be confirmed outside git.',
      'Apple team/signing and Google Play/signing authority must be confirmed outside git.'
    ],
    failures: [],
    ok: true
  },
  sourceCommitSha: 'abc123def456',
  sourceRef: 'dev',
  trackingIssues: {
    nativeBuildEvidence: 'EVNSolution/clever-driver-app#73',
    physicalDeviceSmoke: 'EVNSolution/clever-driver-app#72',
    proofMediaProduction: 'EVNSolution/clever-delivery-server#71'
  }
};

test('renders a non-secret release evidence seed for the current source revision', () => {
  const markdown = buildReleaseEvidenceSeed(baseInput);

  assert.match(markdown, /^# Clever Driver release evidence seed/m);
  assert.match(markdown, /\| Source commit SHA \| `abc123def456` \|/);
  assert.match(markdown, /\| Source ref \| `dev` \|/);
  assert.match(markdown, /\| App version \| `0\.1\.0` \|/);
  assert.match(markdown, /\| iOS build number \| `1` \|/);
  assert.match(markdown, /\| Android version code \| `1` \|/);
  assert.match(markdown, /`npx eas-cli build --platform android --profile preview`/);
  assert.match(markdown, /`npx eas-cli build --platform ios --profile preview`/);
  assert.match(markdown, /EVNSolution\/clever-driver-app#72/);
  assert.match(markdown, /EVNSolution\/clever-driver-app#73/);
  assert.match(markdown, /EVNSolution\/clever-delivery-server#71/);
  assert.match(markdown, /Expo\/EAS project ownership/);
  assert.match(markdown, /\| `expo.identity` \| pass \| Expo identity is pinned\. \|/);
});

test('does not render runtime secrets, env values, binaries, or completed evidence placeholders', () => {
  const markdown = buildReleaseEvidenceSeed(baseInput);

  assert.doesNotMatch(markdown, /access[_-]?token/i);
  assert.doesNotMatch(markdown, /secret/i);
  assert.doesNotMatch(markdown, /\.ipa|\.apk|\.aab/);
  assert.doesNotMatch(markdown, /pending evidence url/i);
});
