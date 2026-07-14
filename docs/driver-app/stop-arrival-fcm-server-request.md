# Stop Arrival FCM Server Request

## Objective

Implement server-side FCM stop-arrival alerts for the Clever Driver app.

When an active driver enters the allowed arrival radius for the **current delivery stop**, the server should send an FCM push notification. Tapping that notification opens the driver app directly to the `Arrival Check` proof screen where the driver can:

- take / attach a proof photo,
- enter `Delivery Notes`,
- enter `Location Tip`,
- enter `Additional Notes`,
- complete the stop.

The app-side payload parser and tap routing already exist in PR #116 / branch `driver-static-route-preview`.

## Current app-side contract already implemented

### Supported notification data payload

The app accepts only this data contract:

```json
{
  "type": "stop_arrival",
  "routePlanId": "<route plan id>",
  "deliveryStopId": "<delivery stop id>"
}
```

Required fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Must be exactly `stop_arrival`. |
| `routePlanId` | string | yes | Must match the route loaded in the driver app. |
| `deliveryStopId` | string | yes | Must match a stop on that route. |

The app ignores malformed payloads or payloads for other notification types.

### App behavior on notification tap

1. Look up loaded route by `routePlanId`.
2. Look up stop by `deliveryStopId`.
3. If the route is active and the stop is not completed, navigate directly to `Arrival Check`.
4. If the route is not active, navigate to `Route Details` and prompt the driver to start pickup first.
5. If the stop is already completed, navigate to `Route Details` and show completed-state feedback.
6. If route data has not loaded yet, keep the payload pending and retry after assigned routes load.

Manual `Arrived` remains available as a fallback.

## Required server-side work

### 1. Register driver push tokens

Add a driver-authenticated endpoint to register / refresh native FCM tokens.

Recommended endpoint:

```http
PUT /api/driver/mobile/push-token
Authorization: Bearer <driver access token>
Content-Type: application/json
```

Recommended request body:

```json
{
  "platform": "android",
  "devicePushToken": "<fcm token>",
  "appId": "com.evns.cleverdriverapp",
  "appVersion": "0.1.0",
  "deviceId": "<stable app/device installation id if available>",
  "locale": "en-CA",
  "timezone": "America/Vancouver"
}
```

Recommended response:

```json
{
  "ok": true,
  "registeredAt": "2026-06-11T08:00:00.000Z"
}
```

Notes:

- Use the same driver access token trust boundary as assigned-route and driver-event APIs.
- Upsert by `(driverId, platform, devicePushToken)` or `(driverId, deviceId)` if a stable device id exists.
- Store `lastSeenAt`, `revokedAt`, `appVersion`, and `platform`.
- Remove / revoke tokens when FCM returns invalid-token / unregistered-token errors.
- A logout unregister endpoint is useful but not strictly required for first delivery if invalid-token cleanup exists.

Optional unregister endpoint:

```http
DELETE /api/driver/mobile/push-token
Authorization: Bearer <driver access token>
Content-Type: application/json

{
  "platform": "android",
  "devicePushToken": "<fcm token>"
}
```

### 2. Evaluate stop arrival from location updates

Use the existing driver `LOCATION_UPDATED` stream / event source as the input.

Server should evaluate only when all conditions are true:

1. Driver has an active route session.
2. Route has not been completed.
3. Company pickup step is already confirmed / route is in delivery stop sequence.
4. There is a current active delivery stop.
5. Current stop is not completed.
6. Current driver location is within the arrival radius.
7. The stop-arrival notification has not already been sent for this `(driverId, routePlanId, deliveryStopId)`.

### 3. Arrival radius

Default radius for proof-entry notification:

```text
50 meters
```

Reason:

- `120m` is too broad for a proof photo / delivery notes workflow.
- `50m` gives some GPS tolerance while keeping the alert close enough to the real destination.

Recommended config:

```ts
STOP_ARRIVAL_RADIUS_METERS = 50
```

Allow this value to become tenant / route / environment configurable later, but use `50m` as the first production default.

Important distinction:

- A wider geofence, e.g. `100m~150m`, may be useful later for **pre-arrival guidance**.
- The `stop_arrival` notification should stay tight because it opens proof capture.

### 4. Distance calculation

Use haversine distance or the existing geospatial helper.

Inputs:

- Driver location: latest location update latitude / longitude.
- Stop location priority:
  1. stop explicit coordinates,
  2. snapped route stop point coordinates,
  3. do not send if no usable coordinates exist.

Do not send this alert based on text address only.

### 5. Deduplication / idempotency

Create durable notification state, for example:

```text
driver_stop_arrival_notifications
- id
- driver_id
- route_plan_id
- delivery_stop_id
- device_push_token_id nullable
- status: pending | sent | failed | skipped
- distance_meters_at_trigger
- triggered_at
- sent_at nullable
- fcm_message_id nullable
- failure_code nullable
- failure_message nullable
- created_at
- updated_at

unique(driver_id, route_plan_id, delivery_stop_id)
```

Required behavior:

- Send at most once per stop per driver route session.
- If two location updates cross the radius concurrently, only one notification should be dispatched.
- Do not send for completed stops.
- Do not send after route completion.

### 6. FCM message shape

Recommended FCM message:

```json
{
  "token": "<driver device FCM token>",
  "notification": {
    "title": "Arrived near Stop <sequence>",
    "body": "Tap to add proof photo and delivery notes."
  },
  "data": {
    "type": "stop_arrival",
    "routePlanId": "<route plan id>",
    "deliveryStopId": "<delivery stop id>"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "stop-arrivals",
      "clickAction": "OPEN_STOP_ARRIVAL"
    }
  }
}
```

Notes:

- `data` values must be strings for FCM compatibility.
- `channelId` should match app channel intent: `stop-arrivals`.
- Use high priority because this is an active-delivery operational alert.
- If multiple active device tokens exist for a driver, send to all currently valid tokens or the latest active token depending on server device policy.

### 7. Error handling

Handle FCM errors explicitly:

| FCM result | Server action |
| --- | --- |
| success | Mark notification state `sent`, store FCM message id. |
| invalid / unregistered token | Revoke token, mark failed with token error. |
| transient FCM error | Retry with bounded backoff. |
| route / stop no longer active | Mark skipped; do not retry. |

### 8. Observability

Add logs / metrics for:

- location update processed for stop-arrival check,
- entered radius,
- notification deduped,
- notification sent,
- FCM send failed,
- invalid token revoked.

Avoid logging precise driver location in plaintext beyond existing privacy policy and operational retention rules.

## Acceptance criteria

1. Driver starts a route and confirms pickup.
2. Driver location enters `<= 50m` from the current active stop.
3. Server sends exactly one FCM notification with:

```json
{
  "type": "stop_arrival",
  "routePlanId": "...",
  "deliveryStopId": "..."
}
```

4. Tapping the notification opens the app to `Arrival Check` for that stop.
5. Repeated location updates inside the radius do not send duplicate notifications.
6. Completed stops do not send notifications.
7. Future stops do not send notifications before they become current.
8. If FCM token is invalid, server revokes it and records dispatch failure.

## App-side local validation path before server work

Until server FCM dispatch exists, the app schedules a local notification from the active location stream when the current stop enters the same `50m` radius. This exists only to validate UX on a real device without server FCM.

That local fallback should not be treated as the final production architecture; server-side dispatch is still required for reliable operations visibility and token/device lifecycle management.

## Files touched on app side

- `src/domain/notifications/stopArrivalNotifications.ts`
  - payload parsing,
  - radius candidate logic,
  - default `50m` radius.
- `src/platform/expo/notifications/expoStopArrivalNotificationService.ts`
  - Expo Notifications channel,
  - local notification scheduling,
  - notification tap listener,
  - native device token read boundary.
- `src/app/AppRoot.tsx`
  - notification tap routing to `Arrival Check`,
  - pending notification retry after route load,
  - active location stream local fallback trigger.
