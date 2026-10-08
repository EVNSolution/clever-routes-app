# PR299 remaining native cases — 2026-10-08

**All three remaining native cases passed:** Dispatch/Apply, account isolation with pending Cash, and reassignment preservation. Cleanup also passed. The server recorded one intentionally failed completion attempt, **0 completion events and 0 receipts**. The one unresolved original remains stored for review.

This lane did not repeat the completed core Cash matrix or process-kill cases. See [core native acceptance](kfood-pr299-native-acceptance-20261008.md). Times below are UTC.

## Candidate and isolation

The run used the existing `com.evnsolution.clever.routes.cashqa` **1.3.5 / 41** APK on **R3CN80SCYPL**. APK SHA-256: `ce8a8b1e6ebbe76c80a54e1879e73282025dd924dbbe9ac31cf9bf30a25c8ec6`. Its source remains `985f999ad2c4f9354ff2c856174e4542410c6554`; the review base was `757baefff29f3e7afef800d0fd080df1fad721d8`. The existing runtime was reused without rebuilding. This evidence does not certify a later dependency-patched artifact.

The private fixture used server `bd132f199c2a058d8e14fe33d97497307a51af45` and Shopify `e3f5a2a9819cb0ddd58766912b8ff31de2c759ae`. Their product sources remained unchanged. A copied fixture helper added a whitelist observation of original completion identity and exact Cash before the existing 503 fault. It changed no response or product behavior. Its dedicated check confirmed that authentication, location, contact, note, and unrelated fields were excluded. The JSON records both helper hashes and the private diff hash.

At `12:30:24Z`, the read-only occupancy check found another diagnostic QA app. No device mutation followed. At `12:32:15Z`, a separate read-only check found Launcher, no foreign service, no reverse mapping, and no other controller. Launch occurred in a later call. Only the root task operated the device.

## Dispatch and explicit Apply — PASS

- Current stop 1 stayed current.
- A future-stop address change was published for **human stop 13 / fixture index 12**. Refresh showed the update notice while retaining the old active address, `13 Integration Road`.
- Explicit Apply acknowledged publication `b6f19a98-4f0f-45da-bb9c-4042a2690784`, assignment `2`, with HTTP 200 at `12:42:56.704Z`.
- The new synthetic address appeared only after Apply. Optional note `PR299 Dispatch retained note` and Cash draft `17.25` remained.
- Completion events and receipts stayed at zero. Publishing, refreshing, and applying did not collect Cash.

Evidence: `dispatch-server-published.json`, `dispatch-server-applied.json`; screen suffixes `dispatch-old-address-staged`, `dispatch-applied`, `dispatch-note-retained`, and `dispatch-cash-draft-stable`. The root visually inspected the stable retained-draft PNG.

## Account switch with pending Cash — PASS

The separate pending-Cash case used **human stop 12 / fixture index 11**. The summary helper emits a one-based `stopIndex`; it is not the fixture array index.

| Original request field | Preserved value |
| --- | --- |
| Client event ID | `739f7863-ed2d-48b6-8263-e0111a27201d` |
| Occurrence time | `2026-10-08T12:45:35.607Z` |
| Cash | `23.45` `CAD` |
| Assignment generation | `2` |
| Original publication | `b6f19a98-4f0f-45da-bb9c-4042a2690784` |
| First observed transport | Intentional HTTP 503 at `12:45:35.946Z` |

Account A's pending detail showed the saved `CAD 23.45`. Signing out displayed `Preserved 1 unsynced evidence item`. After the fault was disabled, account B signed in and saw `No routes assigned yet`. A's route and Cash were hidden. The server still had only the original failed attempt, with no completion event or receipt. The root visually inspected account B's isolated screen.

Evidence: `account-server-before-switch.json`, `account-b-server.json`; screen suffixes `account-cash-pending-details`, `account-a-signed-out`, and `account-b-isolated`.

## Reassignment preserves the original — PASS

After B signed out, the fixture changed the assignment from generation **2 to 3**. A signed in again and opened the route. The app showed `Unsynced delivery record`.

The stop-12 detail then showed `Needs dispatch review`, `Submitted cash`, and `CAD 23.45`. It stated that the original submission was preserved and must not be collected again. The **Complete Delivery button was disabled**. The XML assertion checks the button node, not its enabled text child. The root visually inspected the PNG.

The final server checkpoint at `12:57:47.693Z` retained exactly the original 503 attempt: same ID, time, amount, generation 2, and original publication. The route's current generation was 3. There was no replacement completion POST, no new completion event, and no receipt. The request was not rebound to the new assignment or converted to a legacy completion.

Evidence: `reassignment-before-relogin.json`, `reassignment-after-login.json`, `reassignment-after-route-open.json`, `reassignment-final-server.json`; screen suffixes `reassignment-a-restored`, `reassignment-cash-details`, and `reassignment-stop-status`.

These UI and server observations establish preserved unresolved evidence. They do not claim successful payment acknowledgement. No raw database or key extraction was performed.

## Cleanup and evidence integrity — PASS

Cleanup began at `12:58:00.902306Z`. The final check at `12:59:02.342315Z` confirmed:

- Cash QA stopped; its process was absent.
- The owned reverse mapping, port 8445 listener, fixture, and log reader were absent.
- HTTPS/Fastify/Prisma closed. The owned temporary PostgreSQL and synthetic proof files were stopped or removed.
- All four installed packages retained identical version and first/last-install metadata: operating app, prior QA, Cash QA, and diagnostic QA.
- App data and the one unresolved original were retained. No Clear Record, app-data clear, uninstall, or package replacement occurred.

Evidence: `cleanup-actions.json`, `cleanup-verification.json`, `cleanup-final-server.json`, and matching `packages-before.json` / `packages-after.json` records.

The [sanitized JSON](kfood-pr299-native-remaining-20261008.json) records assertions, provenance, and SHA-256 values for selected original JSON/XML/PNG files. Raw artifacts remain outside Git at `/Users/jiin/.codex/artifacts/kfood-pr299-remaining-20261008`. Credentials, PINs, location coordinates, and phone values are not copied into this record. Earlier 63 core artifacts remain unchanged.

This completes the three supplemental native cases on the existing QA artifact. It does not enable the signed OFF candidate, resolve separate security/integration gates, merge, deploy, publish, or activate production Cash.
