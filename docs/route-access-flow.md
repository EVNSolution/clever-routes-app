# Route access, company guidance, consent, and assigned route flow

## Purpose

This document records the current app-side route access, consent, assigned-route, and delivery-start event UX boundary. Product scenarios remain in `docs/project-brief.md`; server contract details are owned by `clever-delivery-server/docs/api/driver-route-access.md`, `clever-delivery-server/docs/api/driver-consents.md`, and `clever-delivery-server/docs/api/driver-assigned-route.md`.

## Current app behavior

The app now has an interactive route access screen for the first driver-facing flow:

1. Driver enters route context and E.164 phone.
2. App validates both fields before lookup.
3. App calls a `RouteAccessService` boundary shaped like delivery-server `POST /driver/route-access/lookup`.
4. `INVITED` renders company/shop/route guidance and moves the visible state to `consent_required`.
5. `NOT_FOUND`, `DISABLED`, and `BLOCKED` render safe denial messages without route/stop/customer data.
6. Consent gate records required `LOCATION_INFORMATION` and `PERSONAL_INFORMATION` consent via a `DriverConsentService` boundary.
7. Successful consent moves the visible state to `consent_recorded`.
8. Assigned route loading calls an `AssignedRouteService` boundary shaped like delivery-server `GET /driver/assigned-route`.
9. `ASSIGNED_ROUTE` renders route summary and ordered stop cards, then moves the visible state to `route_ready`.
10. Delivery start requests foreground location permission and moves to `delivery_active` only when permission is granted.
11. After `delivery_active`, the app records a `ROUTE_STARTED` driver event and can sync a foreground `LOCATION_UPDATED` event through the driver event API boundary.
12. After `delivery_active`, the app can request background location permission and start/stop a named continuous location task that streams batched `LOCATION_UPDATED` events through the same driver event boundary.
13. After `delivery_active`, each stop card can record text-only delivered/failed proof metadata as `STOP_DELIVERED` or `STOP_FAILED` through the same driver event API boundary.
14. `NO_ASSIGNED_ROUTE` and API errors stay in safe user-visible states without exposing other tenant/driver data.

## Local mock boundary

`App.tsx` currently uses `createMockRouteAccessService()` from `src/routeAccess.ts`, `createMockDriverConsentService()` from `src/driverConsent.ts`, and `createMockAssignedRouteService()` from `src/assignedRoute.ts`. This keeps the app runnable without a live server while preserving the backend response shape.

The route access screen exposes mock modes:

- `INVITED`
- `NOT_FOUND`
- `DISABLED`
- `BLOCKED`

The consent gate also exposes local `success` and `failure` mock modes so retry/error UX can be tested without a live server. Assigned-route loading exposes local `assigned`, `none`, and `failure` mock modes for route-ready, no-route, and retry/error UX. These modes are for local UX smoke only and do not replace backend integration tests.

## API client boundary

`src/routeAccess.ts` exports `createRouteAccessApiClient({ baseUrl, fetchImpl })`, which posts:

```http
POST /driver/route-access/lookup
Content-Type: application/json
```

```json
{
  "routeContext": "11111111-1111-4111-8111-111111111111",
  "phoneE164": "+14165550123"
}
```

The expected response shape matches `clever-delivery-server/docs/api/driver-route-access.md`. `INVITED` responses must include `driverAccess` token evidence (`accessToken`, `tokenType`, `expiresAt`, `ttlSeconds`, and `use`) so later consent and assigned-route clients can use the server-issued driver bearer token.

## Consent API client boundary

`src/driverConsent.ts` exports `createDriverConsentApiClient({ baseUrl, accessToken, fetchImpl })`, which posts:

```http
POST /driver/consents
Authorization: Bearer <server-issued driver JWT>
Content-Type: application/json
```

```json
{
  "routeContext": "11111111-1111-4111-8111-111111111111",
  "recordedAt": "2026-05-12T06:20:00.000Z",
  "deviceContext": { "platform": "ios" },
  "appContext": { "appVersion": "0.1.0" },
  "consents": [
    { "type": "LOCATION_INFORMATION", "version": "location-v1", "accepted": true },
    { "type": "PERSONAL_INFORMATION", "version": "privacy-v1", "accepted": true }
  ]
}
```

The app-side response boundary accepts only `CONSENT_RECORDED` evidence and never treats consent submission as an assigned route/stop read. Production route+phone lookup returns the server-issued driver access token, and live mode builds the consent client from that token after persisting it through native secure storage.

## Assigned route API client boundary

`src/assignedRoute.ts` exports `createAssignedRouteApiClient({ baseUrl, accessToken, fetchImpl })`, and `src/driverApiClients.ts` can build both consent and assigned-route API clients from either the fresh route lookup `driverAccess` token or an active persisted token. The assigned-route client gets:

```http
GET /driver/assigned-route?routeContext=11111111-1111-4111-8111-111111111111
Authorization: Bearer <server-issued driver JWT>
```

The expected response shape matches `clever-delivery-server/docs/api/driver-assigned-route.md`:

- `ASSIGNED_ROUTE` returns route summary and ordered stops.
- `NO_ASSIGNED_ROUTE` returns a safe empty state.
- HTTP/API failures stay in `consent_recorded` with a retry message.

The app moves to `route_ready` only after an `ASSIGNED_ROUTE` response. From there, the driver can explicitly start delivery; the app requests foreground location permission at that point and enters `delivery_active` only when the OS grants permission. After `delivery_active`, `src/driverEvents.ts` records `ROUTE_STARTED`, foreground one-shot `LOCATION_UPDATED`, continuous/background-capable `LOCATION_UPDATED`, `STOP_DELIVERED`, and `STOP_FAILED` events to `POST /driver/events` with the active driver bearer token. Stop proof is currently text-only metadata (`proof` payload with note/reason/source); photo, signature, barcode, offline queue proof capture, and physical-device background smoke evidence remain later slices. Duplicate event responses are treated idempotently as recorded.

## Runtime API mode

By default the app uses local mock services. Setting `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` switches route+phone lookup to the live delivery-server `POST /driver/route-access/lookup` API. A successful `INVITED` lookup stores the returned short-lived `driverAccess` token in Expo SecureStore via `src/expoSecureDriverAccessTokenStore.ts`. The app clears denied lookup sessions and clears expired or malformed persisted token payloads before reuse. Downstream live consent, assigned-route, and driver-event API clients are built from the active route lookup token via `src/driverApiClients.ts`.

The persisted payload stores only the driver token and route access identifiers required for downstream consent/assigned-route calls. It does not change the server-owned token TTL, refresh policy, tenant boundary, or route/stop authorization checks.

## Follow-up

- Define release environment profiles and any server-side token refresh/re-auth UX beyond the current short-lived token TTL.
- Add rich proof capture for stop actions: photo/signature/barcode, configurable failure reasons, and offline retry/queue policy.
- Add physical-device background tracking smoke evidence, production privacy disclosures, and local queue/retry policy for updates emitted while the app process cannot reach the live delivery server. Expo SDK 54 requires foreground permission before background permission and native background configuration for real background tracking.
