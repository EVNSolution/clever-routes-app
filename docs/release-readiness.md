# Release readiness checklist

## Purpose

This document tracks the non-code evidence needed before a production iOS/Android release of `clever-routes-app`. Product scope remains in `docs/project-brief.md`; app-side API/runtime behavior remains in `docs/route-access-flow.md`.

## Distribution decision

The app targets native iPhone and Android phone runtime. The existing direct APK
channel remains the fallback until the Google Play production release is live.
The current Android candidate is promoted as one immutable AAB through Play
internal testing and production review; it is not rebuilt between tracks.
`eas.json` defines the store build profile used for that candidate:

- Android fallback channel: stable `/routes-app` browser handoff to the managed
  `clever-routes-latest.apk` file
- Android store channel: Google Play internal testing, then production review
- iOS channel: App Store/TestFlight or an approved private distribution path
- Apple Business Manager Custom Apps and managed Google Play/private app for restricted driver distribution

Do not add final store listing copy, screenshots, signing ownership, or public license terms without an explicit owner decision. `docs/store-privacy-disclosure-draft.md` is a non-final worksheet for owner/legal review only.

### CLEVER Routes public release URLs

- Privacy: `https://clever-route-api.cleversystem.ai/routes-app/privacy`
- Support: `https://clever-route-api.cleversystem.ai/routes-app/support`
- Account deletion: `https://clever-route-api.cleversystem.ai/routes-app/account-deletion`

All three pages are server-owned public documents. The app opens them from
Settings. The authenticated in-app deletion action remains a separate server
request flow and signs the driver out after the server accepts the request.

### Direct Android update contract

- Every directly distributed APK increments Android `versionCode`; display
  version changes with it.
- Direct Android publishing uses one reviewed local command:
  `npm run release:android:publish`. Without `-- --execute` it is a dry-run
  gate and prints the validated upload/SSM plan. For a new release, both dry-run
  and execute mode clean and build the fixed release output directly from the
  verified `dev` or `main` commit; arbitrary `--apk` inputs are rejected. Dry-run
  still checks the approved Drive folder for immutable filename conflicts and
  resolves the tagged SSM target, but it does not upload to Drive, mutate server
  state, run SSM, or deploy anything.
- On startup and when returning to the foreground after the recheck interval,
  the app reads `GET /routes-app/release/android`.
- The release manifest declares the target Android package ID and the legacy
  package IDs it replaces. A package mismatch is a required reinstall, not a
  normal in-place update.
- Update lookup runs independently from saved-session restore. Lookup failure
  must not delay login, route restore, or route work.
- An available update is shown only after restore finishes and no active route
  is in progress. Optional updates allow `Later` for the current app process;
  required updates do not.
- `Update` opens the server-owned stable `/routes-app` URL. A package migration
  instead opens the server-provided `/driver-app` guide, which explains that
  the new app must be installed, signed into again, and verified before the
  previous app is removed. The app never receives or stores the backing Google
  Drive URL. The SSM server publisher receives the Drive backing URL through
  `--download-url`; the public manifest `installUrl` remains the server-owned
  stable `/routes-app` URL.
- Legacy builds continue to discover the release through
  `GET /driver-app/release/android`; the server returns the same canonical
  manifest and install guide.
- The server publishes `latestVersionCode`, `latestVersionName`, and
  `minimumSupportedVersionCode` from deployment environment values. Advance the
  published latest version only after the replacement APK has been uploaded and
  verified.
- The publisher blocks versionCode rollback and Drive filename conflicts. New
  APKs are uploaded as immutable versioned files under the approved Drive folder
  `15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ`, using the approved active gcloud account
  `dlajiin@gmail.com`. The publisher validates the clean source before and after
  its fixed release build, streams the APK checksum, and records the verified
  Git commit as `sourceSha`. Uploaded files include Drive `appProperties` for
  package, versionCode, versionName, sha256, and sourceSha.
- Drive publication uses a resumable upload session and streams the APK instead
  of constructing an in-memory multipart body. Anonymous post-publish checksum
  verification also hashes the response stream without buffering the full APK.
- If Drive upload succeeds but SSM/server publish fails, the versioned Drive
  APK can be left as an orphan. A retry with the same APK reuses the existing
  Drive file only when every same-name entry has the matching Drive-computed
  byte checksum, recorded sha256, and sourceSha. Any same-name file with missing
  or different checksum or provenance is treated as a conflicting retry and
  must be resolved manually outside the publisher before execution continues.
  In execute mode, before SSM publish, the publisher inspects the selected Drive
  file permissions and creates `anyone:reader` only when absent, including for a
  reused same-checksum orphan. Dry-run does not mutate permissions.
  Drive listing requests page through the whole approved folder so duplicate
  immutable filenames are not missed after the first page.
- Source validation resolves the live `origin/dev` or `origin/main` head with
  `git ls-remote` before and after the build, so a stale local remote-tracking
  ref cannot authorize a release.
- If an earlier SSM command succeeded but the publisher lost its result, a
  retry recognizes the same public version, install URL, and streamed APK
  checksum as already published and exits successfully without another server
  mutation.
- The publisher treats `aws ssm send-command` as asynchronous. It captures the
  command id, waits for `command-executed`, checks the command invocation status,
  then verifies the public `/routes-app/release/android` manifest and anonymous
  `/routes-app/download` checksum. The remote SSM command runs from
  `/srv/clever-route-server` with
  `docker compose --env-file .deploy/current-image.env -f infra/compose/docker-compose.prod.yml exec -T clever-route-api node dist/scripts/publish-routes-app-release.js`.
  AWS parameters are sent as JSON rather than hand-interpolated shell text.
- The publisher defaults to `ap-northeast-2` and discovers the target through
  the `Service=clever-delivery-server` SSM tag. Publication fails closed unless
  exactly one tagged managed instance exists and reports `Online`; callers do
  not supply an instance ID. The public delivery origin defaults to
  `https://clever-route.cleversystem.ai`.
- When discovering the current public release before publication, only HTTP 404
  is treated as absent/unbootstrapped state. Network, 5xx, and malformed
  response failures abort publication instead of silently bypassing rollback
  checks.
- The current legacy fixed Drive file
  `1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2` may only be reused with
  `--mode bootstrap-legacy --apk-sha256 <sha256>`. That mode bootstraps
  `1.1.1` (`versionCode` `8`) into the server database and does not replace
  Drive file content.
- Release `1.0.5` (`versionCode` `6`) starts the
  `com.evnsolution.clever.routes` identity. It cannot overwrite the legacy
  `com.evns.cleverdriverapp` package, so users must sign in again and remove the
  previous app after verifying the new installation.

Dry-run example for a new APK:

```bash
npm run release:android:publish
```

Execution is intentionally explicit and owner-controlled:

```bash
npm run release:android:publish -- \
  --execute
```

`--ssm-region` and `--delivery-server-base-url` remain explicit environment
overrides; the instance itself is always selected by the reviewed service tag.

## Native build profile matrix

The native binary build path uses Expo EAS profiles:

| Profile | Command | Intended evidence | Owner-controlled prerequisites |
| --- | --- | --- | --- |
| `preview` Android | `npx eas-cli build --platform android --profile preview` | Internal `.apk` install for Android physical-device smoke | Expo account/project access, EAS `preview` environment values, device/tester distribution decision |
| `preview` iOS | `npx eas-cli build --platform ios --profile preview` | Internal iPhone smoke build through EAS internal distribution | Expo account/project access, Apple team/signing authority, registered devices or approved internal distribution path, EAS `preview` environment values |
| `production` all | `npx eas-cli build --platform all --profile production` | Store/TestFlight/Play candidate archives | Expo account/project access, Apple/Google store authority, production signing, EAS `production` environment values, approved privacy/store copy |

Do not use `expo run:android` or a Development Build as Android QA evidence. Those binaries require Metro and include developer tooling. Use `npm run android:qa:build` for the self-contained EAS preview APK. `npm run build:android:device-smoke` is limited to local release-mode diagnostics and does not establish signing or distribution evidence.

`cli.requireCommit` is enabled in `eas.json` so native evidence builds are tied
to committed source. `cli.appVersionSource` is `remote`; the reviewed native
source version is `1.2.8` (`versionCode` `26`, iOS build `1`). Publication is
proved separately by the public release manifest and downloadable artifact,
not by this source document. A local self-contained smoke APK is verification
input, not publication evidence. Future production store builds use
`autoIncrement` to avoid duplicate build numbers.

Before running any preview/production EAS build for evidence, run:

```bash
npm run check:native-release
```

This local preflight validates source-controlled Expo/EAS identity, native permission declarations, build-profile shape, and public runtime env documentation. It is not a substitute for owner-controlled Expo/EAS project setup, signing authority, store/private distribution decisions, privacy disclosure approval, public license approval, or physical-device smoke evidence.

After choosing the committed source revision for external EAS/device evidence,
seed the external evidence manifest with:

```bash
npm run release:evidence:seed
```

The command prints non-secret Markdown with the current commit/ref, app
version/build identifiers, EAS build commands, native release preflight result,
remaining owner-controlled gates, and release blocker issue map. Copy that
output into the approved external evidence store before filling EAS URLs, device
results, owner/legal approvals, and evidence references. Do not commit completed
manifests or binary artifacts.

After the external manifest is filled, validate a local working copy before the
release decision:

```bash
npm run release:evidence:verify -- /path/to/external/release-evidence-manifest-<date>-<sha>.md
```

The verifier is intentionally secret-free and read-only: it checks for remaining
`pending` placeholders, required iPhone/Android smoke evidence rows,
store/privacy approvals, an `approved` release decision, and common sensitive or
binary artifact patterns. It does not prove that external screenshots, videos,
store-console records, signing authority, or owner/legal approvals are genuine;
those remain owner-controlled release gates.

## Physical-device smoke matrix

Before production release, capture evidence on at least one real iPhone and one real Android phone. Use synthetic driver/route data unless production validation is explicitly approved. Execute `docs/physical-device-smoke-runbook.md` for the step order, evidence naming, and external storage rules. Copy `docs/release-evidence-manifest.template.md` into the external evidence store for the release candidate and fill it there; do not commit completed evidence manifests.

| Area | iPhone evidence | Android evidence | Notes |
| --- | --- | --- | --- |
| Fresh install and app launch | pending | pending | Include app version/build identifier. |
| E.164 phone + six-digit PIN login | pending | pending | Verify no company/route data appears before account authentication. |
| First invitation registration | pending | pending | Use an administrator-created test invitation; confirm the app does not request or create a Shopify invitation and does not collect a driver name. |
| Company guidance and support contact display | pending | pending | Confirm multi-company wording. |
| Consent gate and retry/error handling | pending | pending | Verify consent versions/copy source. |
| Assigned route and stop list | pending | pending | Use shop/route timezone `deliveryDate`. |
| Stop-card OS map handoff | pending | pending | Confirm coordinates open the expected native map app and address fallback works for stops without coordinates. |
| Delivery start foreground location permission | pending | pending | Confirm denial and recovery UX. |
| Continuous/background-capable location task | pending | pending | Confirm native background configuration and OS prompts. |
| Proof photo capture from camera/library | pending | pending | Use synthetic proof media. |
| Proof media scan rejection UX | pending | pending | Local mock mode now exposes `scan_rejected`; live mode can use server `PROOF_MEDIA_REJECTED`. Confirm rejected photos show recapture guidance and are not queued as retryable proof. |
| Signature proof capture | pending | pending | Barcode proof capture is outside the current app scope. |
| Encrypted offline retry/quarantine after network loss | pending | pending | Confirm SQLCipher restart hydration, ordered retry, retry backoff, and reconciliation state. |
| Token expiry, invalid persisted token, or live downstream `401` recovery | pending | pending | App keeps account and route tokens separate, refreshes account access before reacquiring route access, and returns to phone + PIN only when account refresh/authentication fails. |
| Deleted/unassigned route refresh | pending | pending | An authoritative empty/deleted assignment removes the route from the app without deleting the signed-in account; transient network failure keeps the last safe cache. |
| Driver session reset/sign-out isolation | pending | pending | Confirm reset stops tracking, clears SecureStore driver access, removes location samples, seals ordered workflow/proof evidence, blanks lookup inputs, and prevents cross-account replay. |
| Delivery finish or route completion cleanup | pending | pending | App-side finish now stops tracking, records/queues `ROUTE_COMPLETED`, and cleans route queue after recorded completion; confirm on devices. |

## Store and privacy disclosure checklist

Store/privacy metadata must match actual runtime behavior and server retention policy before release:

- Foreground location use: active delivery route tracking and location updates.
- Background location use: only after delivery start and only when native background tracking is enabled.
- Camera/photos: proof-of-delivery photo capture/upload. Android library selection uses the system photo picker and the final bundle must not carry `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, or `WRITE_EXTERNAL_STORAGE`.
- Contacts/address book: current app uses manual E.164 phone entry and should not request Contacts permissions unless a future owner-approved feature changes that. `npm run check:native-release` rejects source-controlled Android Contacts permissions or iOS Contacts usage descriptions before EAS evidence builds.
- Driver identifiers: E.164 phone account, server-issued account/refresh and route-scoped access tokens, route assignment identifiers.
- Proof media: photo file, signature metadata, and related stop/route identifiers.
- Offline evidence: SQLCipher-encrypted retry payloads and file URI references are separated into workflow, sensitive, quarantine, and location tables; its key is separate in SecureStore and local backups are excluded.
- Offline evidence policy: location samples can be discarded after five retained attempts, after 72 hours, route completion, or account change. Ordered workflow/proof items are quarantined at retry limits, route conflicts, or sign-out and require explicit reconciliation. Server-rejected proof media remains non-retryable.
- Account deletion: the authenticated app request is queued by the server, revokes account sessions during processing, removes push-token access, tombstones deletable personal fields, and preserves only legally/operationally retained records. The public deletion page contains no anonymous destructive form; support verifies the requester before an operator processes the server request ID.
- Server proof-media rejection/retention support: `clever-delivery-server` now has a proof-media scan rejection hook, `DRIVER_PROOF_MEDIA_RETENTION_DAYS`, and `npm run driver:proof-media:cleanup` for local/manual or cron-style cleanup; production object storage, scanner backend, and scheduler deployment evidence are still pending.
- Support contact: company/operator support contact must be available in route guidance or store support metadata.

See `docs/store-privacy-disclosure-draft.md` for the current non-final App Store / Google Play disclosure worksheet. The worksheet narrows the review input, including current Google Play minimum-scope permission caveats for location, photo/video, and Contacts permissions, but final store answers still require owner/legal approval in the actual store consoles.

## Evidence storage policy

- Keep screenshots/videos/logs in the approved external evidence location; issues and PRs should contain only sanitized references.
- Do not commit large binary evidence, generated app bundles, signing artifacts, or production PII to this repo.
- If an evidence artifact is necessary but sensitive, reference the private storage location in the change-control issue instead of committing it.
- Completed copies of `docs/release-evidence-manifest.template.md` belong in the external evidence store, not in git.
- Run `npm run release:evidence:verify -- <external-manifest-path>` against a local copy before marking the release candidate approved, then keep only the verifier result and sanitized evidence references in issues/PRs.

## Release blockers still open

These blockers are now tracked as GitHub issues so release evidence can refer to
stable work items instead of unowned notes:

| Blocker | Tracking issue | Scope |
| --- | --- | --- |
| Physical iOS/Android device smoke evidence for background tracking, proof capture, offline retry/discard, token recovery, and route completion cleanup | EVNSolution/clever-routes-app#72 | Driver app evidence collection |
| Android 1.2.8 production AAB, Play metadata/policy forms, review access, background-location video, exact-artifact device smoke, and pre-launch report | EVNSolution/clever-routes-app#231 | Current Google Play production-readiness work |
| Production proof-media object storage ownership, signed retrieval/access-control, scanner backend/private evidence storage, and deployed cleanup/scheduler evidence | EVNSolution/clever-delivery-server#71 | Delivery-server proof media hardening |

The baseline context-monorepo service pointer is complete:
`EVNSolution/clever-context-monorepo#23` was closed by
`EVNSolution/clever-context-monorepo#24`. Future production runtime/API
boundary changes should create a new context-monorepo issue/PR only if the
durable service responsibility, public contract, deployment/runtime category, or
cross-repo interpretation changes.
