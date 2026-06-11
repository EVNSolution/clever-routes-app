# Stop Arrival FCM Server Request

## Goal

When an active driver enters the allowed arrival radius for the current delivery stop, send a push notification. Tapping the notification must open the driver app directly to the stop proof screen where the driver can take a photo and enter delivery notes / location tips.

The driver app now supports the client-side payload contract and tap routing. Server-side token registration, distance evaluation, and FCM dispatch are intentionally **not implemented in the app** in this change.

## Client payload contract

Send an FCM notification with this data payload:

```json
{
  "type": "stop_arrival",
  "routePlanId": "<route plan id>",
  "deliveryStopId": "<delivery stop id>"
}
```

Recommended visible notification copy:

- Title: `Arrived near Stop <sequence>`
- Body: `Tap to add proof photo and delivery notes.`

The app ignores payloads that do not match `type=stop_arrival` or that omit `routePlanId` / `deliveryStopId`.

## Driver app behavior

On notification tap:

1. Find the loaded route by `routePlanId`.
2. Find the stop by `deliveryStopId`.
3. If the route is active and the stop is not completed, open `Arrival Check` directly.
4. If the route is not active, open Route Details and ask the driver to start pickup first.
5. If the stop is already completed, open Route Details and show completed-state feedback.

The manual `Arrived` button remains available as a fallback.

## Arrival-radius rule

Use the same default client radius unless dispatch config overrides it:

- Default radius: `120 meters`
- Evaluate only the current active stop, not future stops.
- Deduplicate by `(driverId, routePlanId, deliveryStopId)` so one stop does not spam multiple arrival alerts.
- Do not send for completed stops.

## Token / registration work needed later

The app can obtain the native device push token through Expo Notifications / native FCM support, but this change does not send it to the server.

Server/API work needed later:

1. Add a driver-device push-token registration endpoint.
2. Store token with driver identity, platform, app version, and last-seen timestamp.
3. Expire or replace old tokens on logout / token refresh / FCM invalid-token responses.
4. Add delivery-location processor logic that checks active route location updates against the current stop radius.
5. Send the FCM payload above when the stop enters the radius.
6. Record push dispatch outcome for operations support.

## Current no-server validation path

Until server dispatch exists, the app also schedules an immediate local notification from the active location stream when the current stop enters the same 120m radius. This lets us test the UX path on a real device without deploying server FCM work.
