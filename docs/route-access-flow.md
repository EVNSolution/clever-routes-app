# Route access, company guidance, and consent flow

## Purpose

This document records the current app-side route access and consent UX boundary. Product scenarios remain in `docs/project-brief.md`; server contract details are owned by `clever-delivery-server/docs/api/driver-route-access.md` and `clever-delivery-server/docs/api/driver-consents.md`.

## Current app behavior

The app now has an interactive route access screen for the first driver-facing flow:

1. Driver enters route context and E.164 phone.
2. App validates both fields before lookup.
3. App calls a `RouteAccessService` boundary shaped like delivery-server `POST /driver/route-access/lookup`.
4. `INVITED` renders company/shop/route guidance and moves the visible state to `consent_required`.
5. `NOT_FOUND`, `DISABLED`, and `BLOCKED` render safe denial messages without route/stop/customer data.
6. Consent gate records required `LOCATION_INFORMATION` and `PERSONAL_INFORMATION` consent via a `DriverConsentService` boundary.
7. Successful consent moves the visible state to `consent_recorded`; assigned route/stop data remains a follow-up slice.

## Local mock boundary

`App.tsx` currently uses `createMockRouteAccessService()` from `src/routeAccess.ts` and `createMockDriverConsentService()` from `src/driverConsent.ts`. This keeps the app runnable without a live server while preserving the backend response shape.

The route access screen exposes mock modes:

- `INVITED`
- `NOT_FOUND`
- `DISABLED`
- `BLOCKED`

The consent gate also exposes local `success` and `failure` mock modes so retry/error UX can be tested without a live server. These modes are for local UX smoke only and do not replace backend integration tests.

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

The expected response shape matches `clever-delivery-server/docs/api/driver-route-access.md`.

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

The app-side response boundary accepts only `CONSENT_RECORDED` evidence and never treats consent submission as an assigned route/stop read. Production wiring still needs the server-issued driver access token/session boundary after route+phone lookup.

## Follow-up

- Add environment/base URL wiring for the real delivery server.
- Replace local mock services with API clients under an environment switch.
- Add server-issued driver access token/session wiring for real consent API calls.
- Implement assigned route and stop detail reads only after consent and server access/session rules are ready.
- Keep foreground/background location permission and collection out of this flow until the `delivery_active` slice.
