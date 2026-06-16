# Route access, company guidance, consent, and assigned route flow

## Purpose

This document records the current app-side route access, consent, assigned-route, and delivery-start event UX boundary. Product scenarios remain in `docs/project-brief.md`; server contract details are owned by `clever-delivery-server/docs/api/driver-route-access.md`, `clever-delivery-server/docs/api/driver-consents.md`, and `clever-delivery-server/docs/api/driver-assigned-route.md`.

## Current app behavior

The app now has an interactive phone-first driver flow:

1. Driver selects a supported country, enters the phone number registered with dispatch in national format, enters driver name, and acknowledges required privacy/location consent.
2. App formats the national phone input for the selected country and normalizes it to E.164 before lookup.
3. App calls a `RouteAccessService` boundary shaped like delivery-server `POST /driver/route-access/lookup` with `routeContext: null`.
4. `ROUTES_FOUND` returns zero or more selectable route choices for a registered active phone. Each choice carries its own company guidance, route access identifiers, and short-lived driver access token.
5. From the driver's point of view, multi-company assignments are just multiple routes; each route card shows the company/shop and route metadata attached to that route.
6. The app records required `LOCATION_INFORMATION` and `PERSONAL_INFORMATION` consent through the `DriverConsentService` boundary for the selected/loaded route token.
7. Assigned route loading calls an `AssignedRouteService` boundary shaped like delivery-server `GET /driver/assigned-route` for each route choice.
8. Loaded current/upcoming routes render in `Pending`, `In Progress`, and `Completed` tabs; a route card can open detail or start delivery. Past routes are hidden until a server-backed route-history API exists, and `Completed` means current-session completion only in this beta.
9. Delivery start requests foreground location permission and moves to `delivery_active` only when permission is granted.
10. Live tracking starts at the company/pickup step, then proceeds through ordered stops without presenting turn-by-turn instruction UI.
11. Each stop can play a local area tip, open stop details, capture required proof photo, and record optional delivery notes, location-specific tips, and additional notes.
12. Delivery finish stops the continuous location task, records or queues a `ROUTE_COMPLETED` driver event, and discards route-scoped local retry items only after route completion is recorded.
13. `INVITED` remains accepted as a legacy exact route-context response from the API, but the app no longer asks the driver for any external route access artifact.
14. `NO_ASSIGNED_ROUTE`, `NOT_FOUND`, `DISABLED`, `BLOCKED`, and API errors stay in safe user-visible states without exposing other tenant/driver data.

## Local mock boundary

`App.tsx` uses `createMockRouteAccessService()` from `src/domain/routeAccess/routeAccess.ts`, `createMockDriverConsentService()` from `src/domain/consent/driverConsent.ts`, and `createMockAssignedRouteService()` from `src/domain/route/assignedRoute.ts` when no live delivery-server base URL is configured. The default mock returns a phone-resolvable route choice with company guidance, so the app can run the same phone → current/upcoming route choice → route details → live tracking → stop details → arrival check → stop completed/completed deliveries flow without a live server.

Mock services are for local UX smoke only and do not replace backend integration tests.

## API client boundary

`src/domain/routeAccess/routeAccess.ts` exports `createRouteAccessApiClient({ baseUrl, fetchImpl })`, which posts:

```http
POST /driver/route-access/lookup
Content-Type: application/json
```

```json
{
  "phoneE164": "+14165550123",
  "routeContext": null
}
```

The expected phone-first success response is `ROUTES_FOUND`; `routes` may be empty when the phone is registered but no active route is assigned:

```json
{
  "data": {
    "status": "ROUTES_FOUND",
    "routes": [
      {
        "routeAccess": {
          "nextState": "consent_required",
          "routeContext": "11111111-1111-4111-8111-111111111111",
          "routePlanId": "11111111-1111-4111-8111-111111111111"
        },
        "companyGuidance": {
          "companyDisplayName": "Tomatono Toronto",
          "shopDomain": "tomatono.myshopify.com",
          "routeName": "Tuesday AM Route",
          "deliveryDate": "2026-05-12",
          "timezone": "America/Toronto",
          "pickupGuidance": "Meet at dispatch desk by 9:00 AM",
          "operatorSupportContact": "+14165550000",
          "driverInstructions": ["Bring insulated bag"]
        },
        "driverAccess": {
          "accessToken": "<server-issued-driver-jwt>",
          "tokenType": "Bearer",
          "expiresAt": "2026-05-12T06:55:00.000Z",
          "ttlSeconds": 900,
          "use": "consent_and_assigned_route"
        }
      }
    ]
  },
  "error": null
}
```

Each non-empty route choice must include `driverAccess` token evidence (`accessToken`, `tokenType`, `expiresAt`, `ttlSeconds`, and `use`) so later consent and assigned-route clients can use the server-issued driver bearer token for that route.

A legacy `INVITED` response with the same single-route fields is still accepted for backward compatibility. `MULTIPLE_MATCHES` remains a safe display-only legacy response and must not include `driverAccess`, `routePlanId`, delivery stops, customer addresses, coordinates, order data, or proof data. In the current app UX, drivers do not type external route artifacts; ambiguous legacy responses should direct the driver back to phone lookup or dispatch support.

## Consent API client boundary

`src/domain/consent/driverConsent.ts` exports `createDriverConsentApiClient({ baseUrl, accessToken, fetchImpl })`, which posts:

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

The app-side response boundary accepts only `CONSENT_RECORDED` evidence and never treats consent submission as an assigned route/stop read. Production phone lookup returns the server-issued driver access token, and live mode builds the consent client from that token after persisting it through native secure storage.

## Assigned route API client boundary

`src/domain/route/assignedRoute.ts` exports `createAssignedRouteApiClient({ baseUrl, accessToken, fetchImpl })`, and `src/api/deliveryServer/driverApiClients.ts` can build both consent and assigned-route API clients from either the fresh route lookup `driverAccess` token or an active persisted token. The assigned-route client gets:

```http
GET /driver/assigned-route?routeContext=11111111-1111-4111-8111-111111111111
Authorization: Bearer <server-issued driver JWT>
```

The expected response shape matches `clever-delivery-server/docs/api/driver-assigned-route.md`:

- `ASSIGNED_ROUTE` returns route summary and ordered stops; the app builds platform map URLs locally from each stop coordinate or formatted address.
- `NO_ASSIGNED_ROUTE` returns a safe empty state.
- HTTP/API failures stay in `consent_recorded` with a retry message.

The app moves to `route_ready` only after an `ASSIGNED_ROUTE` response. Stop cards expose `Open map`, which hands off to the OS map handler with coordinates first and formatted address fallback without committing to a provider SDK. From there, the driver can explicitly start delivery; the app requests foreground location permission at that point and enters `delivery_active` only when the OS grants permission. After `delivery_active`, `src/domain/events/driverEvents.ts` records `ROUTE_STARTED`, foreground one-shot `LOCATION_UPDATED`, continuous/background-capable `LOCATION_UPDATED`, `STOP_DELIVERED`, `STOP_FAILED`, and `ROUTE_COMPLETED` events to `POST /driver/events` with the active driver bearer token. Stop proof now stores metadata (`proof` payload with note/reason/source, uploaded photo media references and signature drawing evidence). The durable app-side offline queue can retain failed `ROUTE_STARTED`, `LOCATION_UPDATED`, `STOP_DELIVERED`, `STOP_FAILED`, `ROUTE_COMPLETED`, and retryable proof media upload attempts for retry or discard across app restarts. Scanner-rejected proof media is not treated as retryable; delivery-server has a proof-media scan rejection hook, while production object storage/signed access/deployed scanner evidence and physical-device background smoke evidence remain later slices. Duplicate event responses are treated idempotently as recorded.

## Durable offline queue boundary

`src/domain/offline/offlineSubmissionQueue.ts` owns queue identity, retry bookkeeping, malformed payload recovery, and storage serialization for pending driver events/proof media upload attempts. `src/platform/expo/storage/expoOfflineSubmissionQueueStorage.ts` adapts the queue to Expo-compatible AsyncStorage.

The queue stores retry metadata, driver event payloads, and proof media file URI references. It does not store driver access tokens; token persistence remains isolated in Expo SecureStore through `src/platform/expo/secureStore/expoSecureDriverAccessTokenStore.ts`. AsyncStorage is treated as unencrypted app storage, so the queue is not a replacement for server-side proof storage or secret storage.

Production app-side discard policy is now explicit in `OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY`:

- maximum retained retry attempts: `5`
- maximum local queue age: `72 hours`
- before each retry, items older than the policy window or already at the attempt limit are discarded without hitting the live server
- after a failed retry reaches the attempt limit, the item is discarded instead of being retained indefinitely
- if a queued proof media upload receives `422 PROOF_MEDIA_REJECTED`, the app discards that queued file reference instead of retrying it again
- delivery finish calls `finishDeliveryAfterActive()` to stop continuous tracking and record or queue a `ROUTE_COMPLETED` event
- after route completion is recorded, delivery finish calls `discardRouteSubmissions(routePlanId)` to remove local retry items scoped to the completed route while leaving unrelated route or unscoped items intact
- if route completion recording fails, the `ROUTE_COMPLETED` event is queued and route-scoped items are not discarded in that branch
- the runtime guard panel exposes `Reset driver session`, which stops continuous tracking, clears the secure driver access token, clears route/session UI state, and calls `clear()` to remove every pending local retry item from durable storage

This policy only governs app-side AsyncStorage metadata and file URI references. Server-side proof-media scan rejection hook support exists and the app handles that rejection as non-retryable, but production object storage, signed retrieval, deployed scanner evidence, and retention/deletion deployment evidence remain server/release work.

## Proof media upload boundary

`src/domain/proof/proofMediaUpload.ts` exports `createProofMediaUploadApiClient({ baseUrl, accessToken, fetchImpl })`, which posts captured proof photos as multipart form data:

```http
POST /driver/proof-media
Authorization: Bearer <server-issued driver JWT>
Content-Type: multipart/form-data; boundary=...
```

Form fields:

- `deliveryStopId`
- `routePlanId`
- `source`: `camera` or `library`
- `file`: native photo file from Expo ImagePicker

The expected success envelope returns durable media evidence:

```json
{
  "data": {
    "kind": "photo",
    "mediaId": "media-1",
    "storageKey": "driver-proof/media-1.jpg",
    "contentType": "image/jpeg",
    "source": "camera",
    "uploadedAt": "2026-05-12T10:00:00.000Z",
    "sizeBytes": 12345,
    "sha256": "sha256-fixture"
  },
  "error": null
}
```

The app includes only successfully uploaded media references in `STOP_DELIVERED` / `STOP_FAILED` proof payloads. Failed or cancelled capture/upload branches remain visible in the UI but are not converted into durable proof evidence.

If the live server returns `422` with the Driver API error code `PROOF_MEDIA_REJECTED`, the app maps it to a safe driver-facing message: "Proof photo was rejected by the safety scan. Capture another proof photo." The app does not expose scanner internals, does not create a durable media reference, and does not queue that photo for offline retry. The same non-retryable discard applies when an already queued proof media upload receives the scanner rejection during offline retry.

For physical-device smoke runs without a deployed scanner backend, local mock mode exposes a `Local proof media upload mock` selector with `success`, `failure`, and `scan_rejected`. This selector is only used when `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` is unset and the app is running on local mock services; live delivery-server mode ignores it.

## Signature proof boundary

`src/domain/proof/proofSignatureCapture.ts` records signature drawing evidence as vector metadata (`signatureId`, signer name, stroke count, point count) instead of storing raw image data in the driver event payload. Barcode proof capture is not shipped in the current app scope.

## Runtime API mode

By default the app uses local mock services. Setting `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` switches phone lookup to the live delivery-server `POST /driver/route-access/lookup` API. A successful `ROUTES_FOUND` or legacy `INVITED` lookup stores the selected route's short-lived `driverAccess` token in Expo SecureStore via `src/platform/expo/secureStore/expoSecureDriverAccessTokenStore.ts`. The app clears denied lookup sessions and clears expired or malformed persisted token payloads before reuse. Downstream live consent, assigned-route, driver-event, and proof-media API clients are built from the active route lookup token via `src/api/deliveryServer/driverApiClients.ts`.

If a live downstream consent, assigned-route, driver-event, proof-media upload, or offline retry call returns `401`, the app classifies the token as expired driver access. It shows phone re-lookup guidance, clears the secure token, stops/clears active route UI state, and leaves retryable event/proof submissions in the non-secret offline queue so they can be retried after the driver obtains a fresh route-scoped token.

The persisted payload stores only the driver token and route access identifiers required for downstream consent/assigned-route calls. It does not change the server-owned token TTL, refresh policy, tenant boundary, or route/stop authorization checks.

## Follow-up

- Country-aware phone entry now uses the supported-country i18n catalog in `src/domain/phone/phoneEntry.ts`: country labels include localized country name, ISO, calling code, and language; search covers name/native name/ISO/calling code/locale/language; national input is normalized to E.164 before route access. The remaining slice from `docs/phone-verification-plan.md` is server-owned SMS OTP verification/cost controls and per-country SMS compliance/rate-limit policy.
- Define release environment profiles and any server-issued token refresh, OTP, managed identity, or stronger re-auth UX beyond the current phone re-lookup recovery for short-lived token expiry.
- Add production proof-media object storage, signed access, scanner backend deployment/private evidence storage, and deployed cleanup/scheduler evidence. The delivery server already exposes a scan rejection hook and a local/manual cleanup runner via `npm run driver:proof-media:cleanup`.
- Add physical-device background tracking smoke evidence and production privacy disclosures for updates emitted while the app process cannot reach the live delivery server. Expo SDK 54 requires foreground permission before background permission and native background configuration for real background tracking.
## Driver API cache and cookie policy

Driver API calls are bearer-token based and must not rely on ambient browser or WebView cookies. The app request helper applies `credentials: 'omit'`, `cache: 'no-store'`, `Cache-Control: no-store`, and `Pragma: no-cache` to live delivery-server fetches for route lookup, consent, assigned-route reads, driver events, and proof-media upload. This keeps the native app session boundary tied to the short-lived driver token in SecureStore and avoids stale route/proof responses being reused by an intermediate cache.

AsyncStorage remains limited to non-secret offline retry metadata and local file URI references. Driver access tokens stay in SecureStore and are cleared on expiry, malformed payload, downstream `401`, denied lookup, and explicit driver session reset.
