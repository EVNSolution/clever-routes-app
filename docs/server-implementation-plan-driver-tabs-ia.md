# Server Implementation Plan — Driver App Tabs IA Follow-up

Date: 2026-05-19
Authoring scope: `clever-driver-app` documentation only
Server/shopify implementation status: **plan-only; no server/shopify code changed**

## Purpose

The driver app now treats `Home`, `Routes`, `Earnings`, and `Profile` as primary app pages. The app implementation intentionally keeps server-backed route history, earnings, profile update, and account deletion as placeholders. This document is the server-side follow-up plan needed to replace those placeholders with real delivery-api behavior later.

## Current App Contract Assumptions

- The app can use the existing driver bearer token after invite-code verification.
- The app can show current/future assigned routes from existing route access / assigned-route flows.
- The app does **not** call any new server endpoint for historical routes, earnings, profile update, or account deletion.
- `Completed` in the app means current-session completion only until route-history API exists.
- `Profile` uses locally persisted verified driver/session information until a self-profile endpoint exists.
- `Home` exposes a completed-route `Post-route review / tip` field as local-only beta state; the app copy explicitly says server sync is not connected yet.
- Existing assigned-route responses already drive current/future filtering in the app; they must continue to provide valid route `deliveryDate` and `timezone` values.
- Current driver bearer token usage is not yet a complete self-service API contract; server work must decide whether to broaden the existing driver token scope or issue/refresh a token with explicit self-service scopes.

## Driver App Migration Contract

The current app implementation is intentionally session-oriented. Server implementation should not assume that a new server response can be dropped directly into the existing `routeSessions` state without an app adapter/refactor.

Required migration invariants:

- **Route list vs actionable route detail:** route history should return summary records for list rendering. Starting/continuing a route should continue to use an actionable assigned-route/detail contract with stop/proof context.
- **Per-route server status:** future `Routes` must use server-derived per-route status/progress. The current app uses a single session-level `routeStatus` for the selected route, and non-selected routes are treated as upcoming.
- **Feature gates:** do not flip `routeHistory`, `earnings`, `profileUpdate`, or `accountDeletion` from placeholder to live UI until app integration tests prove the server contract and tenant/token scoping.
- **Tenant boundary:** profile, history, earnings, feedback, and deletion APIs must resolve the driver and shop/tenant from verified token evidence, not from whichever route was last selected in the app.
- **Timezone contract:** both existing assigned-route APIs and future route-history APIs must return a valid IANA timezone. App-side fallback to device-local date is a defensive beta fallback, not an acceptable server contract.
- **Profile freshness:** local profile display can drift; future Profile work needs either `GET /driver/profile`, token-refresh profile claims, or another explicit profile refresh path before edits are treated as durable.

## Required Server Workstreams

### 1. Auth / Token Scope Contract

Goal: define the driver bearer token semantics before adding self-service route history, feedback, profile, deletion, or earnings APIs.

Current risk:

- Existing driver access was introduced for invite-code verification and consent/assigned-route flows.
- The new tabs imply broader self-service operations.
- Reusing the existing token without explicit scopes could blur consent, route assignment, and account-management boundaries.

Required decisions:

- Either broaden the existing driver token audience/scope or issue/refresh a new self-service token.
- Define scopes/claims for:
  - route history read;
  - actionable assigned route read;
  - route feedback write;
  - profile read/update;
  - account deletion request;
  - earnings read.
- Define refresh behavior and expiry handling for returning drivers.
- Ensure token-derived tenant/shop/driver identity is the only authority for self-service APIs.
- Decide whether multi-shop same-phone drivers receive one tenant-scoped token per shop or a token that can enumerate authorized tenant contexts.

Tests:

- Expired/invalid/missing token returns `401`.
- Token for one shop/tenant cannot access another shop/tenant.
- Token for consent/assigned-route only cannot call broader self-service APIs unless explicitly allowed.
- Refresh preserves driver, shop/tenant, displayName, and allowed scopes.

### 2. Driver Route History API

Goal: allow the Routes tab to show past, current, and future route history without overloading the current assigned-route endpoint.

Candidate endpoint:

```http
GET /driver/routes?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending|active|completed&cursor=<cursor>
Authorization: Bearer <driverAccessToken>
```

Candidate response:

```json
{
  "data": {
    "routes": [
      {
        "routePlanId": "route-id",
        "shopDomain": "store.myshopify.com",
        "companyDisplayName": "Tomatono",
        "name": "2026-05-19 Morning Route",
        "deliveryDate": "2026-05-19",
        "timezone": "Asia/Seoul",
        "status": "completed",
        "stopCount": 8,
        "completedStopCount": 8,
        "completedAt": "2026-05-19T08:30:00.000Z"
      }
    ],
    "pageInfo": {
      "hasNextPage": false,
      "endCursor": null
    }
  },
  "error": null
}
```

Required decisions:

- Status semantics: pending vs active vs completed should be server-derived, not app-guessed.
- Date filtering must use route/shop timezone, not device local date.
- Token must scope results to the verified driver and tenant/shop boundary.
- Pagination is required before exposing unbounded history.
- Decide whether stop/proof summary appears in this list or requires route-detail endpoint.
- Return summary records for list rendering. Do not require the app to replay consent/assigned-route loading for historical rows.
- Define a separate route-detail/action contract for active/current routes when stop/proof context is needed.
- Include per-route progress fields such as `stopCount`, `completedStopCount`, `failedStopCount`, and route-level completion timestamps.
- Existing assigned-route responses must also return valid `deliveryDate` and IANA `timezone`, because the current app already filters current/future routes before route-history exists.
- Decide explicit failure behavior for missing/invalid timezone: reject server data, return a validation/configuration error, or exclude the route with observable diagnostics.

Tests:

- Driver can only see own route history.
- Multi-shop same-phone scenario stays tenant scoped.
- Past/current/future date filtering honors route timezone.
- Pagination and status filters compose correctly.
- Deleted/deactivated driver behavior is explicit.
- Non-selected routes can carry their own server-derived status instead of inheriting the selected route session status.
- Missing/invalid route timezone is tested for both assigned-route and route-history responses.

### 3. Driver Route Feedback / Review Note API

Goal: replace the Home completed-route `Post-route review / tip` local-only field with durable server sync when product wants this beta input persisted.

Candidate endpoint:

```http
POST /driver/routes/:routePlanId/feedback
Authorization: Bearer <driverAccessToken>
Content-Type: application/json

{
  "reviewNote": "Gate code worked; use west entrance next time.",
  "submittedAt": "2026-05-19T08:45:00.000Z"
}
```

Candidate response:

```json
{
  "data": {
    "feedbackId": "route-feedback-id",
    "routePlanId": "route-id",
    "reviewNote": "Gate code worked; use west entrance next time.",
    "submittedAt": "2026-05-19T08:45:00.000Z"
  },
  "error": null
}
```

Required decisions:

- Decide whether feedback is editable, append-only, or last-write-wins.
- Decide whether feedback is driver-private, merchant/admin-visible, or dispatcher-visible.
- Validate max length and reject unsafe content.
- Scope write access to the verified driver assigned to that route and tenant/shop.
- Decide whether feedback is allowed only after route completion or also while a route is active.
- Decide whether feedback should be synced through the existing offline submission queue.

Tests:

- Driver can only submit feedback for own assigned route.
- Cross-tenant feedback is impossible.
- Feedback before allowed route state is rejected if product requires completion first.
- Too-long/empty feedback is rejected consistently.
- Retry/idempotency behavior is deterministic if offline queue support is added.

### 4. Driver Self Profile Read / Update API

Goal: enable future Profile display-name editing and profile freshness. The current Profile page is read-only and displays local session data plus a placeholder.

Candidate read endpoint:

```http
GET /driver/profile
Authorization: Bearer <driverAccessToken>
```

Candidate read response:

```json
{
  "data": {
    "driver": {
      "id": "driver-id",
      "phone": "+821012345678",
      "displayName": "Minji Kim",
      "status": "ACTIVE"
    }
  },
  "error": null
}
```

Candidate update endpoint:

Candidate endpoint:

```http
PATCH /driver/profile
Authorization: Bearer <driverAccessToken>
Content-Type: application/json

{
  "displayName": "Minji Kim"
}
```

Candidate response:

```json
{
  "data": {
    "driver": {
      "id": "driver-id",
      "phone": "+821012345678",
      "displayName": "Minji Kim",
      "status": "ACTIVE"
    }
  },
  "error": null
}
```

Required behavior:

- `GET /driver/profile` or token-refresh profile claims must exist before the app treats server profile data as fresh.
- Verify driver bearer token.
- Scope update to token driver/shop boundary.
- Trim and validate `displayName`.
- Forbid mutation of phone, status, auth subject, role, tenant/shop, and route assignments.
- Return `401` for missing/expired/invalid token.
- Return `400` for invalid displayName.
- Return updated profile in a shape the app can persist locally.

Tests:

- Valid display name updates and trims.
- Empty/too-long display names fail.
- Phone/status/auth fields cannot be changed.
- Cross-tenant update is impossible.
- Read-after-update returns the updated profile.
- Returning-driver refresh does not regress to stale local displayName when the server profile changed.

### 5. Driver Account Deletion / Deactivation Workflow

Goal: replace the Profile warning-only account deletion placeholder with a legally/product-approved workflow.

Safer first-pass endpoint:

```http
POST /driver/account-deletion-requests
Authorization: Bearer <driverAccessToken>
Content-Type: application/json

{
  "confirmation": "DELETE",
  "reason": "optional driver-entered reason"
}
```

Candidate response:

```json
{
  "data": {
    "requestId": "deletion-request-id",
    "status": "REQUESTED"
  },
  "error": null
}
```

Required product/legal decisions before implementation:

- Direct delete vs deletion request vs deactivation vs anonymization.
- Retention rules for proof media, consent records, driver events, location records, audit logs, and Shopify merchant operational records.
- Recovery/cooling-off period.
- Merchant/admin notification and visibility.
- Active route assignment behavior when deletion is requested.
- Whether request should block future app login immediately.

Tests:

- Request requires driver token and explicit confirmation.
- Active route edge cases are handled consistently.
- Audit log is created.
- Retention/anonymization policy is enforced.

### 6. Earnings Domain Contract

Goal: replace the Earnings `Coming soon` placeholder only after business rules exist.

Candidate endpoint:

```http
GET /driver/earnings?period=YYYY-MM&cursor=<cursor>
Authorization: Bearer <driverAccessToken>
```

Candidate response:

```json
{
  "data": {
    "currency": "KRW",
    "period": "2026-05",
    "summary": {
      "completedRoutes": 12,
      "completedStops": 148,
      "grossAmount": 0,
      "adjustments": 0,
      "estimatedPayout": 0
    },
    "items": []
  },
  "error": null
}
```

Required decisions:

- Rate model: per route, per stop, distance/time, manual adjustment, or external payout system.
- Completed route/stop attribution source of truth.
- Currency and tax handling.
- Payout period and cutoff timezone.
- Admin/merchant visibility and dispute correction flow.
- Whether estimates can be shown before payout finalization.

Tests:

- Only completed/eligible work contributes to earnings.
- Tenant and driver scoping is enforced.
- Adjustments are auditable.
- Currency/period boundaries are deterministic.

## OpenAPI / Docs Requirements

When server implementation starts, update:

- delivery-api OpenAPI/reference docs;
- driver app API contract notes;
- auth/token boundary documentation;
- driver app migration contract notes for route summary vs actionable route detail;
- consent/location retention documentation if deletion affects compliance data;
- route feedback retention and visibility documentation if review/tip sync is implemented;
- Shopify admin docs only if merchant/admin UI visibility changes.

## Rollout Recommendation

1. Define the auth/token scope contract first; every follow-up endpoint depends on this boundary.
2. Tighten existing assigned-route timezone guarantees before relying on current/future route filtering.
3. Implement route history summary API because it directly completes the Routes page promise.
4. Add the app adapter/integration tests for per-route server status before enabling the `routeHistory` feature gate.
5. Decide whether Home review/tip is a durable product feature; if yes, implement route feedback sync and offline/idempotency behavior.
6. Implement profile read, then displayName-only profile update with app-side edit UI work.
7. Plan account deletion/deactivation with product/legal review before implementation.
8. Delay Earnings until payout rules are explicitly approved.

## Non-goals for Current App Task

- No server code changes.
- No Shopify app code changes.
- No database migrations.
- No live endpoint calls from app placeholders.
- No current app-side profile edit UI.
- No current server sync for Home post-route review/tip.
