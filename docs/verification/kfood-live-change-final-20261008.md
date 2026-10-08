# PR297 follow-up verification — 2026-10-08

Issue: EVNSolution/clever-routes-app#296. Change control: EVNSolution/clever-change-control#314.
Branch: `cc-314-kfood-live-change` → `dev`. PR297 stays draft and unmerged.
The starting implementation is `309ef4dd4fdc3532d597274f2486b55e8d2f66a5`.
Reviewed inputs are server PR486 `9bd6e7b8408508c83b1e4255a62c37ee9b983bf0`
and Shopify PR328 `e3f5a2a9819cb0ddd58766912b8ff31de2c759ae`.

## Dependency security

| Package | Change | Advisory | Status |
| --- | --- | --- | --- |
| compression | 1.8.1 → 1.8.2 | [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) | Compatible published fix |
| shell-quote | 1.10.0 → 1.11.0 | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | Compatible published fix |
| source-map-js | 1.2.1 → 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | Compatible published fix |
| braces | 3.0.3 retained | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | No published patched version |
| node-forge | 1.4.0 retained | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | No published patched version |

The remaining paths include Expo/React Native → Metro → metro-file-map → micromatch → braces,
and Expo CLI/code-signing-certificates → node-forge. Braces can exhaust resources while
parsing nested expansion input. Forge can accept malformed RSA PKCS#1 v1.5 signatures.
Neither finding is treated as a verified exploit in the driver runtime. Both remain
dependencies in the build/tooling graph and fail the existing audit gate.

The fresh audit changed from 18 high/6 critical affected packages to 20 high/0 critical.
These counts include propagated dependency findings. Two distinct root advisories remain.
`npm audit --audit-level=moderate` still exits 1. Expo 57.0.21 and React Native 0.86.3
remain unchanged. The three fixes satisfy the parents' existing semver ranges.
Only the former node_modules symlink was removed. The main checkout was preserved.
The worktree now uses independent installed dependencies.

No audit command, severity threshold, package metadata or advisory was suppressed.
`npm audit fix --force` was rejected because its proposed Expo/RN downgrades violate
the SDK constraint. Passing CI requires compatible patched upstream releases or a
separately verified compatible parent replacement.

Raw audit, registry/advisory snapshots, dependency paths and installation logs are retained
under `/Users/jiin/.codex/artifacts/kfood-pr297-final-20261008/security/`.

## Isolated native QA environment

The Android QA variant uses `com.evnsolution.clever.routes.qa`, version 1.3.4/40,
the Android Debug signing key, and the launcher label `CLEVER Routes QA`.
The QA variant does not register the production Firebase project or production deep links.
It uses `https://localhost:8443` over `adb reverse tcp:8443 tcp:8443`.
TLS verifies a local certificate with localhost/127.0.0.1 SANs. The public certificate
is trusted only for localhost in QA resources. Private keys remain outside Git.
Release resources keep their existing trust configuration.

Create a local certificate/key outside the repository. Then build:

```sh
node scripts/build-kfood-native-qa.mjs /absolute/path/to/local-qa-cert.pem
```

The wrapper ignores `.env`, fixes the loopback API origin, bundles the actual app,
and uses two Gradle workers without parallel project builds. It does not install or publish.
The JVM heap remains 2048 MiB from the existing Gradle properties. The CMake parallel
environment request is distinct from the Gradle worker bound; it is not a whole-build limit.

The native fixture uses exact reviewed source snapshots and independent server dependencies.
It creates its own temporary PostgreSQL database, synthetic phone/PIN accounts and seven-stop
KFood route. The actual reviewed authentication, consent, session, route, event and live-change
repositories handle native requests. The actual Shopify BFF performs local Save/Dispatch.
Only loopback HTTPS control requests with a per-run bearer token can change the fixture.
Providers and real notifications are absent. Shutdown removes the temporary database.
Proof uploads use the reviewed Prisma service with temporary synthetic filesystem
storage. This validates reservation, byte storage, commit and retry locally. It does
not validate cloud storage, physical camera input, or a real provider.

```sh
node scripts/kfood-native-qa-server.mjs \
  /absolute/path/to/server-9bd6e7b8 \
  /absolute/path/to/shopify-e3f5a2a9 \
  /absolute/path/to/local-qa-cert.pem \
  /absolute/path/to/local-qa-key.pem \
  /absolute/path/to/native-api-evidence.json
```

## Final results

### Defects corrected

- Scope camera/gallery/upload completion to its initiating owner, route, assignment and stop. Keep captured input in that owner's encrypted cache.
- Clear old uploaded media when selecting a different photo. Quarantine old/unknown V2 proof generations before upload.
- Serialize all operations on each SQLCipher connection. Drain transaction operations before rollback and close.
- Restore a cached applied KFood route after a typed fetch transport failure. Keep HTTP/auth/schema failures outside this fallback.
- Preserve saved proof inputs when reopening the restored route. Keep native tracking and evidence replay behind authoritative assignment validation.
- Reject evidence token refresh into a different route/generation/contract before persisting credentials or projecting a new assignment.
- Revalidate a cached active route before replay/ACK and native location-service restart after reconnect. Defer validation during camera actions.
- Inject the missing fixed clock in the existing dated diagnostics test. Runtime diagnostics policy is unchanged.

The native recovery run reproduced `ERR_USING_RELEASED_SHARED_OBJECT` during parallel database access. Connection serialization eliminated the reproduced failure in later runs. This is local evidence, not proof of an Expo upstream root cause. No SQLite version change was made.

### Native acceptance boundaries

The dedicated Android emulator runs API 35/Android 15, arm64, 1536 MiB RAM and two CPU cores. It uses the separate QA package and actual React Native screens. The server uses synthetic data only. Native API results and selected screenshots are recorded in [sanitized native evidence](kfood-live-change-native-20261008.json) and its image directory. All selected native screenshots use the final frozen runtime after the cached reconnect correction. Permissions were granted to the QA package before this rerun. The 2026-10-07 evidence remains historical.

| Scenario | Observed result | Evidence boundary |
| --- | --- | --- |
| Save future stop 7 address/order while stop 2 is current | No pending notice or list replacement before Dispatch | Actual native app + reviewed local Shopify BFF |
| Dispatch and pre-Apply list | Persistent notice; original list, stop 1 Done, stop 2 Current and cash amount retained | Native screen and real API |
| Apply N, publish N+1 during ACK, lose ACK response | ACK carries exact N/generation 2; retry keeps N; N+1 stays pending | Native screen and recorded requests |
| Existing photo and notes | Apply blocked during camera/completion. Selected synthetic photo and both notes survive process restart | Native optional camera/input; no new proof policy |
| Offline process restart | Encrypted applied route and pending notice restored without data reset | Force-stop/relaunch of QA package only |
| Proof storage 503 then reconnect | Original upload retries; one READY photo row and matching stored bytes/hash | Real Prisma proof service + temporary local storage |
| Completion response loss | Exact STOP_DELIVERED request repeats; first 202 then duplicate 200; one row for client event ID | Actual native queue and reviewed event API |
| Same route first→second→first | Generations2→3→4; old account loses route; old drafts do not enter second or new first assignment | Native sign-out/login and synthetic reassignment |
| READY and DSV | Native seven-stop selection/start/pickup reaches stop 1; no live-change notice | Existing generic route flow smoke; separate synthetic accounts |
| Background location | Cached reconnect validates the account and assignment, then starts LocationTaskService. Home records 15 LOCATION_UPDATED events over 147.96 seconds | Android emulator only |

The recovered proof file is 11,355 bytes, SHA256 `540be3f70fbf394715b7b7e4bde806cb0071a645c06b8ce74d1e22a51b2acb2c`. Server media `b4b4759e-abb3-4169-833a-e13ec4c369cc` is READY and linked to the original route/stop. Queue retry currently does not project the returned media ID into completion metadata. The completion payload retains the local photo URI, as it did at the starting SHA. This record does not claim that STOP metadata included the media ID.

The lost completion response used client event ID `stop-delivered-muyy6gul`. Both attempts carry the identical original request, including occurrence time, route version, generation and proof. The seed stop 1 completion is a separate row. Native ACK and completion retries finished immediately before any subsequent restart. Native process termination between response loss and retry remains unverified. The actual HTTP integration separately recreates the store for lost-ACK recovery.

The offline cold restart restored the cached route and notice without resetting QA data. The stable photo/notes screenshot was taken after reconnect. The cached route cannot replay evidence, ACK a publication or start native tracking until authoritative assignment validation succeeds.

The final private encrypted database copy is 184,320 bytes. It has no plain SQLite header. Native READY and DSV each recorded ROUTE_STARTED and PICKUP_COMPLETED with status 202, then displayed stop 1. These checks do not cover every DSV product operation.

### Checks and artifact provenance

Final check results and the final-HEAD QA APK manifest are retained in the private artifact directory. The committed API evidence includes a SHA256 digest of the `src` tree. A final commit cannot contain its own SHA; the PR result and external APK manifest record that association. Native screenshots record the tested source digest and APK hash. Documentation-only changes do not alter the native source digest.

| Final frozen-source check | Result |
| --- | --- |
| `npm run check:workspace` (layout, typecheck, tests) | 1,054/1,054 tests passed; zero skipped |
| `npm run lint` | Passed; zero errors, three existing `resetRouteProgress` warnings |
| `npm run check:native-release` | Seven checks passed |
| `EXPO_OFFLINE=1 npx expo install --check` | Passed against installed SDK; offline validation caveat applies |
| Android and iOS exports | Passed with explicit localhost test origin |
| Actual local HTTP integration | 10/10 passed; reviewed Shopify/server sources unchanged |
| QA native `assembleQa` | Passed; 39.1 seconds, 834 tasks (24 executed, 810 up-to-date) |
| `npm audit --audit-level=moderate` | Failed; 20 high/0 critical propagated findings from two root advisories |
| `git diff --check`, QA script syntax | Passed |

The frozen source tree digest is `9eb86a1562920174046a8f903e3ef5c3d77c1f4529d51a09ba6f62f99abe8986`. The QA APK tested after the reconnect fix has SHA256 `78026c97382701fd7b276f1fdb352c9778566666dd63d2c6bfd08362aeac984c`. Final-HEAD build/remote CI provenance is reported on PR297 and in the external `final-head-apk-provenance.json`.

The first full run failed one existing source-wiring assertion after the awaited account lookup moved into the cached-recovery callback. The revised assertion checks receipt recovery before cached hydration and account lookup. The full rerun passed. No completion-receipt runtime ordering was removed.

Security remains failed. The final remote CI result is linked from PR297; audit is retained at its original threshold. Later Expo alignment/whitespace CI steps can be skipped after that failure; local results are recorded above.

## Scope and remaining integration work

No operating driver app was removed, replaced or reset. No merge, deployment, store
publication, production data/provider use or office feature activation is authorized.
The canonical context still describes general push refresh; the KFood explicit Apply
exception remains a separate context follow-up before integration. Live authenticated
Shopify embedding also remains separate. Physical camera, real push and OS background
GPS acceptance require a dedicated real test device and test provider credentials.
An emulator does not establish physical-device acceptance.

### Physical-device interference

KFood QA installation and launch on the shared Samsung SM-N981N overlapped DSV camera
verification. DSV recorded the KFood QA package in the foreground at 10:27:19 and
10:28:16 KST. The KFood command batch at 10:28:30.355–10:28:38.185 failed to find its
phone and Continue controls but still sent text and Back. Back is a likely cause of
the DSV modal dismissal. There is no per-input lifecycle trace proving exact causality.
The affected physical interval is excluded from KFood acceptance. DSV Case D results
are not reused as KFood evidence.

DSV used proxy 4910 → API 4908 and separate PostgreSQL/storage. KFood used HTTPS 8443,
a separate package, and temporary KFood PostgreSQL/storage. Port takeover and shared
data mutation were not found in the inspected records. Existing Routes 1.3.3/39 and
DSV integration 0.1.15/26 install times and versions were preserved. The local QA
UI tool now rejects input on every device except the dedicated KFood emulator.
The private cross-check is retained in the artifact root as `overlap-review.md`,
`physical-own-actions.json` and `physical-command-failure.json`.

## Foreign follow-up prompts

Canonical context target: `/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/00_CLEVER_Agent/clever-context-monorepo`.

> Update the clever-routes-app service context with the KFood explicit Apply exception. Use PR297's app contract and reviewed server `9bd6e7b8` and Shopify `e3f5a2a9`. Explain persistent notice, exact version ACK, cache/assignment isolation and publication-gated rollout. Keep general READY/DSV behavior. Record service context only, without PR history in wiki. Verify existing policy references and document links. Do not deploy or activate features.

Shopify target: `/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-shopify-app`.

> Complete authenticated embedded Shopify acceptance for PR328 at e3f5a2a9 against the reviewed server contract `9bd6e7b8`. Use a separate test shop/session and synthetic route. Verify Save privacy, Dispatch publication, iframe authentication and address/order UI. Keep office activation disabled. Do not merge, deploy, notify real customers or modify production data. Record actual browser evidence and remaining conditions.
