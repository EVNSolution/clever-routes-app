# KFood completion and first Cash receipt

This flow is an explicit QA opt-in. Production builds leave
`EXPO_PUBLIC_KFOOD_SINGLE_COMPLETION_QA` unset. It defaults to false.
Enabling the flow also requires the live runtime, KFood shop, driver contract v2,
and a valid server `payment` object. Old responses and caches do not establish support.

The server owns payment classification, expected balance and currency. The app
submits the actual received amount. It does not adjust the order, approve
settlement, or invent a currency or unknown balance.

## Driver flow

- A supported delivery has one **Complete Delivery** action. It does not create
  `STOP_ARRIVED` or an arrival timestamp. Start, pickup, route end and legacy
  product flows retain their existing behavior.
- Completing a different stop preserves the existing out-of-order confirmation.
  Cancel changes neither progress nor collection. Confirm completes only the
  selected stop and keeps earlier incomplete stops available. The current stop
  needs no extra order confirmation.
- Delivery details contain the address, customer, available call/message actions,
  order items, delivery instructions, payment and existing optional notes/photo.
  Missing phone numbers have no actionable call/message icons.
- `payment.methodTitle` names the payment method. Only the server's
  `requiresCashInput` opens the Cash input. Current eTransfer, paid and unknown
  stops have no extra confirmation dialog.
- Cash confirmation submits the actual amount and completion together. Empty
  input differs from zero. Decimal normalization uses strings, including
  `122` → `122.00`; no floating point conversion is used.
- Cancel creates no event or receipt and retains the draft in the current
  account/route/assignment scope. Unknown currency blocks Cash confirmation.
- Existing proof is optional under the current paired server contract. The
  contract exposes no mandatory photo/signature policy. This change adds no
  policy, signature capture, photo requirement or proof settings UI.

## Wire and persistence

The paired server contract is
[`kfood-single-completion-cash.md`](https://github.com/EVNSolution/clever-route-server/blob/bd132f199c2a058d8e14fe33d97497307a51af45/docs/api/kfood-single-completion-cash.md).
Its ordered-event assignment and publication checks remain authoritative.

```json
{
  "eventType": "STOP_DELIVERED",
  "completion": {
    "version": 1,
    "cashReceived": { "amount": "122.00", "currency": "CAD" }
  }
}
```

This fragment accompanies the original UUID client event ID, timestamp, stop,
route, assignment generation and expected publication version. `completion` is
top-level. The app does not submit `expectedAmount` or `differenceAmount`.
Noncollectible stops send only `{ "version": 1 }` in `completion`.

The queue persists the complete request before transport. SQLCipher replay data
retains the completion body and accepted immutable result. Retry uses the same
ID, time, amount, assignment and publication. Switching accounts hides another
account's data while retaining that account's unresolved request.

An accepted POST must return a matching completion. An account-token receipt
lookup can recover the original result after response loss or route-token
expiration. `APPLIED` without its matching completion does not acknowledge a v1
request. `UNKNOWN` is not evidence of failure or permission to discard it.

Input errors (400) and conflicts or reassignment (409) retain the original for
review instead of endlessly retrying or falling back to a legacy event.
Offline and transient server failures retain the original for retry. A pending
submission is shown separately from a server-confirmed receipt.
An ordered-event failure blocks later ordered events. It does not by itself
block independent GPS or another stop's photo upload. Actual route termination
and assignment restrictions retain their route-wide transport guards.

After acceptance, the UI displays the immutable completion's expected, actual
and difference amounts. Different amounts strike through the original expected
amount. Actual zero is visible; absent collection remains **Not recorded**.
Later source-payment changes cannot replace the historical receipt.

## Isolated physical QA

The Cash QA build uses `com.evnsolution.clever.routes.cashqa`, an explicit local
HTTPS origin on port 8445 and a supplied public QA CA. It does not share storage
with the operating package or the previous `.qa` package.

```sh
node scripts/build-kfood-native-qa.mjs /absolute/path/to/qa-cert.pem --cash
```

The fixture uses the paired server's real HTTP handlers, migrations and a
temporary PostgreSQL database. Its completion-response hold occurs after the
event and receipt commit. Native recovery evidence must kill the QA process
before releasing that response, then verify the original ID/amount and exactly
one receipt after restart. Automated retry alone is not native termination proof.

Use only the designated R3CN80SCYPL device. Do not call or message synthetic or
real customers. Keep auth data, raw logs, physical coordinates and TLS private
keys outside Git. Stop only the fixture and reverse port owned by this run.
Read device occupancy in a separate command and inspect the result before any
installation, launch or reverse change. If another task uses the device or its
availability is unclear, leave the device unchanged and record native acceptance
as incomplete. Recheck occupancy immediately before an authorized device change.

## Integration boundary

This app depends on the paired additive server migration and compatible
backend before any separately approved rollout. Keep the app opt-in disabled
until combined acceptance and dependency-security gates pass. Disable the app
opt-in before rolling the backend back. Retain accepted receipts and unresolved
original requests.

The canonical service context currently describes payment as read-only.
That context needs a separate update before integration. Its owning repository
is `clever-context-monorepo`; this task edits only app-local service context.
No merge, deployment, migration of production data, store publication, operating
app replacement or production feature activation is part of this work.
