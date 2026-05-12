# Release readiness checklist

## Purpose

This document tracks the non-code evidence needed before a production iOS/Android release of `clever-driver-app`. Product scope remains in `docs/project-brief.md`; app-side API/runtime behavior remains in `docs/route-access-flow.md`.

## Distribution decision

The app targets native iPhone and Android phone runtime. `eas.json` now defines build-profile scaffolding, but the final release channel is still pending owner decision:

- App Store/TestFlight and Google Play testing or production tracks
- Apple Business Manager Custom Apps and managed Google Play/private app for restricted driver distribution

Do not add final store listing copy, screenshots, signing ownership, or public license terms without an explicit owner decision. `docs/store-privacy-disclosure-draft.md` is a non-final worksheet for owner/legal review only.

## Native build profile matrix

The native binary build path uses Expo EAS profiles:

| Profile | Command | Intended evidence | Owner-controlled prerequisites |
| --- | --- | --- | --- |
| `preview` Android | `npx eas-cli build --platform android --profile preview` | Internal `.apk` install for Android physical-device smoke | Expo account/project access, EAS `preview` environment values, device/tester distribution decision |
| `preview` iOS | `npx eas-cli build --platform ios --profile preview` | Internal iPhone smoke build through EAS internal distribution | Expo account/project access, Apple team/signing authority, registered devices or approved internal distribution path, EAS `preview` environment values |
| `production` all | `npx eas-cli build --platform all --profile production` | Store/TestFlight/Play candidate archives | Expo account/project access, Apple/Google store authority, production signing, EAS `production` environment values, approved privacy/store copy |

`cli.requireCommit` is enabled in `eas.json` so native evidence builds are tied to committed source. `cli.appVersionSource` is `remote`; initial local `ios.buildNumber` and `android.versionCode` are set to `1` before the first EAS remote version sync, while production builds use `autoIncrement` to avoid duplicate store build numbers.

## Physical-device smoke matrix

Before production release, capture evidence on at least one real iPhone and one real Android phone. Use synthetic driver/route data unless production validation is explicitly approved. Execute `docs/physical-device-smoke-runbook.md` for the step order, evidence naming, and external storage rules. Copy `docs/release-evidence-manifest.template.md` into the external evidence store for the release candidate and fill it there; do not commit completed evidence manifests.

| Area | iPhone evidence | Android evidence | Notes |
| --- | --- | --- | --- |
| Fresh install and app launch | pending | pending | Include app version/build identifier. |
| Route context + E.164 phone lookup | pending | pending | Verify tenant/company context before route data. |
| Company guidance and support contact display | pending | pending | Confirm multi-company wording. |
| Consent gate and retry/error handling | pending | pending | Verify consent versions/copy source. |
| Assigned route and stop list | pending | pending | Use shop/route timezone `deliveryDate`. |
| Stop-card OS map handoff | pending | pending | Confirm coordinates open the expected native map app and address fallback works for stops without coordinates. |
| Delivery start foreground location permission | pending | pending | Confirm denial and recovery UX. |
| Continuous/background-capable location task | pending | pending | Confirm native background configuration and OS prompts. |
| Proof photo capture from camera/library | pending | pending | Use synthetic proof media. |
| Signature and barcode proof capture | pending | pending | Confirm unavailable/denied states. |
| Offline queue retry/discard UI after network loss | pending | pending | Confirm app restart hydration. |
| Token expiry or invalid persisted token recovery | pending | pending | Confirm SecureStore clearing path. |
| Driver session reset/sign-out cleanup | pending | pending | Confirm reset stops tracking, clears SecureStore driver access, clears queued retry state, blanks lookup inputs, and returns to safe lookup state. |
| Delivery finish or route completion cleanup | pending | pending | App-side finish now stops tracking, records/queues `ROUTE_COMPLETED`, and cleans route queue after recorded completion; confirm on devices. |

## Store and privacy disclosure checklist

Store/privacy metadata must match actual runtime behavior and server retention policy before release:

- Foreground location use: active delivery route tracking and location updates.
- Background location use: only after delivery start and only when native background tracking is enabled.
- Camera/photos: proof-of-delivery photo capture/upload.
- Camera barcode scanning: proof barcode capture when available.
- Driver identifiers: route context, phone lookup, server-issued driver access token, route assignment identifiers.
- Proof media: photo file, signature metadata, barcode metadata, and related stop/route identifiers.
- Offline queue: non-secret retry metadata and file URI references retained locally until retry/discard policy runs.
- Offline queue app-side policy: pending driver event/proof-media retry items are discarded after five retained attempts, after 72 hours, when the completed route is explicitly purged, or when driver sign-out/session reset clears local retry state.
- Server proof-media retention/deletion support: `clever-delivery-server` now has `DRIVER_PROOF_MEDIA_RETENTION_DAYS` and `npm run driver:proof-media:cleanup` for local/manual or cron-style cleanup; production deployment evidence is still pending.
- Support contact: company/operator support contact must be available in route guidance or store support metadata.

See `docs/store-privacy-disclosure-draft.md` for the current non-final App Store / Google Play disclosure worksheet. The worksheet narrows the review input, but final store answers still require owner/legal approval in the actual store consoles.

## Evidence storage policy

- Keep screenshots/videos/logs in the approved external evidence location; issues and PRs should contain only sanitized references.
- Do not commit large binary evidence, generated app bundles, signing artifacts, or production PII to this repo.
- If an evidence artifact is necessary but sensitive, reference the private storage location in the change-control issue instead of committing it.
- Completed copies of `docs/release-evidence-manifest.template.md` belong in the external evidence store, not in git.

## Release blockers still open

- Production proof-media object storage ownership, signed retrieval/access-control, malware scanning/private evidence storage, and deployed cleanup/scheduler evidence.
- Physical iOS/Android device smoke evidence for background tracking and proof capture.
- Store/private distribution policy and owner/legal-approved privacy disclosure copy.
- Owner-controlled Expo/EAS project, Apple/Google signing credentials, and EAS preview/production environment values must be configured outside git before native builds run.
- Context-monorepo service document after production runtime/API boundaries are confirmed.
