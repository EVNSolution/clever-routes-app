# Route access and company guidance flow

## Purpose

This document records the current app-side route access UX boundary. Product scenarios remain in `docs/project-brief.md`; server contract details are owned by `clever-delivery-server/docs/api/driver-route-access.md`.

## Current app behavior

The app now has an interactive route access screen for the first driver-facing flow:

1. Driver enters route context and E.164 phone.
2. App validates both fields before lookup.
3. App calls a `RouteAccessService` boundary shaped like delivery-server `POST /driver/route-access/lookup`.
4. `INVITED` renders company/shop/route guidance and moves the visible state to `company_context_confirmed`.
5. `NOT_FOUND`, `DISABLED`, and `BLOCKED` render safe denial messages without route/stop/customer data.
6. Consent gate remains the next placeholder state.

## Local mock boundary

`App.tsx` currently uses `createMockRouteAccessService()` from `src/routeAccess.ts`. This keeps the app runnable without a live server while preserving the backend response shape.

The local screen exposes mock modes:

- `INVITED`
- `NOT_FOUND`
- `DISABLED`
- `BLOCKED`

These modes are for local UX smoke only and do not replace backend integration tests.

## API client boundary

`src/routeAccess.ts` also exports `createRouteAccessApiClient({ baseUrl, fetchImpl })`, which posts:

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

## Follow-up

- Add environment/base URL wiring for the real delivery server.
- Replace local mock service with API client under an environment switch.
- Implement consent persistence after company guidance confirmation.
- Implement assigned route and stop detail reads only after consent and server access/session rules are ready.
- Keep foreground/background location permission and collection out of this flow until the `delivery_active` slice.
