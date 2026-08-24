# Driver 1.2.0 pilot source runbook

This record identifies a source-only pilot candidate. It is not a signed,
built, uploaded, or published mobile artifact. Any later artifact must be
authorized separately and tied back to the exact committed source SHA.

## Candidate manifest

| Field | Value |
| --- | --- |
| Driver issue | `EVNSolution/clever-routes-app#210` |
| Change control | `EVNSolution/clever-change-control#265` |
| Source branch | `codex/cc-265-driver-pilot-identity-telemetry` |
| App version | `1.2.0` |
| Android version code | `18` |
| iOS build number | `1` |
| Driver contract version | `2` |
| Publish authorized | `no` |
| Signing performed | `no` |
| Artifact built | `no` |
| EAS/store/Drive operation | `not-run` |
| Server mutation or deployment | `not-run` |
| Synthetic data only | `yes` |

## Pilot acceptance gate

- Confirm `finishPending=true` is emitted from durable `ROUTE_COMPLETED`
  queue evidence immediately after the completion enters pending state.
- Confirm the durable receipt acknowledgement changes the next immediate
  heartbeat to `finishPending=false` and supplies `lastAcknowledgedAt`.
- Confirm the interval between pending evidence and acknowledgement is at most
  five minutes for every pilot completion; any breach blocks expansion.
- Confirm app restart preserves both pending and acknowledged recovery state.
- Confirm a missing route session without durable completion evidence never
  reports a false local finish or acknowledgement clear.
- Calculate adoption from server-observed contract-v2 heartbeats divided by
  distinct active pilot drivers; require at least 95% before expansion.
- Use only hashed device identity and route-scoped identifiers in telemetry.
  Do not add phone numbers, customer data, addresses, notes, coordinates,
  access tokens, or proof-media content.

## No-publish procedure

Run source tests, typecheck, lint, Expo export, native preflight, dependency
audit, Expo dependency alignment, and a clean diff review. Stop there. Do not
run EAS, Gradle signing/distribution, store submission, Drive upload, the
Android publisher command, or any server mutation from this candidate branch.
