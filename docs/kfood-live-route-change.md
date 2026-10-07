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
