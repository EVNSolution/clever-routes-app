# KFood single completion and Cash verification — 2026-10-08

This file preserves the implementation and F01/F02 review record. The later
release-readiness run completed the designated-device core acceptance; see the
[native evidence](kfood-pr299-native-acceptance-20261008.md),
[dependency findings](kfood-pr299-dependency-audit-20261008.md) and
[candidate/integration record](kfood-pr299-release-candidate-20261008.md).
The dependency audit remains failed. This Draft is not ready for release.

## Source and scope

- Target issue: `EVNSolution/clever-routes-app#298`.
- Change control: `EVNSolution/clever-change-control#316`; project start `#145`.
- Issue Development branch: `codex/kfood-single-completion-cash`.
- Reviewed app ancestor: PR297, `e2236e67efb8ece0bddfe5af503deb7fa77d4e6f`.
- Stacked PR base: `cc-314-kfood-live-change`. The explicit request overrides the
  normal `dev` base and `cc-` naming for this separate continuation.
- Server: PR489, `bd132f199c2a058d8e14fe33d97497307a51af45`, including PR486.
- Dispatch test adapter: reviewed Shopify source
  `e3f5a2a9819cb0ddd58766912b8ff31de2c759ae`, read only.
- Server and Shopify product sources, PR297 checkout and PR297 head were preserved.
- No merge commit. Branch and linked issues remain open while the Draft is open.

The app-local [service contract](../kfood-single-completion-cash.md) describes the
default-OFF opt-in, exact decimal money, receipt semantics and rollback boundary.

## PR299 review fixes

The review baseline was `89145807d1b02ba1c6e84cb9c39b24ed175babda`.
This follow-up keeps the same branch and Draft PR299.

- **F01:** ordered-event blocking no longer blocks independent GPS and another
  stop's photo after Cash input errors, legacy quarantine or transient failure.
  Receipt lookup still runs first. Route-end and assignment blocks survive
  retry and persistence; authoritative replacement assignments can send their
  own evidence. Old-generation GPS and photos remain quarantined.
  The original reproduction now sends both independent items, matching PR297:
  `succeeded=2, pending=1`, versus the reviewed regression's `0, 3`.
- **F02:** a different stop requires the existing order confirmation before
  collection or completion. Cancel has no event, Cash popup or progress write.
  Confirming B leaves incomplete A next. Current eTransfer completes directly;
  current Cash needs only its amount popup. No arrival event is added.
- Added 14 queue regressions and 5 actual-handler behavioral tests. The UI tests
  execute the extracted request, Cash-confirm and terminal handlers and the Cash
  cancel callback; they do not claim rendered-screen evidence.
- Focused queue/proof checks: 119 passed. Focused UI regressions: 103 passed.
  Independent final diff review found no remaining actionable F01/F02 issue.

## Local checks

| Check | Result |
| --- | --- |
| `npm run check:workspace` | Passed: source layout, TypeScript, 1,142 tests / 119 suites, 0 skipped |
| `npm run lint` | Passed: 0 errors, 3 pre-existing `resetRouteProgress` hook warnings |
| `npm run check:native-release` | Passed: all 7 checks |
| `npm run build` | Android and iOS Hermes exports passed with production default opt-in OFF |
| `EXPO_OFFLINE=1 npx expo install --check` | Installed SDK alignment passed; remote registry validation excluded |
| Isolated arm64 QA APK | `app:assembleQa` passed, 834 tasks (24 executed / 810 reused), 34 seconds on final runtime source |
| Actual HTTP and PostgreSQL | 12 checks passed; 11 exact committed receipts; no `STOP_ARRIVED` |
| Android artifact endpoint guard | 5 tests passed, including rejection of mixed production/Cash QA origins |
| Script syntax / `git diff --check` | Passed |
| `npm audit --audit-level=moderate` equivalent JSON audit | Failed: 20 High / 0 Critical; no lockfile or threshold change |

Final-SHA CI is dispatched after the commit. Its actual run URL and outcome are
recorded in the PR. Local passing checks do not imply CI or dependency-security success.

Audit findings propagate from `braces` GHSA-vfj7-8cjw-p6xm and `node-forge`
GHSA-86w9-cpqp-85rv. The task neither suppresses these findings nor changes the
release threshold. Compatible fixes remain a separate integration gate.

## Functional and recovery evidence

[Sanitized actual HTTP results](kfood-single-completion-cash-http-20261008.json)
use the real app clients, queue, server handlers, migrations and temporary
PostgreSQL. They cover:

- Cash 122 / 122.25 / 123 / 0 against expected 122.25, exact stored difference,
  missing amount rejection, double submission and identical retries.
- eTransfer, paid, unknown method, unknown balance, unknown currency and missing phone.
- Top-level completion only; no synthetic arrival; server-owned expected amount.
- A later order amount cannot replace the original receipt.
- Missing completion on successful POST or APPLIED receipt does not acknowledge
  the original request. Removing the transport fault recovers the receipt.
- Offline/503 persistence and queue recreation keep the original ID, occurrence
  time, assignment, publication and actual amount.
- Actual currency-input 400 and assignment 409 retain the original. No legacy
  fallback or repeated invalid POST is used.
- Post-commit response hold confirms one event and one receipt. Socket
  interruption plus queue recreation recovers through the account receipt API
  without another POST. **This is not native process termination evidence.**
- Dispatch remains pending until explicit Apply. Existing notes/photo drafts
  and immutable receipt data survive. Other-account receipt reads are rejected.

Regression tests first reproduced and then verified fixes for dropped completion
fields, exact money persistence, missing encrypted replay data, mutable event
snapshots, UNKNOWN responses with absent lineage, ordered replay after receipt
lookup, account-only recovery without route access, and per-item receipt errors.
The proof queue retains PR297's existing object and upload-key behavior.

SQLCipher storage tests exercise the store boundary with its test database
adapter. They verify receipt/ACK persistence, restart, corrupted-body failure,
owner isolation and pending retention. They do not establish physical SQLCipher
lifecycle behavior. PR297's historical released-shared-object failure remains
unverified on this new APK.

The UI policy/source tests cover default OFF and missing-contract gating, empty versus zero,
decimal input, Cash cancellation, direct noncash completion, old product paths,
notification completion, protected Cash/note/photo input and receipt rendering.
No mandatory photo/signature policy exists in the paired contract. No proof
ON/OFF settings UI is implemented or claimed.

## APK and physical-device boundary

| Field | Value |
| --- | --- |
| Package | `com.evnsolution.clever.routes.cashqa` |
| Version | 1.3.4 / 40 |
| ABI / debuggable | arm64-v8a / false |
| API | `https://localhost:8445`, supplied public QA CA |
| Embedded production API occurrences | 0 |
| APK SHA256 | `31a4f4c0a6b5ab3193720f15778a955ac8a727273295710f49178f1e16253d66` |
| Embedded bundle SHA256 | `c360be2922e71908ca3d6db4a9dc5ada20a699e448c111580677a021a9cd9a60` |
| Android Debug signer SHA256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Runtime source SHA256 | `63d801dace92294a283deafa4efa5d53bae535930ee583648182f55c946685a6` |

The runtime digest hashes sorted `src` paths and file hashes, excluding test
files. The external final-HEAD manifest binds the commit, source and APK after
commit; a commit cannot contain its own hash.

This review run queried only `R3CN80SCYPL`, using read-only ADB calls.
At `2026-10-08T10:58:01Z`, the foreground activity was
`com.evnsolution.clever.driver.integration/.MainActivity` (PID 6533).
The device was therefore unavailable. No install, launch, force-stop, reverse
change, screenshot, UI interaction or app-data change was performed in this run.
No emulator or AVD was used. The new APK is built locally and is **not installed**.

The existing Cash QA package remains 1.3.4/40 with installation/update time
`2026-10-08 18:15:57` on the device. It belongs to the previous reviewed build.
The read-only occupancy evidence is in the private review artifact directory as
`device-occupancy.json`; it is not functional screen evidence.

Historical boundary: the original implementation run briefly installed/launched
Cash QA after a compound preinstall command revealed another foreground app.
That run immediately stopped Cash QA and removed its own reverse. This follow-up
keeps occupancy checking separate and makes no device mutations. The prior
operating and QA packages remain outside this work.

**Historical outstanding list at this review:** single-button/details/Cash/difference/
eTransfer/missing-phone screens; zero, cancellation and optional-input behavior;
offline/restart/account/assignment recovery; server commit followed by native
process kill before response or retry, then original receipt recovery; relevant
PR297 Dispatch/input/GPS and SQLCipher lifecycle acceptance.

The later [core native pass](kfood-pr299-native-acceptance-20261008.md) and
[remaining native pass](kfood-pr299-native-remaining-20261008.md) supersede this
Cash acceptance list. They preserve the original records and distinguish the
isolated QA package from exact-artifact store acceptance and wider PR297 gates.

Owned local fixture, temporary database and reverse port were stopped/removed.
APK, TLS files, logs, reusable build caches and recovery scripts remain private at
`/Users/jiin/.codex/artifacts/kfood-pr299-review-fixes-20261008`.
The earlier TLS/recovery assets remain in `kfood-app-cash-20261008`.
The first build revealed AGP did not honor the CMake parallelism environment
alone. Final Cash QA uses explicit Ninja compile pools of 2, link pools of 1,
two Gradle workers and a 2GiB JVM heap. These are per-tool limits, not measured
total memory usage. No owned transient build processes remained after validation.

## Context and remaining integration work

App-local service context is updated. Canonical service context still describes
payment collection as read-only, so it requires a separate change before
integration. No PR history was added to wiki. Issue close is not applicable to
an unmerged Draft. The explicit stacked request preserves the ancestor while
other open build/map/GPS issues remain outside this change.

Target directory:
`/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-agent-workspace/clever-context-monorepo`

```text
Update clever-routes-app service context for the reviewed KFood single completion
and immutable first Cash receipt contract. Read the app's
docs/kfood-single-completion-cash.md and the PR489 server contract at bd132f199.
Record default-OFF KFood/v2 opt-in, exact actual-money submission, account receipt
recovery, original-request retention, backend-first rollout and rollback order.
Keep native acceptance and audit failures explicit. Do not record PR history in
wiki or imply deployment. Validate documentation links and affected statements.
```

No production migration, feature activation, deployment, store upload or operating
app replacement occurred. The subsequent QA native passes are linked above.
Dependency audit, canonical context, integration and exact-artifact store
acceptance remain prerequisites for a release decision.
