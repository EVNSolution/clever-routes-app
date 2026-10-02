# Server Plan: Driver App Next Scenario Corrections

## Scope boundary

This document is a plan-only queue for future server/API work discovered during the driver app correction pass. It lives in the app repo so app copy, docs, and placeholders can point to the future contract needs, but this pass must not edit `clever-route-server`, `shopify-clever`, or any server runtime.

## 1. Route list/history contract

### Current/future route list semantics
- Provide the driver app with route sessions that can be classified as current, upcoming, or past for the authenticated driver token.
- Include route timezone and delivery date/status fields so the app can preserve nearest-first current/upcoming ordering without guessing from device timezone alone.
- Preserve tenant and driver boundaries: a token must only expose routes assigned to that driver within the correct tenant/company context.

### Past/completed route history semantics
- Add a separate route-history API instead of overloading the current/upcoming list.
- Support date range, timezone, route status, completion status, and proof/completion summary fields.
- Make pagination explicit before the app presents history as more than current-session completion.

### Timezone/date status rules
- Server responses should include canonical route timezone and normalized route date/status.
- The API contract should define how same-day, future, past, cancelled, skipped, and completed sessions are classified.
- The app should continue hiding past routes from the main current/upcoming list until the route-history contract exists.

## 2. Profile update contract

### Editable fields
- Decide which fields a driver can edit directly, such as display name, preferred contact fields, or profile metadata.
- Phone number changes need stricter rules because phone is part of route access and tenant/driver identity matching.

### Display name behavior
- Define whether display name is driver-owned, dispatch/admin-owned, or derived from route assignment data.
- Return the canonical display value in driver access/profile responses so local app copy does not imply fake persistence.

### Audit and tenant/driver identity boundaries
- Persist profile changes with actor, tenant, driver identity, timestamp, source app/version, and before/after values.
- Reject updates that cross tenant boundaries or conflict with phone uniqueness requirements.

## 3. Account deletion/request contract

### Warning copy needs
- Provide app-safe copy explaining that deletion may affect route access, support workflows, audit records, and legal/retention obligations.
- Distinguish immediate account reset/logout from a true account deletion request.

### Support/admin workflow
- Treat mobile account deletion as a request workflow unless legal/product requirements require direct self-service deletion.
- Include request status, support contact path, cancellation window if any, and admin handling ownership.

### Data retention constraints
- Define which driver records, proof metadata, route events, consent records, and audit records must be retained.
- Define what can be deleted, anonymized, or hidden from future app sessions.

## 4. Post-route review/tip contract

### Payload shape
- Plan an endpoint or driver event for post-route review/tip data with `routePlanId`, driver identity, rating/category/text fields if applicable, idempotency key, app version, and submitted timestamp.
- Keep this separate from `ROUTE_COMPLETED` so completion remains reliable even when optional feedback fails.

### Admin visibility
- Define whether dispatch/admin users can view feedback, where it appears, and whether it is route-level, stop-level, or tenant-level.
- Define moderation/review status if feedback can contain free text.

### Privacy/moderation/retention
- Specify privacy rules for driver-authored notes and whether they are internal-only.
- Define retention, export, deletion, and moderation behavior before enabling server sync in the app.

## App dependency note

Until these contracts exist, the driver app must keep route history, profile editing, account deletion, and post-route review/tip sync visibly gated or local-only. Copy must not imply server persistence or dispatch/admin visibility for these features.
