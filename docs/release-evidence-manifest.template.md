# CLEVER Routes release evidence manifest template

## Use and storage rules

Copy this template into the approved external release evidence store for each
preview or production release candidate. Do not commit completed manifests,
screenshots, videos, EAS artifacts, signing files, production logs, real driver
phone numbers, customer PII, exact production coordinates, access tokens, or
store-console screenshots to this repository.

Recommended external filename:

```text
release-evidence-manifest-<yyyyMMdd>-<shortsha>.md
```

Before filling a copied manifest, run `npm run release:evidence:seed` from the
committed source revision and paste its non-secret output into the external
evidence workspace as the starting audit record. The seed does not replace real
EAS build URLs, physical-device results, or owner/legal approvals.

After filling the external copy, validate a local working copy from this repo:

```bash
npm run release:evidence:verify -- /path/to/external/release-evidence-manifest-<yyyyMMdd>-<shortsha>.md
```

The verifier should pass only after all `pending` placeholders are removed, each
physical-device smoke row has iPhone and Android `pass` results with sanitized
external evidence references, each store/privacy row is approved or complete,
and the release candidate decision is `approved`. Do not commit the completed
copy after verification.

## Release candidate identity

| Field | Value |
| --- | --- |
| Source commit SHA | pending |
| GitHub PR / merge reference | pending |
| App version | pending |
| iOS build number | pending |
| Android version code | pending |
| EAS profile | `preview` / `production` |
| Distribution path | TestFlight / App Store / Play internal / Play production / Apple Business Manager / managed Google Play / other |
| Evidence owner | pending |
| Evidence storage location | pending |
| Synthetic data only? | yes / no |
| Production validation approval reference, if any | pending / n/a |
| Privacy policy URL | `https://clever-route-api.cleversystem.ai/routes-app/privacy` |
| Support URL | `https://clever-route-api.cleversystem.ai/routes-app/support` |
| Account-deletion URL | `https://clever-route-api.cleversystem.ai/routes-app/account-deletion` |

## Build evidence

| Platform | EAS build URL | Install method | Artifact reference | Notes |
| --- | --- | --- | --- | --- |
| iOS | pending | pending | pending | Apple team/signing authority verified: yes / no |
| Android | pending | pending | pending | Google Play/signing authority verified: yes / no |

## Environment evidence

| Field | Value |
| --- | --- |
| Delivery server environment | pending |
| `EXPO_PUBLIC_DRIVER_RUNTIME_MODE` source | EAS `preview` / EAS `production` / other |
| `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` source | EAS `preview` / EAS `production` / other |
| Driver route fixture reference | pending |
| Shop/company fixture reference | pending |
| Proof-media storage backend | local filesystem / object storage / other |
| Proof-media scanner deployment evidence | pending / n/a |
| Proof-media cleanup scheduler evidence | pending / n/a |

## Device matrix

| Platform | Device model | OS version | Locale/timezone | Network mode | Tester | Date/time |
| --- | --- | --- | --- | --- | --- | --- |
| iOS | pending | pending | pending | Wi-Fi / cellular / offline test | pending | pending |
| Android | pending | pending | pending | Wi-Fi / cellular / offline test | pending | pending |

## Physical-device smoke evidence

Use sanitized references to external screenshots/videos/logs only.

| Area | iPhone result | iPhone evidence reference | Android result | Android evidence reference | Blocker / notes |
| --- | --- | --- | --- | --- | --- |
| Fresh install and app launch | pending | pending | pending | pending | pending |
| E.164 phone lookup | pending | pending | pending | pending | pending |
| Company guidance and support contact display | pending | pending | pending | pending | pending |
| Consent gate and retry/error handling | pending | pending | pending | pending | pending |
| Assigned route and stop list | pending | pending | pending | pending | pending |
| Stop-card OS map handoff | pending | pending | pending | pending | pending |
| Delivery start foreground location permission | pending | pending | pending | pending | pending |
| Continuous/background-capable location task | pending | pending | pending | pending | pending |
| Proof photo capture from camera/library | pending | pending | pending | pending | pending |
| Proof media scan rejection UX | pending | pending | pending | pending | pending |
| Signature proof capture | pending | pending | pending | pending | pending |
| Offline queue retry/discard UI after network loss | pending | pending | pending | pending | pending |
| Token expiry, invalid persisted token, or live downstream `401` recovery | pending | pending | pending | pending | pending |
| Driver session reset/sign-out cleanup | pending | pending | pending | pending | pending |
| Delivery finish or route completion cleanup | pending | pending | pending | pending | pending |

Result values: `pass`, `fail`, `blocked`, or `not-run`.

## Store and privacy review evidence

| Area | Status | Evidence reference | Owner/legal approver | Notes |
| --- | --- | --- | --- | --- |
| Privacy policy URL approved | pending | pending | pending | pending |
| App Store privacy answers reviewed | pending | pending | pending | pending |
| Google Play Data safety answers reviewed | pending | pending | pending | pending |
| Stable synthetic Play review account and assigned route verified | pending | pending | pending | Do not store credentials in git or GitHub |
| Background location review rationale approved | pending | pending | pending | pending |
| Background-location demonstration video accepted | pending | pending | pending | Show disclosure, runtime permission, active-route tracking, and tracking stop |
| Photo/video permission review approved | pending | pending | pending | pending |
| Google Play minimum-scope permission review completed | pending | pending | pending | Location/photo-video reviewed; Contacts permissions absent in native manifest |
| Store/private distribution path approved | pending | pending | pending | pending |
| Public `LICENSE` / reuse terms decision | pending | pending | pending | pending |

## Completion decision

| Gate | Status | Notes |
| --- | --- | --- |
| Every physical-device smoke row has iPhone and Android evidence | pending | pending |
| Store/private distribution path approved | pending | pending |
| Privacy disclosure copy approved | pending | pending |
| Current Google Play minimum-scope permission review complete | pending | Location/photo-video reviewed and Contacts permissions absent |
| Local native release preflight passes | pending | Run `npm run check:native-release` from the source commit before EAS builds |
| EAS build records point to committed source | pending | pending |
| Generated artifacts and sensitive evidence kept outside git | pending | pending |
| Follow-up blockers filed as GitHub issues | pending | See issue map below |

Release candidate decision: `approved` / `rejected` / `blocked`

Decision owner:

Decision timestamp:

## Follow-up issue map

| Blocker | Issue | Status / evidence reference |
| --- | --- | --- |
| Physical iOS/Android smoke evidence | EVNSolution/clever-routes-app#72 | pending |
| Native EAS builds, signing, store/privacy approvals, license decision | EVNSolution/clever-routes-app#73 | pending |
| Production proof-media object storage, signed access, scanner, cleanup evidence | EVNSolution/clever-delivery-server#71 | pending |
| Baseline context-monorepo service pointer | EVNSolution/clever-context-monorepo#23 / PR #24 | complete; open a new context issue only if production runtime/API boundaries change |
