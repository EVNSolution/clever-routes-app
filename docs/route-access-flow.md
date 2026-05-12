# Route access, company guidance, consent, and assigned route flow

## Purpose

This document records the current app-side route access, consent, assigned-route, and delivery-start event UX boundary. Product scenarios remain in `docs/project-brief.md`; server contract details are owned by `clever-delivery-server/docs/api/driver-route-access.md`, `clever-delivery-server/docs/api/driver-consents.md`, and `clever-delivery-server/docs/api/driver-assigned-route.md`.

## Current app behavior

The app now has an interactive route access screen for the first driver-facing flow:

1. Driver enters route context and E.164 phone.
2. App validates both fields before lookup.
3. App calls a `RouteAccessService` boundary shaped like delivery-server `POST /driver/route-access/lookup`.
4. `INVITED` renders company/shop/route guidance and moves the visible state to `consent_required`.
5. `MULTIPLE_MATCHES` renders only non-sensitive company/route display context and asks the driver to use a route-specific link/code or contact dispatch before continuing.
6. `NOT_FOUND`, `DISABLED`, and `BLOCKED` render safe denial messages without route/stop/customer data.
7. Consent gate records required `LOCATION_INFORMATION` and `PERSONAL_INFORMATION` consent via a `DriverConsentService` boundary.
8. Successful consent moves the visible state to `consent_recorded`.
9. Assigned route loading calls an `AssignedRouteService` boundary shaped like delivery-server `GET /driver/assigned-route`.
10. `ASSIGNED_ROUTE` renders route summary, ordered stop cards, and per-stop OS map handoff, then moves the visible state to `route_ready`.
11. Delivery start requests foreground location permission and moves to `delivery_active` only when permission is granted.
12. After `delivery_active`, the app records a `ROUTE_STARTED` driver event and can sync a foreground `LOCATION_UPDATED` event through the driver event API boundary.
13. After `delivery_active`, the app can request background location permission and start/stop a named continuous location task that streams batched `LOCATION_UPDATED` events through the same driver event boundary.
14. After `delivery_active`, each stop card can record delivered/failed proof metadata as `STOP_DELIVERED` or `STOP_FAILED`; the app captures note, failure reason, uploaded photo media references, signature drawing evidence, and barcode scan evidence through proof-media and driver event API boundaries.
15. Delivery finish stops the continuous location task, records or queues a `ROUTE_COMPLETED` driver event, and discards route-scoped local retry items only after route completion is recorded.
16. `NO_ASSIGNED_ROUTE` and API errors stay in safe user-visible states without exposing other tenant/driver data.

## Local mock boundary

`App.tsx` currently uses `createMockRouteAccessService()` from `src/routeAccess.ts`, `createMockDriverConsentService()` from `src/driverConsent.ts`, and `createMockAssignedRouteService()` from `src/assignedRoute.ts`. This keeps the app runnable without a live server while preserving the backend response shape.

The route access screen exposes mock modes:

- `INVITED`
- `MULTIPLE_MATCHES`
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

If a route context and phone number can still match multiple company/route assignments, the client accepts a safe ambiguous response:

```json
{
  "data": {
    "status": "MULTIPLE_MATCHES",
    "matches": [
      {
        "companyDisplayName": "Tomatono Toronto",
        "shopDomain": "tomatono.myshopify.com",
        "routeName": "Tuesday AM Route",
        "deliveryDate": "2026-05-12",
        "timezone": "America/Toronto",
        "pickupGuidance": "Use the route-specific invite link from dispatch.",
        "operatorSupportContact": "+14165550000"
      }
    ],
    "resolutionHint": "Use the route-specific invite link/code from dispatch."
  },
  "error": null
}
```

`MULTIPLE_MATCHES` must not include `driverAccess`, `routePlanId`, delivery stops, customer addresses, coordinates, order data, or proof data. The app stays at the route-context entry boundary and asks the driver to use a route-specific link/code or contact dispatch before route details can be shown.

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

- `ASSIGNED_ROUTE` returns route summary and ordered stops; the app builds platform map URLs locally from each stop coordinate or formatted address.
- `NO_ASSIGNED_ROUTE` returns a safe empty state.
- HTTP/API failures stay in `consent_recorded` with a retry message.

The app moves to `route_ready` only after an `ASSIGNED_ROUTE` response. Stop cards expose `Open map`, which hands off to the OS map handler with coordinates first and formatted address fallback without committing to a provider SDK. From there, the driver can explicitly start delivery; the app requests foreground location permission at that point and enters `delivery_active` only when the OS grants permission. After `delivery_active`, `src/driverEvents.ts` records `ROUTE_STARTED`, foreground one-shot `LOCATION_UPDATED`, continuous/background-capable `LOCATION_UPDATED`, `STOP_DELIVERED`, `STOP_FAILED`, and `ROUTE_COMPLETED` events to `POST /driver/events` with the active driver bearer token. Stop proof now stores metadata (`proof` payload with note/reason/source, uploaded photo media references, signature drawing evidence, and barcode scan evidence). The durable app-side offline queue can retain failed `ROUTE_STARTED`, `LOCATION_UPDATED`, `STOP_DELIVERED`, `STOP_FAILED`, `ROUTE_COMPLETED`, and proof media upload attempts for retry or discard across app restarts; production proof-media storage hardening and physical-device background smoke evidence remain later slices. Duplicate event responses are treated idempotently as recorded.

## Durable offline queue boundary

`src/offlineSubmissionQueue.ts` owns queue identity, retry bookkeeping, malformed payload recovery, and storage serialization for pending driver events/proof media upload attempts. `src/expoOfflineSubmissionQueueStorage.ts` adapts the queue to Expo-compatible AsyncStorage.

The queue stores retry metadata, driver event payloads, and proof media file URI references. It does not store driver access tokens; token persistence remains isolated in Expo SecureStore through `src/expoSecureDriverAccessTokenStore.ts`. AsyncStorage is treated as unencrypted app storage, so the queue is not a replacement for server-side proof storage or secret storage.

Production app-side discard policy is now explicit in `OFFLINE_SUBMISSION_QUEUE_DEFAULT_POLICY`:

- maximum retained retry attempts: `5`
- maximum local queue age: `72 hours`
- before each retry, items older than the policy window or already at the attempt limit are discarded without hitting the live server
- after a failed retry reaches the attempt limit, the item is discarded instead of being retained indefinitely
- delivery finish calls `finishDeliveryAfterActive()` to stop continuous tracking and record or queue a `ROUTE_COMPLETED` event
- after route completion is recorded, delivery finish calls `discardRouteSubmissions(routePlanId)` to remove local retry items scoped to the completed route while leaving unrelated route or unscoped items intact
- if route completion recording fails, the `ROUTE_COMPLETED` event is queued and route-scoped items are not discarded in that branch
- the runtime guard panel exposes `Reset driver session`, which stops continuous tracking, clears the secure driver access token, clears route/session UI state, and calls `clear()` to remove every pending local retry item from durable storage

This policy only governs app-side AsyncStorage metadata and file URI references. Server-side proof-media storage, signed retrieval, malware scanning, and retention/deletion evidence remain server/release work.

## Proof media upload boundary

`src/proofMediaUpload.ts` exports `createProofMediaUploadApiClient({ baseUrl, accessToken, fetchImpl })`, which posts captured proof photos as multipart form data:

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

## Signature and barcode proof boundary

`src/proofSignatureCapture.ts` records signature drawing evidence as vector metadata (`signatureId`, signer name, stroke count, point count) instead of storing raw image data in the driver event payload.

`src/proofBarcodeCapture.ts` records barcode evidence (`barcodeId`, symbology, data, capturedAt) from the native scanner boundary. The Expo implementation uses `expo-camera`'s modern scanner when available on the device; unavailable or permission-denied paths stay visible and do not create proof evidence.

## Runtime API mode

By default the app uses local mock services. Setting `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` switches route+phone lookup to the live delivery-server `POST /driver/route-access/lookup` API. The delivery server now supports both exact route-plan UUID contexts and shared company/route-scope contexts that can return `MULTIPLE_MATCHES`; the app treats ambiguous responses as display-only guidance and does not continue to consent, assigned-route, event, or proof-media calls until a route-specific `INVITED` response supplies driver access. A successful `INVITED` lookup stores the returned short-lived `driverAccess` token in Expo SecureStore via `src/expoSecureDriverAccessTokenStore.ts`. The app clears denied lookup sessions and clears expired or malformed persisted token payloads before reuse. Downstream live consent, assigned-route, driver-event, and proof-media API clients are built from the active route lookup token via `src/driverApiClients.ts`.

If a live downstream consent, assigned-route, driver-event, proof-media upload, or offline retry call returns `401`, the app classifies the token as expired driver access. It shows route+phone re-lookup guidance, clears the secure token, stops/clears active route UI state, and leaves retryable event/proof submissions in the non-secret offline queue so they can be retried after the driver obtains a fresh route-scoped token.

The persisted payload stores only the driver token and route access identifiers required for downstream consent/assigned-route calls. It does not change the server-owned token TTL, refresh policy, tenant boundary, or route/stop authorization checks.

## Follow-up

- Define release environment profiles and any server-issued token refresh, OTP, managed identity, or stronger re-auth UX beyond the current route+phone re-lookup recovery for short-lived token expiry.
- Add production proof-media object storage, signed access, malware scanning/private evidence storage, and deployed cleanup/scheduler evidence. The delivery server already exposes a local/manual cleanup runner via `npm run driver:proof-media:cleanup`.
- Add physical-device background tracking smoke evidence and production privacy disclosures for updates emitted while the app process cannot reach the live delivery server. Expo SDK 54 requires foreground permission before background permission and native background configuration for real background tracking.
