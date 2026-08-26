# clever-routes-app

Dedicated native mobile app repository for Clever delivery drivers.

## MVP direction

1. Driver selects a supported country, enters the dispatch-registered phone number, and signs in with a six-digit PIN.
2. A first-time driver uses an existing Shopify invitation code once and creates the six-digit PIN; the app does not create or request the invitation.
3. Driver accepts location-information and personal-information consent.
4. Driver confirms the company/shop/route guidance and views assigned work.

## Platform direction

- iOS and Android native mobile app.
- Expo/React Native is the selected bootstrap stack for the first implementation slice.
- PWA/web is not the primary driver MVP platform because location permissions, foreground/background services, security, and controlled distribution matter for this app.

## Repository boundaries

- `clever-delivery-server` is the source of truth for companies/shops, drivers, routes, orders, assignments, consent records, and location/compliance logs.
- This repository owns the driver-facing mobile UX, runtime, local verification, and mobile release evidence.
- The delivery server owns one global driver account per normalized E.164 phone number. Phone possession alone is not authentication: existing accounts require the PIN, while first registration additionally requires an existing invitation code.
- Shopify invitation/signup creation is administrator- and user-managed. This app does not send or automate that request.

## Current app flow

The app includes an interactive route access screen:

- country-aware phone entry with a broad supported-country catalog, national display formatting, and E.164 normalization before account authentication
- phone + six-digit PIN login for existing accounts; first-registration mode adds the existing six-character invitation code and PIN confirmation without collecting a driver name
- separate server-issued account and route access tokens, with account-authenticated `POST /driver/route-access/lookup`
- company/shop/route guidance for `INVITED`, plus safe multi-company ambiguity guidance that does not expose route/stop/customer data or driver access tokens
- local proof-media upload smoke selector for success, retryable failure, and scanner rejection while the app is using mock services
- app-side consent gate for required location-information and personal-information consent
- local mock service and API client boundary for delivery-server `POST /driver/consents`
- driver access token parsing from route lookup and API-client handoff helper
- assigned route mock/API boundary for delivery-server `GET /driver/assigned-route`
- route summary, ordered stop cards, and OS map handoff after consent moves the flow to `route_ready`
- explicit delivery start action that requests OS foreground location permission before `delivery_active`
- route started, foreground one-shot location update, continuous background-capable location streaming, native proof photo URI capture, proof media upload references, scanner-rejected proof photo recapture guidance, signature proof capture, richer stop delivered/failed proof-event mock/API boundaries, and route-completed delivery finish cleanup for delivery-server `POST /driver/events` after delivery_active succeeds
- safe denial messages for `NOT_FOUND`, `DISABLED`, and `BLOCKED`
- fail-closed live runtime selection with `EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live` and `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` for account authentication and route lookup; local mocks require an explicit `mock` mode, preventing a misconfigured release from silently presenting fixture data
- native secure storage with account and route credentials kept separate, account refresh plus one route-token retry on downstream `401`, and authoritative removal of cached routes when assignments disappear; SQLCipher-backed durable offline evidence with a SecureStore key, transactional AsyncStorage migration, ordered retry/quarantine, and account-isolated sign-out behavior

See `docs/route-access-flow.md` for the app-side route access, consent, assigned-route, native map handoff, and delivery evidence boundary.


## Repository guardrails

- Human contribution workflow is documented in `CONTRIBUTING.md`.
- Security/privacy reporting and evidence handling are documented in `SECURITY.md`.
- Production release, store disclosure, and physical-device smoke evidence are tracked in `docs/release-readiness.md`.
- `.editorconfig` fixes UTF-8/LF/two-space defaults for reviewed source/docs files; `.gitattributes` normalizes source-controlled text and keeps evidence/release/signing artifacts binary if an owner-approved exception ever appears.
- A public `LICENSE` file has not been selected yet; do not add reuse terms without an explicit owner decision.

## Local setup

Recommended Node baseline is recorded in `.nvmrc` and matches the Expo SDK 54 minimum Node floor used by this bootstrap.

```bash
nvm use
npm install
npm run start
```

Live API mode (account login/registration stores server-issued account access and refresh credentials separately from route-scoped driver access; expired route access is reacquired through account refresh and route lookup, while an expired account session returns to phone + PIN login; see `.env.example`):

```bash
EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://delivery.example.com npm run start
```

Local fixture mode must be explicit:

```bash
EXPO_PUBLIC_DRIVER_RUNTIME_MODE=mock npm run start
```

Native launch helpers:

```bash
npm run ios
npm run android
```

## Verification commands

```bash
npm run check:workspace
npm run check:source-layout
npm run lint
npm run typecheck
npm run test
npm run check:native-release
npm run release:evidence:seed
npm run build
npm audit --audit-level=moderate
npx expo install --check
git diff --check
```

GitHub Actions provides a manually dispatched verification workflow in `.github/workflows/ci.yml` to avoid consuming minutes on every PR/push: dependency install, workspace checks, lint, native release
preflight, non-secret release evidence seed rendering, app bundle export, npm
audit, Expo dependency alignment, and diff whitespace checks. CI does not run
EAS binary builds and does not replace Apple/Google signing, store/private
distribution approval, privacy/legal approval, or physical-device smoke evidence.

`npm run build` exports Android and iOS JavaScript bundles into ignored `dist/` folders. It is not an App Store/Play Store binary build. Native binary candidates are described by `eas.json`:

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform all --profile production
```

Android commands are intentionally separated so a QA phone cannot be overwritten by an Expo Development Build:

| Command | Use |
| --- | --- |
| `npm run android:dev:install` | Install the arm64 `debugOptimized` development client after native dependency/config changes only |
| `npm run android:dev:start` | Reuse the installed development client for normal JS/TS work through Metro |
| `npm run android:qa:build` | Build the self-contained EAS `preview` APK for QA/device evidence |
| `npm run build:android:device-smoke` | Build a local arm64 self-contained release-mode APK for smoke diagnostics; not a distributable signed artifact |
| `npm run build:android:distribution` | Reuse Gradle outputs/cache for the reviewed direct-distribution APK |
| `npm run build:android:distribution:clean` | Force a clean direct-distribution build only for reproducibility or cache-recovery diagnosis |

The ambiguous `npm run android` command is intentionally absent. Development builds require Metro and must not be installed on QA devices.

Run `npm run check:native-release` before EAS builds or release PRs. It validates source-controlled Expo/EAS identity, permission, profile, and public runtime env baseline only; owner-controlled Expo/EAS project values, Apple/Google signing authority, store/private distribution approval, privacy copy, and license decisions remain external release blockers.

Run `npm run release:evidence:seed` from the committed source revision selected for EAS/device testing. It prints a non-secret Markdown seed with commit, app version/build identifiers, EAS build commands, preflight status, external blocker list, and tracking issues so the completed evidence manifest can be filled in the approved external evidence store.

After the copied external manifest has real EAS URLs/references, iPhone and
Android physical-device results, and owner/legal approvals, validate a local
working copy before the release decision:

```bash
npm run release:evidence:verify -- /path/to/external/release-evidence-manifest-<date>-<sha>.md
```

The verifier rejects remaining `pending` placeholders, missing device/store
approval rows, a non-`approved` release decision, and common sensitive or binary
artifact patterns. It does not replace real external evidence collection, owner
approval, or the rule that completed manifests stay out of git.

Preview builds are for internal physical-device evidence collection. Production builds are store/TestFlight/Play candidates and require owner-controlled Expo, Apple, Google, signing, and environment-variable setup before execution.

Before opening a PR, confirm the branch is issue-linked, the PR targets `dev`,
generated outputs and physical-device evidence artifacts remain ignored,
completed release evidence manifests, screenshots, videos, logs, app binaries,
and signing material stay outside git, `.env.example` still documents every
public runtime env key used by the app, and `npm run check:native-release`
passes for release-sensitive config changes.

## Documentation map

- `NAMING.md` — canonical product, repository, Expo, native app ID, URL scheme, and DSV boundary values.
- `docs/project-brief.md` — product role, MVP scenarios, platform decision, and implementation sequencing.
- `docs/code-organization.md` — source folder role index, import boundaries, test placement rules, and current-to-target migration map.
- `docs/refactor/routes-app-structure-refactor-plan.md` — execution record and validation scope for the source structure refactor.
- `docs/repository-setup.md` — repo baseline, scripts, ignore policy, text normalization policy, and follow-up setup notes.
- `docs/route-access-flow.md` — app-side route access, consent, assigned route, native map handoff, delivery event, proof media, and offline queue boundary.
- `docs/release-readiness.md` — production distribution, store/privacy disclosure, physical-device smoke evidence, and release blockers.
- `docs/release-evidence-manifest.template.md` — copy-only external evidence manifest template for release candidates.
- `docs/store-privacy-disclosure-draft.md` — non-final App Store / Google Play privacy disclosure worksheet for owner/legal review.
- `docs/physical-device-smoke-runbook.md` — executable iPhone/Android smoke sequence and external evidence capture rules.
- `CONTRIBUTING.md` — human workflow, validation, privacy review points, and generated-file guardrails.
- `SECURITY.md` — vulnerability reporting, sensitive evidence handling, and current data-handling expectations.
- `AGENTS.md` — agent workflow, issue/branch/PR rules, and verification requirements.
