# clever-driver-app

Dedicated native mobile app repository for Clever delivery drivers.

## MVP direction

1. Driver accesses the app with route context plus phone number.
2. Driver confirms the company/shop/route guidance for the assigned work.
3. Driver accepts location-information and personal-information consent.
4. Driver views the route assigned for the current delivery day.

## Platform direction

- iOS and Android native mobile app.
- Expo/React Native is the selected bootstrap stack for the first implementation slice.
- PWA/web is not the primary driver MVP platform because location permissions, foreground/background services, security, and controlled distribution matter for this app.

## Repository boundaries

- `clever-delivery-server` is the source of truth for companies/shops, drivers, routes, orders, assignments, consent records, and location/compliance logs.
- This repository owns the driver-facing mobile UX, runtime, local verification, and mobile release evidence.
- Phone number alone must not be treated as a global driver identity; route/company context is part of the access boundary.

## Current app flow

The app includes an interactive route access screen:

- route context + E.164 phone validation before lookup
- local mock service for delivery-server `POST /driver/route-access/lookup`
- company/shop/route guidance for `INVITED`, plus safe multi-company ambiguity guidance that does not expose route/stop/customer data or driver access tokens
- app-side consent gate for required location-information and personal-information consent
- local mock service and API client boundary for delivery-server `POST /driver/consents`
- driver access token parsing from route lookup and API-client handoff helper
- assigned route mock/API boundary for delivery-server `GET /driver/assigned-route`
- route summary, ordered stop cards, and OS map handoff after consent moves the flow to `route_ready`
- explicit delivery start action that requests OS foreground location permission before `delivery_active`
- route started, foreground one-shot location update, continuous background-capable location streaming, native proof photo URI capture, proof media upload references, signature/barcode proof capture, richer stop delivered/failed proof-event mock/API boundaries, and route-completed delivery finish cleanup for delivery-server `POST /driver/events` after delivery_active succeeds
- safe denial messages for `NOT_FOUND`, `DISABLED`, and `BLOCKED`
- live `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` switch for route lookup, native secure storage for the short-lived driver token, and live downstream consent/assigned-route/driver-event/proof-media clients; durable app-side offline queue/retry for pending driver events and proof media using AsyncStorage-backed non-secret queue metadata, with app-side discard thresholds for repeated failure, stale age, recorded route completion cleanup, and an explicit driver session reset action that clears secure access plus queued retry state; delivery-server local/manual proof-media cleanup support; production proof-media object storage/access/scanning hardening, deployed cleanup evidence, physical-device smoke evidence, and store/privacy disclosure evidence left for follow-up slices

See `docs/route-access-flow.md` for the app-side route access, consent, assigned-route, native map handoff, and delivery evidence boundary.


## Repository guardrails

- Human contribution workflow is documented in `CONTRIBUTING.md`.
- Security/privacy reporting and evidence handling are documented in `SECURITY.md`.
- Production release, store disclosure, and physical-device smoke evidence are tracked in `docs/release-readiness.md`.
- A public `LICENSE` file has not been selected yet; do not add reuse terms without an explicit owner decision.

## Local setup

Recommended Node baseline is recorded in `.nvmrc` and matches the Expo SDK 54 minimum Node floor used by this bootstrap.

```bash
nvm use
npm install
npm run start
```

Optional live API mode (route lookup saves the returned short-lived driver token through Expo SecureStore and clears expired/invalid persisted tokens before reuse; see `.env.example`):

```bash
EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://delivery.example.com npm run start
```

Native launch helpers:

```bash
npm run ios
npm run android
```

## Verification commands

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
npx expo install --check
git diff --check
```

`npm run build` exports Android and iOS JavaScript bundles into ignored `dist/` folders. It is not an App Store/Play Store binary build. Native binary candidates are described by `eas.json`:

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform all --profile production
```

Preview builds are for internal physical-device evidence collection. Production builds are store/TestFlight/Play candidates and require owner-controlled Expo, Apple, Google, signing, and environment-variable setup before execution.

Before opening a PR, confirm the branch is issue-linked, the PR targets `dev`, generated outputs and physical-device evidence artifacts remain ignored, and `.env.example` still documents every public runtime env key used by the app.

## Documentation map

- `docs/project-brief.md` — product role, MVP scenarios, platform decision, and implementation sequencing.
- `docs/repository-setup.md` — repo baseline, scripts, ignore policy, and follow-up setup notes.
- `docs/route-access-flow.md` — app-side route access, consent, assigned route, native map handoff, delivery event, proof media, and offline queue boundary.
- `docs/release-readiness.md` — production distribution, store/privacy disclosure, physical-device smoke evidence, and release blockers.
- `docs/store-privacy-disclosure-draft.md` — non-final App Store / Google Play privacy disclosure worksheet for owner/legal review.
- `docs/physical-device-smoke-runbook.md` — executable iPhone/Android smoke sequence and external evidence capture rules.
- `CONTRIBUTING.md` — human workflow, validation, privacy review points, and generated-file guardrails.
- `SECURITY.md` — vulnerability reporting, sensitive evidence handling, and current data-handling expectations.
- `AGENTS.md` — agent workflow, issue/branch/PR rules, and verification requirements.
