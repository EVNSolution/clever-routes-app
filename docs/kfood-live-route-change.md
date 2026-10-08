# Applying office changes during KFood delivery

The server owns route content and publication history. The driver app keeps the
last locally applied content until the driver selects **Apply changes**.

The office can edit future addresses and future stop order. Save remains private.
Dispatch publishes an immutable snapshot. Receiving a notification or reading the
latest publication does not acknowledge it.

## Driver behavior

- A persistent notice identifies pending delivery-list changes.
- Notifications, foreground recovery, network recovery, and periodic checks read
  the publication. They do not silently replace the applied addresses or order.
- Apply uses the exact snapshot returned by the publication lookup. It keeps
  the current delivery stop by ID, existing execution state, payment information,
  proof input, and queued evidence.
- Camera and delivery-completion work block Apply until the current action ends.
- If applied content is missing after recovery, the app requires an explicit
  Apply before enabling the recovered delivery route.
- A newer publication received while acknowledging an earlier publication remains
  pending. The driver must apply the newer publication separately.

## Storage and identity

The existing SQLCipher evidence database stores live-change state. The state is
isolated by account owner, route, and assignment generation. It contains the
applied route, publication identity, pending change, acknowledgement retry, and
delivery input needed for recovery. It does not store authentication tokens.

Photo selection and upload retain the initiating account, route, assignment generation,
and stop ID. A late camera or upload result cannot update a different account or
assignment. Selecting a replacement photo clears the previous upload result before
saving the new photo. Unsent proof media from an unknown or superseded V2 assignment
is quarantined before upload. Its original queue identity remains available.
New scoped photo queue identities include assignment generation. Identical route,
stop and filename values from a new assignment do not reuse a retained old item.
Same-assignment duplicates retain the original item. The encrypted replay envelope
stores the upload key. Initial upload and retry reuse that key, including the
legacy unscoped v1 key of an existing item. Fresh scoped keys retain the server's
`proof-media-v1:<32hex>` wire format and distinguish assignment generations.

When account lookup fails because the connection is unavailable, the app can restore
an active KFood route from the encrypted applied snapshot. The saved account, active
route and assignment must match. Authentication rejection and assignment conflict do
not use this fallback. The fallback does not initiate tracking or replay delivery
evidence. Reopening a route hydrates its saved input. While this cache is unvalidated,
queue replay and publication acknowledgement remain paused. Foreground connection
recovery validates the account and assignment with the server before restoring tracking.
The retry uses the existing polling cadence and preserves the applied list and draft.
An offline-to-online transition defers account lookup and route hydration during
camera, photo selection and photo processing. One pending refresh runs when the
protected action ends. It does not replace the draft while that action is active.
Cached recovery also pauses an already-running native location task. The pause
checks the current account lease and durable route, assignment and session identity
inside the serialized stop operation. It preserves the active session and queued
GPS events. Actual stop failure does not count as a successful pause. Authoritative
validation of the same assignment permits tracking to resume. This cache gate does
not change GPS collection for a normally validated active route while offline.

The encrypted database serializes operations on each native connection. An exclusive
transaction uses a separate operation queue. The queue drains before rollback or
connection closure. Evidence token refresh requires the original route, assignment
generation and contract. A newer publication in the same assignment can still refresh
its token, while replay retains the original event identity.

Idle cache entries expire after 30 days. Entries with pending changes,
acknowledgements, or unfinished proof input remain available. Signing out does
not delete that evidence. Account deletion removes the account's live-change cache.

The app persists the applied snapshot and acknowledgement retry before advancing
the displayed route and event version. If the acknowledgement response is lost,
the app retries the same publication after recovery. A retry never claims that a
different publication was applied.

Existing offline records retain their client event ID, assignment generation,
route version, and payload. For an enrolled route, the app can send an older
same-assignment stop event for server validation. The server accepts it only if
the target remained unchanged through all intervening publications. Route-level
events and events from another assignment retain the existing restrictions.

## API boundary

Both endpoints use the existing route bearer and no-store requests:

- `GET /driver/routes/:routePlanId/live-change`
- `POST /driver/routes/:routePlanId/live-change/applied`

Acknowledgement carries `publicationVersionId` and `assignmentGeneration`.
An unenrolled current assignment returns `data: null`. The baseline publication
does not replace the original child version used by existing ordered events.

Snapshot application replaces operational address, coordinates, contact, and
sequence by delivery stop ID. The snapshot does not contain payment or order-item
data, so those fields remain on the assigned route. Geometry, snapped coordinates,
and future ETA from the previous content are invalidated.

The server contract is documented in
`clever-route-server/apps/delivery-api/docs/api/kfood-live-route-change.md`.
This client does not define a policy for editing the current stop, removing stops,
cash collection, required proof, or toll roads.

## Release boundary

The matching server schema and API must be available before this workflow is
enabled in the office. Office live-change UI stays disabled until the combined
release is accepted. Existing customer addresses changed by Dispatch remain
operational data during rollback; publication history and offline evidence must
be retained.

Local unit tests and a synthetic HTTP integration run do not prove device camera,
background delivery, SQLCipher native recovery, or push-provider behavior. A test
APK is a local validation artifact. It is not a Play Store release or permission
to replace a driver's installed application.

The follow-up findings and acceptance limits are recorded in
[the 2026-10-08 verification record](verification/kfood-live-change-final-20261008.md).
