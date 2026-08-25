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
| Candidate app source SHA | `ab59bacd26b93d9a788a589a1f1eed054760f797` |
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
- Confirm every server-acknowledged completion opens a durable clear-heartbeat
  outbox record keyed by account owner hash, route, assignment generation, and
  completion client-event identity. Never deduplicate or close by route alone.
  Close the exact record only after an accepted,
  non-conflicting server observation; restart, timeout, `401`, or session
  cleanup must leave it retryable. A `401` gets one bounded route-token refresh.
- Project an ACK-clear heartbeat from that exact outbox completion identity,
  never from the newest completion sharing the route ID. A newer pending,
  discarded, or acknowledged assignment must not change the older payload's
  `finishPending=false` or `lastAcknowledgedAt` evidence.
- Require the full refreshed route-access tuple to match the outbox route,
  assignment generation, and driver contract version before sending. A token
  from a reassigned generation must never clear an older completion.
- Treat the pre-existing server-ACK outbox row as write-ahead evidence. Bound
  the delivered-marker persistence step and reopen the row after timeout or
  storage failure while retaining the accepted server result for diagnostics.
- Process pending clear rows fairly across routes. A missing, overwritten, or
  expired token for one route must not prevent another route from attempting
  its independently resolved token.
- Retain an acknowledged completion indefinitely while its clear heartbeat is
  unsent. Start the 30-day terminal evidence retention window only at the
  durable `ACK_CLEAR_DELIVERED` timestamp.
- Confirm online completion hands the durable server acknowledgement to the
  heartbeat path before GPS cleanup, while cleanup failure and telemetry
  failure remain independently recoverable.
- Confirm logout, account change, and route-session change abort in-flight
  heartbeat transport, stop both heartbeat schedulers, clear displayed sync
  health, and reject late responses from the prior epoch. Do not rearm account
  transport until encrypted queue account binding succeeds, and recheck the
  captured account owner after every awaited outbox operation.
- Confirm heartbeat cadence is 60 seconds when healthy and 30 seconds when
  degraded. One central rolling limiter covers periodic, immediate-pending,
  clear-acknowledgement, and `401` retry calls and must reject any third write
  for the same route inside one minute.
- Confirm the interval between pending evidence and acknowledgement is at most
  five minutes for every pilot completion; any breach blocks expansion.
- Confirm app restart preserves both pending and acknowledged recovery state.
- Preserve the immutable ordered-event lineage saved with offline evidence.
  Receipt `UNKNOWN` replay after reassignment must submit the queued assignment,
  route-version, build, and client-event identity, never the current session's.
- Abort ordinary event replay and receipt lookup on logout or account change.
  Recheck the captured account owner and epoch before queue, session, or UI
  mutation so an account-A response cannot clear account-B state.
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
