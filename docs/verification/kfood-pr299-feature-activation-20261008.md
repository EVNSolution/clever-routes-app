# PR299 feature activation conditions — 2026-10-08

The signed **1.3.5 / 41 candidate is OFF**. Publishing that AAB would not enable the new Cash flow. Preserve it unchanged. This record defines a later ON candidate; it does not enable a flag, reserve a version, build, merge, deploy, or publish anything.

App source inspected: `757baefff29f3e7afef800d0fd080df1fad721d8`. The signed OFF artifact was built from `985f999ad2c4f9354ff2c856174e4542410c6554`; its SHA-256 is `3c620a406c54e7bf8af0b9d1f1c2b0bbd7a682daa0252d30fa1986e67313b789`. See [candidate provenance](kfood-pr299-release-candidate-20261008.md).

## Existing app gate

All conditions below must hold. The flag alone is insufficient.

| Condition | Existing source and behavior |
| --- | --- |
| Explicit flag | `EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA` must equal the literal string `true`. Unset, `false`, and `1` are OFF. |
| Live runtime | `EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live` and a nonempty HTTPS `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL`. Mock mode always disables this flow. |
| KFood scope | Selected route `shopDomain`, trimmed and lowercased, equals `7hrud1-xq.myshopify.com`. |
| Route contract | Current route-access identity has `driverContractVersion === 2`. |
| Server payment | The delivery stop has a valid parsed `payment` object. Legacy omission/null does not enable support. |
| Delivery action | The stop is not Store Pickup. Submission additionally requires the active route, finished start recovery, and an incomplete stop without an accepted or pending completion. |
| Cash input | The server sets `payment.requiresCashInput=true`. Cash confirmation needs a valid nonnegative decimal amount and a known source currency. Other methods use the same completion contract without Cash input. |

Source: [runtime configuration](../../src/app/config/driverRuntimeConfig.ts), [feature predicate and Cash input](../../src/app/kfoodSingleCompletion.ts), [route and submission guards](../../src/app/AppRoot.tsx), and [payment parser](../../src/domain/stop/stopCompletion.ts).

No product-code change is needed to exercise this existing gate. The current flag is deliberately named as a QA opt-in. Using it for a release needs an explicit reviewed rollout decision and a recorded build configuration. Do not silently change the general `production` environment or imply that the QA name is already an operational rollout policy.

The predicate has **no package, driver-account, or percentage rollout gate**. An ON installation enables every route that meets the table. Select the installation cohort through the approved distribution plan. A finer cohort or remote kill switch would require separate scope and implementation.

## Server readiness precedes ON

The paired server contract is [PR489 source at bd132f199](https://github.com/EVNSolution/clever-route-server/blob/bd132f199c2a058d8e14fe33d97497307a51af45/docs/api/kfood-single-completion-cash.md). It builds on PR486 `9bd6e7b8408508c83b1e4255a62c37ee9b983bf0`. App-local fixture success proves that pair in a disposable environment. It does not prove either revision or its migration is deployed at the intended API origin.

Required server evidence:

1. **Integrated and deployed revision.** Record the release commit/image digest and deployment result for the target environment. Verify it includes PR486 followed by PR489, or reviewed equivalent commits. Confirm all serving instances use compatible code. A PR merge, HTTP 200, release-manifest version, or app `payment` field alone is insufficient.
2. **Migration before code.** The server owner must provide successful application of `20261008090000_driver_stop_completion_receipts` before PR489 code serves traffic, with the index lock window assessed. Include preceding PR486 schema requirements. No app-side migration can substitute for this proof.
3. **Read-only schema verification.** An authorized server operator can read `_prisma_migrations` for a non-null `finished_at` and null `rolled_back_at` for that migration. Compare PostgreSQL catalog metadata with the reviewed migration: `driver_stop_completion_receipts`, unique event/client-event/stop constraints, composite tenant foreign keys, `driver_stop_completion_receipts_amount_check`, `driver_events_id_shopId_key`, and enabled `driver_stop_completion_receipts_immutable` trigger. Table existence alone is insufficient. Do not mutate a production receipt to test the trigger.
4. **Authenticated read contract.** Use the GET checks below against the actual target origin. Keep bearer tokens and customer data out of evidence. Record only environment, deployed revision, status, schema assertions, and synthetic or redacted identifiers.
5. **Transaction and retry proof.** Run the bounded synthetic write check below only in separately authorized staging/disposable infrastructure with the same server artifact and migration. Link its result to the target deployment provenance. Do not create a production completion merely to test readiness.

| Read-only request | Credential | Required observation and limit |
| --- | --- | --- |
| `GET /driver/assigned-route` (with the existing route context when required) | Current route bearer | KFood route identity, parsed stop `payment`, and nullable/valid `completion`; exact decimal strings and source currency. The current v2 assignment/publication identity must come from the established route-access session. |
| `GET /driver/routes/:routePlanId/live-change` | Matching route bearer | PR486 publication/assignment shape where enrolled. `data: null` is valid for an unenrolled assignment and does not prove Dispatch/Apply acceptance. GET does not acknowledge Apply. |
| `GET /driver/event-receipts/:routePlanId/:clientEventId` | Original driver's account bearer | For an existing authorized v1 completion, `APPLIED` contains the immutable matching `completion`, original time, assignment/version, amount, and event identity. `UNKNOWN`, including null lineage, proves neither successful storage nor safe deletion/replay of a pending request. If no accepted receipt exists, keep this proof unavailable rather than writing production data. |

The app has no separate server-capability handshake. Assigned-route payment support is necessary, but cannot establish that completion writes, receipt lookup, and deployed schema all work. Existing authorized reads may corroborate deployment; authenticated 401/403/404 responses or missing suitable routes are evidence gaps, not permission to weaken a gate.

For a staging transaction check, use a synthetic KFood/v2 active route and retain one UUID, occurrence time, assignment, publication, and exact request body. Submit `STOP_DELIVERED` with top-level `completion.version=1` and Cash `122.00` against expected `122.25`. Require HTTP 202 with matching immutable completion and difference `-0.25`. Repeat the identical request: require HTTP 200, `duplicate=true`, the same event/receipt, and one persisted event/receipt. Account-token GET must return that same `APPLIED` result. A changed amount with the same ID must conflict without replacing the receipt. Preserve the existing PR486 assignment/publication and explicit Apply checks. Reuse [actual HTTP acceptance](kfood-single-completion-cash-http-20261008.json) and [native acceptance](kfood-pr299-native-acceptance-20261008.md) where the source/config remains equivalent; they do not replace target deployment proof.

## App integration and later candidate

Server integration and app integration are separate gates:

- Server: integrate PR486 → PR489, apply the additive schema, deploy compatible code, and collect the readiness evidence above.
- App: preserve reviewed PR297 `e2236e67efb8ece0bddfe5af503deb7fa77d4e6f`; integrate PR297 → PR299 through the normal reviewed branches. Record the resulting app commit. Revalidate any integration or security patch delta and final-SHA CI.
- Release: complete the remaining security and native release checks. Use their final records rather than reclassifying fixture success as production readiness.

Freeze the final reviewed source and dependency set before preparing one later ON build. Record these exact settings in a reviewed candidate-specific build configuration:

| Build input | Required value |
| --- | --- |
| `EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA` | `true` |
| `EXPO_PUBLIC_DRIVER_RUNTIME_MODE` | `live` |
| `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` | The verified HTTPS target origin. For a later production rollout, the existing origin is `https://clever-route.cleversystem.ai`; use it only after the server readiness gate passes. |
| Source and signing | Exact final app commit, lockfile/config digest, normal operating package, and established EAS/Play signing identity. |
| Native storage | Preserve existing SQLCipher configuration and migration/recovery behavior. |

The `.cashqa` script intentionally builds a separate package against localhost:8445 and a local CA. Do not reuse that package, trust configuration, debug signer, or origin as the release candidate.

After final source/config approval, verify the next available store version once and reserve/build one immutable candidate. **Do not reuse reserved version 41 or relabel its OFF AAB as ON.** Inspect the final signed artifact for package/version/signature, embedded API origin, and ON configuration. Record the build environment digest with the source SHA: the same source can produce OFF or ON artifacts.

Follow the existing EAS AAB → authorized Play internal testing → same-AAB promotion process and exact-artifact acceptance. Preserve official publisher checks and the current Google Play release-discovery rules. Do not invoke the direct APK publisher as a substitute. This document performs none of those actions.

## Rollback constraint

`AppRoot` reads the public environment configuration once from the bundled code. The current implementation has **no remote runtime OFF switch**. Changing an EAS environment variable does not disable an already installed ON binary. Keeping the feature OFF on future builds also does not remove accepted or unresolved receipts from existing installations.

Before any later backend rollback, define and verify how affected ON clients will stop new v1 submissions through the approved client rollout/adoption path. Preserve the compatible backend while ON clients may still submit. Do not assume the saved OFF candidate can downgrade a newer installed version. Retain the additive receipt schema and records, and preserve unresolved original requests. Never convert Cash to legacy completion or regenerate its event ID.

The minimum activation decision is therefore: **verified compatible server and schema, integrated validated app source, explicit ON build configuration, and an approved distribution/rollback plan**. None is established by publishing the current OFF candidate alone.
