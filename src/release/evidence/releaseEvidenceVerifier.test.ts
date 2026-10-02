import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyReleaseEvidenceManifest } from './releaseEvidenceVerifier';

const completeManifest = `# Clever Driver release evidence manifest

## Release candidate identity

| Field | Value |
| --- | --- |
| Source commit SHA | 1c9c624ad82530311a301c80dbb939694b4ecafe |
| GitHub PR / merge reference | EVNSolution/clever-routes-app#79 |
| App version | 0.1.0 |
| iOS build number | 1 |
| Android version code | 1 |
| EAS profile | preview |
| Distribution path | Play internal / TestFlight |
| Evidence owner | release-owner |
| Evidence storage location | external evidence workspace reference |
| Synthetic data only? | yes |
| Production validation approval reference, if any | n/a |

## Build evidence

| Platform | EAS build URL | Install method | Artifact reference | Notes |
| --- | --- | --- | --- | --- |
| iOS | eas-build-ios-reference | internal install | external artifact reference | Apple team/signing authority verified: yes |
| Android | eas-build-android-reference | internal install | external artifact reference | Google Play/signing authority verified: yes |

## Environment evidence

| Field | Value |
| --- | --- |
| Delivery server environment | staging synthetic |
| \`EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL\` source | EAS preview |
| Driver route fixture reference | synthetic-route-fixture |
| Shop/company fixture reference | synthetic-shop-fixture |
| Proof-media storage backend | object storage |
| Proof-media scanner deployment evidence | external scanner smoke reference |
| Proof-media cleanup scheduler evidence | external cleanup scheduler reference |

## Device matrix

| Platform | Device model | OS version | Locale/timezone | Network mode | Tester | Date/time |
| --- | --- | --- | --- | --- | --- | --- |
| iOS | iPhone 15 | iOS 18 | en-US/America/New_York | Wi-Fi / offline test | tester-a | 2026-05-13T10:00:00Z |
| Android | Pixel 8 | Android 15 | en-US/America/New_York | Wi-Fi / offline test | tester-a | 2026-05-13T10:30:00Z |

## Physical-device smoke evidence

| Area | iPhone result | iPhone evidence reference | Android result | Android evidence reference | Blocker / notes |
| --- | --- | --- | --- | --- | --- |
| Fresh install and app launch | pass | ios-launch-ref | pass | android-launch-ref | none |
| E.164 phone lookup | pass | ios-route-ref | pass | android-route-ref | none |
| Company guidance and support contact display | pass | ios-company-ref | pass | android-company-ref | none |
| Consent gate and retry/error handling | pass | ios-consent-ref | pass | android-consent-ref | none |
| Assigned route and stop list | pass | ios-route-list-ref | pass | android-route-list-ref | none |
| Stop-card OS map handoff | pass | ios-map-ref | pass | android-map-ref | none |
| Delivery start foreground location permission | pass | ios-location-ref | pass | android-location-ref | none |
| Continuous/background-capable location task | pass | ios-background-ref | pass | android-background-ref | none |
| Proof photo capture from camera/library | pass | ios-photo-ref | pass | android-photo-ref | none |
| Proof media scan rejection UX | pass | ios-reject-ref | pass | android-reject-ref | none |
| Signature and barcode proof capture | pass | ios-signature-ref | pass | android-signature-ref | none |
| Offline queue retry/discard UI after network loss | pass | ios-offline-ref | pass | android-offline-ref | none |
| Token expiry, invalid persisted token, or live downstream \`401\` recovery | pass | ios-401-ref | pass | android-401-ref | none |
| Driver session reset/sign-out cleanup | pass | ios-reset-ref | pass | android-reset-ref | none |
| Delivery finish or route completion cleanup | pass | ios-finish-ref | pass | android-finish-ref | none |

## Store and privacy review evidence

| Area | Status | Evidence reference | Owner/legal approver | Notes |
| --- | --- | --- | --- | --- |
| Privacy policy URL approved | approved | privacy-ref | legal-owner | done |
| App Store privacy answers reviewed | approved | app-store-ref | legal-owner | done |
| Google Play Data safety answers reviewed | approved | play-ref | legal-owner | done |
| Background location review rationale approved | approved | background-ref | legal-owner | done |
| Photo/video permission review approved | approved | photo-ref | legal-owner | done |
| Google Play minimum-scope permission review completed | approved | permission-scope-ref | legal-owner | location/photo-video reviewed; Contacts permissions absent in native manifest |
| Store/private distribution path approved | approved | distribution-ref | owner | done |
| Public \`LICENSE\` / reuse terms decision | approved | license-ref | owner | done |

## Completion decision

| Gate | Status | Notes |
| --- | --- | --- |
| Every physical-device smoke row has iPhone and Android evidence | pass | verified |
| Store/private distribution path approved | pass | verified |
| Privacy disclosure copy approved | pass | verified |
| Current Google Play minimum-scope permission review complete | pass | verified |
| Local native release preflight passes | pass | verified |
| EAS build records point to committed source | pass | verified |
| Generated artifacts and sensitive evidence kept outside git | pass | verified |
| Follow-up blockers filed as GitHub issues | pass | verified |

Release candidate decision: approved

Decision owner: release-owner

Decision timestamp: 2026-05-13T11:00:00Z
`;

test('accepts a completed external release evidence manifest', () => {
  const result = verifyReleaseEvidenceManifest(completeManifest);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('rejects pending smoke evidence, unapproved store gates, blocked decisions, and sensitive values', () => {
  const incompleteManifest = completeManifest
    .replace('| Fresh install and app launch | pass | ios-launch-ref | pass | android-launch-ref | none |', '| Fresh install and app launch | pending | pending | pass | android-launch-ref | none |')
    .replace('| Privacy policy URL approved | approved | privacy-ref | legal-owner | done |', '| Privacy policy URL approved | pending | pending | pending | pending |')
    .replace('Release candidate decision: approved', 'Release candidate decision: blocked')
    .concat('\nBearer real-access-token\napp-release.apk\n');

  const result = verifyReleaseEvidenceManifest(incompleteManifest);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pending placeholder/i);
  assert.match(result.failures.join('\n'), /physical-device smoke row/i);
  assert.match(result.failures.join('\n'), /store\/privacy row/i);
  assert.match(result.failures.join('\n'), /release candidate decision/i);
  assert.match(result.failures.join('\n'), /sensitive or binary artifact pattern/i);
});

test('rejects manifests missing the minimum-scope permission review gate', () => {
  const missingPermissionGateManifest = completeManifest.replace(
    '| Google Play minimum-scope permission review completed | approved | permission-scope-ref | legal-owner | location/photo-video reviewed; Contacts permissions absent in native manifest |\n',
    '',
  );

  const result = verifyReleaseEvidenceManifest(missingPermissionGateManifest);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /Google Play minimum-scope permission review completed/i);
});

test('rejects pending minimum-scope permission review evidence', () => {
  const pendingPermissionGateManifest = completeManifest
    .replace(
      '| Google Play minimum-scope permission review completed | approved | permission-scope-ref | legal-owner | location/photo-video reviewed; Contacts permissions absent in native manifest |',
      '| Google Play minimum-scope permission review completed | pending | pending | pending | pending |',
    )
    .replace(
      '| Current Google Play minimum-scope permission review complete | pass | verified |',
      '| Current Google Play minimum-scope permission review complete | pending | pending |',
    );

  const result = verifyReleaseEvidenceManifest(pendingPermissionGateManifest);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pending placeholder/i);
  assert.match(result.failures.join('\n'), /Google Play minimum-scope permission review completed/i);
  assert.match(result.failures.join('\n'), /Current Google Play minimum-scope permission review complete/i);
});
