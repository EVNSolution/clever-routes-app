# Driver Route OSRM Android Smoke Checklist

Date: 2026-06-04  
Scope: driver route guidance/OSRM validation only. Do not retest or redesign login/auth beyond normal driver access lookup.

## Hard safety gates

- Use only synthetic validation data marked with `[TEST]`, `TEST-OSRM`, or `validation-only.example.test`.
- Do not directly edit real production orders, customers, drivers, payments, or route status rows.
- Do not send notifications to real drivers/customers.
- Do not create or complete real payments/orders.
- Do not open an admin backdoor, auth bypass, sample-token loader, or hidden privileged session.
- Do not auto-deploy. Install/update the connected Android device only from an explicitly selected build artifact.

## Environment precheck

1. Confirm the Android device is connected and visible to the tooling.
2. Confirm the app build is from branch `cc-222-driver-route-osrm` or a PR artifact for that branch.
3. Confirm the delivery API is from branch `cc-222-route-osrm-server` or a PR artifact for that branch.
4. Confirm the delivery server exposes `GET /driver/assigned-route` and has an explicit OSRM base URL configured (`DRIVER_ROUTE_OSRM_BASE_URL` or `OSRM_BASE_URL`).
5. Confirm the OSRM service is private/internal or otherwise explicitly approved; never rely on a silent public-router default.

## Synthetic route data requirements

Each smoke route must include:

- Route name prefixed with `[TEST]`.
- Order names containing `TEST-OSRM`.
- At least one route per app tab/state: upcoming, active, completed/fallback.
- Full stop address fields and finite latitude/longitude for every non-fallback stop.
- `routeGeometry` as GeoJSON `LineString` with at least two `[longitude, latitude]` points, or `null` for fallback validation.
- `routeMetrics.distanceMeters` in meters and `routeMetrics.durationSeconds` in seconds, or `null` when OSRM is unavailable.
- `routeStopPoints[]` with `deliveryStopId`, `sequence`, `inputCoordinates`, and snap evidence, without exposing unrelated drivers or orders.

The app fixture source of truth for tab/scenario shape is:

- `src/domain/route/assignedRouteValidationScenarios.ts`

## Android smoke scenarios

### 1. Upcoming route with OSRM metrics

- Open the app on the connected Android device.
- Look up a synthetic upcoming route.
- Record evidence that Today’s Route shows:
  - Route date, region, and ordered stops.
  - Estimated Distance from `routeMetrics.distanceMeters`.
  - Estimated Time from `routeMetrics.durationSeconds`.
- Open Route Details and confirm the same distance/duration are shown.
- Open Live Tracking and confirm the map panel says `OSRM route ready`.

### 2. Active route with geometry

- Start or select a synthetic active route without notifying real users.
- Confirm route sequence and current stop remain visible.
- Confirm distance/ETA use route-level metrics and do not require a third-party map SDK.
- Confirm stop address and coordinates are still available for native map launch.

### 3. Completed/fallback route

- Select a synthetic completed/fallback route where OSRM fields are null.
- Confirm the app remains usable and shows `Not available` for distance/time.
- Confirm the map panel says `Route geometry pending` rather than crashing.

### 4. Regression guard

- Confirm the app does not show any admin backdoor/session-loader/sample-token UI.
- Confirm login/auth redesign screens were not introduced.
- Confirm proof-photo/tip/arrival flows are not blocked by the OSRM fields being absent.

## Evidence to capture

- Build artifact id or commit SHA for app and server.
- Device model, Android version, and test timestamp.
- Redacted screenshots for each scenario above.
- Redacted assigned-route JSON showing only synthetic data.
- OSRM request/response status evidence without tokens, secrets, or real user PII.
- Cleanup/dry-run record showing synthetic data can be removed or is isolated.
