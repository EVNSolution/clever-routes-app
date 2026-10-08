# PR299 Android release candidate preparation — 2026-10-08

Status: signed candidate AAB built and statically verified; publication remains blocked. This document
prepares a build and integration sequence. It does not authorize a merge,
production migration, store submission, APK publication, or feature activation.
The committed candidate source is `985f999ad2c4f9354ff2c856174e4542410c6554`. Build and acceptance evidence are recorded separately below.

## Source and current distribution

| Item | Read-only observation / prepared value |
| --- | --- |
| Starting app revision | `4c7f3cc57e28c263e484f2c44fa01b329faca79e` |
| Existing Draft | [App PR299](https://github.com/EVNSolution/clever-routes-app/pull/299), base `cc-314-kfood-live-change` |
| Preserved predecessor | [App PR297](https://github.com/EVNSolution/clever-routes-app/pull/297), `e2236e67efb8ece0bddfe5af503deb7fa77d4e6f`, base `dev` |
| Server dependency | [Server PR489](https://github.com/EVNSolution/clever-route-server/pull/489), `bd132f199c2a058d8e14fe33d97497307a51af45`, stacked on PR486 |
| Server predecessor | [Server PR486](https://github.com/EVNSolution/clever-route-server/pull/486), `9bd6e7b8408508c83b1e4255a62c37ee9b983bf0`, base `main` |
| Prepared source version | `1.3.5`, Android `versionCode` `41` |
| Operating Android package | `com.evnsolution.clever.routes` |
| iOS consistency only | Marketing version `1.3.5`; build number remains `1`. No iOS release is prepared. |
| Actual API origin | `https://clever-route.cleversystem.ai` |
| Public release snapshot | `1.3.4` / `40`, minimum supported `26` |
| Authenticated Play Console snapshot | All App Bundles: 13 versions, descending order; highest `40` (`1.3.4`), no `41`, observed 2026-10-08 |
| Play release tracks | Production `40`, internal `39`, open testing `36`; dashboard shows no unpublished changes |
| Active install destination | Google Play: `https://play.google.com/store/apps/details?id=com.evnsolution.clever.routes` |
| Candidate source SHA | `985f999ad2c4f9354ff2c856174e4542410c6554` |
| Candidate AAB | `clever-routes-1.3.5-41-985f999.aab`, 112,132,349 bytes |
| AAB SHA256 | `3c620a406c54e7bf8af0b9d1f1c2b0bbd7a682daa0252d30fa1986e67313b789` |
| EAS build | [0fcfbb4c-1c55-4a82-a113-a3ecc6dfbf5b](https://expo.dev/accounts/evandsolution/projects/clever-routes-app/builds/0fcfbb4c-1c55-4a82-a113-a3ecc6dfbf5b), FINISHED at `2026-10-08T12:04:27Z` |

Both public GETs returned HTTP200 with the same release on 2026-10-08:
[`/routes-app/release/android`](https://clever-route.cleversystem.ai/routes-app/release/android)
and [`/driver-app/release/android`](https://clever-route.cleversystem.ai/driver-app/release/android).
Their nested `distribution.channel` is `google_play`, and `installUrl` points to
Google Play. The legacy top-level `distributionChannel` still says `direct`.
Record that mismatch; do not infer a channel change or alter the server here.
The established store sequence is one immutable AAB through internal testing and
production review. The direct APK publisher is a separate fallback path.

The read-only EAS remote version query returned `40`. The latest eight EAS cloud
build records contain no later code; the newest cloud record is `33`. Local EAS
builds do not create cloud build records. The root task separately inspected the
authenticated Play Console on 2026-10-08. Its All App Bundles table showed 13
versions sorted descending, with `40` (`1.3.4`) highest and no `41`. The latest
releases were production `40`, internal `39` and open testing `36`. The dashboard
showed no unpublished changes.

These observations supported `41` as the next candidate code before the build.
The subsequent controlled `production` build reserved **41**, used the existing
remote upload key, and finished successfully. Do not allocate or submit a second
artifact with this reserved number. This task did not upload to Play Console.

Only identity values changed: Expo, package/root lock metadata, Android Gradle,
iOS marketing version, and the matching version assertions. Dependency versions,
lockfile dependency entries, runtime behavior and the rollout flag are unchanged.

## Signing and configuration availability

| Item | Read-only result |
| --- | --- |
| EAS production credentials source | `remote` |
| Default remote Android upload key | `CLEVER Routes Play Upload 2026`, JKS, present |
| Upload certificate SHA256 | `55c14543e167a55efe4f0153c9fee0e52d2fd3ae567a255356c40aee8893ee48` |
| Play Console upload certificate | SHA256 matches the EAS upload certificate exactly, observed 2026-10-08 |
| Upload-key metadata updated | `2026-08-14T07:52:33.272Z` |
| EAS Google Play submission credential | Absent; do not infer that `eas submit` is configured |
| Play Digital Asset Links JSON app-signing fingerprint | SHA256 `D6:B2:EA:CC:50:3C:51:52:14:9B:DF:C6:CD:E4:F2:E3:38:67:C4:3C:B6:53:0D:83:C9:02:B9:B5:88:D5:C1:3F` |
| EAS production Firebase configuration | `CLEVER_ROUTES_GOOGLE_SERVICES_FILE` exists as `FILE_BASE64` / `SECRET` |
| EAS production runtime | `EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live` |
| EAS production API | `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://clever-route.cleversystem.ai` |
| EAS production Cash QA flag | `EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA` absent; default is OFF |
| Local worktree signing | Gradle `release` still uses `signingConfigs.debug`; it is not the Play upload identity |
| Local worktree Firebase file | `android/app/google-services.json` absent at inspection |
| Original checkout Firebase file | File exists; contents were not read or copied during this preparation |
| Local `credentials.json` | Absent in both inspected app checkouts |

The remote signing query selected certificate type, fingerprint and timestamp
only. It did not request keystore bytes, passwords, key alias secrets or service
account JSON. Firebase inspection selected name/type/visibility only. No signing
material was downloaded or copied.

The root task inspected the authenticated [Play app-signing page](https://play.google.com/console/u/0/developers/7728300998655121517/app/4972789138819989138/keymanagement)
on 2026-10-08. Its upload SHA256 matched EAS. The app-signing fingerprint above
came from the displayed Digital Asset Links JSON. The page showed an active key
and a prior key dated 2026-08-14. Current-key copy returned an empty clipboard,
and the download attempt produced no certificate artifact. Therefore this record
does not claim verification of a downloaded certificate file or an independent
current-key certificate. No signing setting changed.

A cloud EAS production build can use its configured secret file. A local EAS
build requires a protected local Firebase file path because secret values are
not available to the local build as ordinary readable EAS environment values.
Do not print or commit that file. The existing preparation script validates the
expected Firebase project and operating package before copying into the build.

The existing Cash QA package uses `.cashqa`, localhost8445 and an Android Debug
signer. It verifies synthetic native behavior only. Neither it nor a local
Debug-signed release APK is a store/distribution candidate.

## Allowed build and verification path before merge

The EAS path in [release-readiness](../release-readiness.md) is separate from the
direct APK publisher. The installed EAS CLI requires a clean committed source;
it does not restrict the build to `dev` or `main`. The existing `production`
profile produces an AAB, uses remote signing, and increments the remote version.
No `--auto-submit` option belongs in this preparation.

Before the controlled build:

1. Complete the source checks and native acceptance, or retain each failed gate.
2. Commit the prepared candidate and record its exact SHA. Keep the checkout clean.
3. Re-read the public manifest, EAS remote version and Play Console reservations.
4. Confirm EAS production remains live, uses the canonical API, and has no Cash QA opt-in.
5. Run native preflight. Build the committed candidate only after these observations are reviewed.

Read-only checks and the existing preflight:

```sh
npm run check:native-release
npx eas-cli build:version:get -p android --profile production-local --json --non-interactive
npx eas-cli build:list -p android --limit 8 --json --non-interactive
npx eas-cli env:get production --variable-name EXPO_PUBLIC_DRIVER_RUNTIME_MODE --non-interactive
npx eas-cli env:get production --variable-name EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL --non-interactive
npx eas-cli env:get production --variable-name EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA --non-interactive
```

After selecting the clean candidate and confirming remote version40, the task
ran this existing build command. It reserved41 and produced the AAB listed above.
It did not submit to Google Play. Do not repeat it for this candidate:

```sh
npx eas-cli build -p android --profile production --non-interactive --no-wait
```

The configured production environment supplies the cloud runtime and Firebase
file. A shell-only environment assignment is not a replacement for checking the
EAS cloud environment. Do not add a QA flag to the production environment.

If a cloud attempt reserves41 and fails before producing an artifact, confirm
that reservation and the absence of a submitted41 before using the existing
`production-local` recovery profile. It does not allocate a new version. Using
it while the remote code remains40 would duplicate the live version.

```sh
release_tmp="$(mktemp -d "${TMPDIR:-/tmp}/clever-routes-release.XXXXXX")"
TMPDIR="$release_tmp" \
  EXPO_NO_DOTENV=1 \
  EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live \
  EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://clever-route.cleversystem.ai \
  EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA=false \
  CLEVER_ROUTES_GOOGLE_SERVICES_FILE=/absolute/protected/google-services.json \
  npx eas-cli build --local -p android --profile production-local --non-interactive
```

The local command is conditional recovery, not the first build step. Allocate a
new private `TMPDIR` for each attempt and preserve other builds' caches. Do not
run a manual equivalent of the protected direct-distribution Gradle task.

For the resulting AAB, record the source SHA, package, version, checksum, upload
certificate, native permissions and these verifier results. Inspect any APK
subsequently derived from the same AAB as well:

```sh
python3 scripts/verify-android-artifact-runtime.py --artifact /absolute/path/to/candidate.aab
python3 scripts/verify-android-artifact-runtime.py --artifact /absolute/path/to/derived-candidate.apk
```

The verifier must reject localhost8443/8445 contamination, including a bundle
containing both production and QA endpoints. Confirm the opt-in remains OFF
separately; endpoint verification alone does not prove the rollout flag, signing
identity or physical-device acceptance. Keep completed release manifests and
binary evidence outside git.

## Official publisher boundary

`npm run build:android:distribution` runs its protected prebuild gate.
`npm run release:android:publish` checks source before any build, even in dry-run.
The publisher requires a clean `dev` or `main` whose SHA matches the live remote
head both before and after its fixed build. It rejects arbitrary `--apk` input.
The lower prebuild script checks the official local tracking ref as an additional
gate. A source branch or detached candidate does not satisfy these requirements.

Do not rename the feature branch, fake a tracking ref, remove the prebuild hook,
or invoke its underlying Gradle command to obtain a supposed official artifact.
A publisher dry-run on this Draft branch is blocked by design; it is not a
candidate-build substitute. Do not execute the publisher as part of this task.
The active channel is Google Play. Invoking the direct publisher would be a
separate release decision and does not submit the AAB to Play.

## Dependency, integration and publication sequence

These are future execution steps, not actions performed by this document.

1. Resolve the remaining dependency-audit and designated-device acceptance gates.
   Preserve failed audit results; source/unit success does not waive them.
2. Reconcile the canonical service statements below in the context repository.
   Keep that foreign repository read-only in this task.
3. Integrate server PR486, then PR489 onto the server release branch. Revalidate
   their combined assignment/publication and immutable receipt contracts.
4. In a separately authorized server rollout, apply
   `20261008090000_driver_stop_completion_receipts` before running PR489 code.
   Assess the additive indexes' lock window. Verify event POST, assigned-route
   payment/completion reads and account receipt lookup on the deployed revision.
   The migration must not rewrite historical orders or legacy completions.
5. Integrate app PR297 into `dev`, then retarget/revalidate PR299 against the
   integrated predecessor and integrate PR299. Preserve the reviewed predecessor.
   Record final integration commits and rerun required final-SHA CI.
6. Verify that the selected AAB corresponds to the approved source and dependency
   set. If integration changes candidate content, build and test a new numbered
   artifact. Never label an earlier artifact as built from a different SHA.
7. In a separately authorized publication, upload the one verified AAB to Play
   internal testing. Complete exact-artifact acceptance and store review. Promote
   that same AAB to production; do not rebuild between tracks. The absent EAS
   submission credential requires the established authorized Play Console path
   or a separately configured submission credential.
8. Update release discovery through the established Google Play release process
   only after availability is verified. Confirm package, latest version and
   install destination through both public manifests. Preserve the minimum
   supported code unless separately approved.
9. Keep the new flow OFF. Enabling the KFood/v2 flow is a separate reviewed rollout
   after backend migration, server deployment and app adoption are proven. This
   preparation does not turn the QA opt-in into an operational setting.

For rollback, disable the app opt-in before an old backend can accept and ignore
its new field. Retain the additive receipt table and accepted immutable records.
Do not downgrade stored money to legacy events, drop receipt records, or replay
collection with new event IDs. Build success is not evidence of activation.

## Prepared canonical service-context delta

Read-only baseline: remote `clever-context-monorepo/main` commit
`1d0e0ce18699f4dcba95f965090a9f6c741fe2bf`, service file blob
`a39d60642f57a44068d8b09cd2919bd94ce5686a`.
The canonical service pointer still says payment collection is entirely
read-only. It also lacks the explicit KFood Dispatch/Apply exception.
The following replacement/additions are ready for a separate context change.
They contain durable contract facts, not PR status, artifact hashes, machine
paths or runtime environment values.

Replace the existing **Stop payment collection context is read-only** bullet with:

> The paired delivery API owns payment-method classification, expected balance
> and currency. The app displays those server values. A disabled-by-default,
> KFood/v2-only completion opt-in permits one delivery-completion action with an
> exact decimal actual-Cash amount when the server requires Cash input. The app
> does not synthesize arrival events, calculate the expected balance, change an
> order payment state, approve settlement or infer an unknown currency.

Add after that replacement:

> The completion input is top-level in the existing driver event contract.
> The app persists its original event ID, occurrence time, assignment generation,
> publication version and actual amount before transport. Exact retries preserve
> that request. A matching accepted completion or account-scoped APPLIED receipt
> confirms collection; UNKNOWN and APPLIED without a matching completion cannot
> erase it. Input errors, conflicts, account changes and reassignment preserve
> unresolved evidence for review.
>
> The first accepted completion is the historical payment snapshot. Completed
> stop views use its expected, actual and difference values, including actual
> zero, instead of recalculating from current order data. Existing optional notes
> and photos remain optional unless a separately defined proof policy applies.
> No photo/signature settings or settlement authority follow from this contract.
>
> For enrolled KFood routes, Dispatch publishes immutable route changes. A
> refresh stages them; the driver explicitly applies the publication. Apply
> preserves scoped notes, photos, Cash drafts and accepted completion records.
> The paired API retains assignment/publication authority. Unchanged stop events
> may retain their original publication under the same assignment when the
> server permits it; changed stops and obsolete assignments remain blocked.
>
> Backend receipt schema and contract deployment precede client activation.
> Rollback disables the client opt-in first and preserves accepted receipts.
> Native acceptance, dependency audit, signing and publication remain separate
> release evidence outside this context pointer.

Add stable contract pointers for the app's
`docs/kfood-single-completion-cash.md`, the server's
`docs/api/kfood-single-completion-cash.md`, and the existing live-change contract
when those documents reach the canonical branches. Do not add PR histories to
wiki or imply that these Draft changes are deployed.

Verified target directory for the separate context edit:
`/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/00_CLEVER_Agent/clever-context-monorepo`.
No foreign file was changed and no other chat was contacted.

## Preparation checks and handoff

- Identity declaration diff contains only version updates; dependency entries remain unchanged.
- Native release preflight: seven checks passed after version preparation.
- [Designated-device native acceptance](kfood-pr299-native-acceptance-20261008.md):
  current/future completion, Cash amounts, eTransfer, native process loss after
  server commit and offline SQLCipher persistence passed. Supplemental cases and
  the later device-occupation interruption are listed separately.
- Source version and documentation assertions: passed within the complete
  workspace run after the release-readiness source version was updated.
- `npm run check:workspace`: 1,142 tests / 119 suites passed, 0 skipped; source
  layout and TypeScript checks passed. Log: `checks/workspace-candidate41.log`.
- `git diff --check`: passed for the identity changes.
- Fresh `npm run lint`: passed with zero errors and three existing
  `react-hooks/exhaustive-deps` warnings in `AppRoot.tsx` at lines 2788, 3435 and
  3533. Log: release-ready artifact `checks/candidate-preparation-lint.log`.
- Fresh `git diff --check`: passed for the working-tree diff. Log: release-ready
  artifact `checks/candidate-preparation-diff-check.log`.
- Initial version/signing/Firebase inspection was read-only. The subsequent
  EAS production build reserved versionCode 41 and uploaded the committed source
  for a build only. No store/APK publication or server mutation occurred.
- The final PR-head CI result is recorded in PR299 and the private final manifest.
  The dependency audit remains failed; native/unit/build success does not waive it.

## Built candidate verification

The AAB was built from committed source `985f999ad2c4f9354ff2c856174e4542410c6554`
using the existing EAS `production` profile (`STORE`, remote credentials).
Subsequent evidence-only commits do not change its build source identity.
The binary is retained under the private release-ready artifact directory.

| Check | Result |
| --- | --- |
| Package / version / debuggable | `com.evnsolution.clever.routes` / `1.3.5` / `41` / `false` |
| Bundle structure | `bundletool validate` passed |
| Upload certificate | SHA256 `55c14543e167a55efe4f0153c9fee0e52d2fd3ae567a255356c40aee8893ee48`; matches EAS and Play Console |
| Signed entries | JAR integrity verified; Java JarFile verified all 1,421 content entries, with zero unsigned or mismatched-signer entries |
| Embedded runtime endpoint guard | Passed: canonical production origin occurs once; localhost8443/8445 forbidden origins absent |
| Embedded JS bundle SHA256 | `2f7f4a08653b1db8157c860ab0a83a1e5172e89c80c60e4608eebd1b353c3187` |
| Cash opt-in configuration | Configuration evidence passed: production profile and queried EAS production environment omit the flag; exact `true` is required by source and the embedded check |
| Physical acceptance | Isolated `.cashqa` package only; operating package retained |

JAR verification also reports a self-signed certificate, no signing timestamp,
unprotected POSIX metadata, and a JarInputStream manifest-order warning. These messages are retained in
`checks/eas-candidate-signing.json`; certificate matching, JAR integrity and
bundle structure are separate observations. No warning was suppressed.

The serialized flag initializer was not independently decoded. The production
AAB was not executed on a device, so this is not an observed operating-device
flag state.

Evidence files: `checks/eas-candidate-summary.json`, `checks/eas-candidate-manifest.json`,
`checks/eas-candidate-runtime.json`, `checks/eas-candidate-signing.json`,
`checks/eas-candidate-default-off.json`, and the EAS build record. This static
verification does not replace exact-artifact Play internal testing or authorize
installation over the operating app. No derived APK was installed.

The release remains blocked by the dependency audit and the documented server,
app-integration and store-acceptance sequence. The focused QA pass does not
replace the supplemental account/reassignment/Dispatch native checks listed in
the native acceptance record. Canonical service-context edits are prepared above
and remain outside this repository's write scope.
