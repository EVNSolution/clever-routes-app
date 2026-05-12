# Repository setup notes

## Purpose

This document records the repo baseline for the `clever-driver-app` implementation branch. Product scope and scenario details remain in `docs/project-brief.md`; agent workflow rules remain in `AGENTS.md`.

## Mobile runtime baseline

- Framework: Expo / React Native
- Target runtime: native iOS and Android app
- Package manager: npm with `package-lock.json`
- Node floor: `.nvmrc` pins `20.19.4`; `package.json` allows Node `>=20.19.4`
- Entry point: `index.ts` registering `App.tsx`
- Current implementation depth: local Expo route+phone lookup, company guidance, safe multi-company ambiguity guidance, consent gate, assigned-route screen, stop-card OS map handoff, driver access token handoff, native secure token persistence/expiry clearing, optional `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` live API mode, live downstream `401` expired-token recovery through secure-token clearing plus route+phone re-lookup guidance, delivery-start foreground location permission gate, route-started driver event boundary, foreground one-shot `LOCATION_UPDATED` event sync, continuous background-capable `LOCATION_UPDATED` task setup, native proof photo URI capture, proof media upload references, local proof-media smoke mock modes, scanner-rejected proof photo recapture guidance, signature/barcode proof capture, richer stop delivered/failed proof metadata controls, durable app-side offline queue/retry for driver events and retryable proof media, explicit app-side offline queue retention/discard thresholds, delivery finish `ROUTE_COMPLETED` cleanup, driver session reset/sign-out cleanup for secure access plus queued retry state, and EAS preview/production native build-profile scaffolding; delivery-server now has a proof-media scan rejection hook and local cleanup runner, while server-issued token refresh/strong re-auth, production proof-media object storage/signed access/deployed scanner evidence, physical-device background smoke evidence, owner-controlled signing/store setup, and store/privacy disclosure evidence remain later slices

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start` | Start Expo local dev server |
| `npm run ios` | Start Expo and launch iOS target when available |
| `npm run android` | Start Expo and launch Android target when available |
| `npm run test` | Run Node test runner over TypeScript tests through `tsx` |
| `npm run typecheck` | Run TypeScript without emitting build outputs |
| `npm run lint` | Run Expo ESLint config |
| `npm run check:workspace` | Run typecheck and tests together |
| `npm run check:native-release` | Validate source-controlled Expo/EAS identity, permission, profile, and public runtime env release preflight gates |
| `npm run build` | Export Android and iOS JS bundles to ignored `dist/` folders |

## Native build profiles

`eas.json` defines the source-controlled native build profile scaffold:

| Profile | Purpose | Command |
| --- | --- | --- |
| `preview` | Internal physical-device evidence builds; Android emits `.apk`; iOS uses internal distribution credentials | `npx eas-cli build --platform android --profile preview` / `npx eas-cli build --platform ios --profile preview` |
| `production` | Store/TestFlight/Google Play candidate archives | `npx eas-cli build --platform all --profile production` |

The EAS config intentionally does not commit Expo project IDs, Apple/Google credentials, signing files, store metadata, or concrete delivery-server origins. EAS `preview` and `production` environment values must be created in the owner-controlled Expo/EAS project before native builds are run.

`eas.json` sets `cli.requireCommit=true` to bind native build evidence to committed source. It also sets `cli.appVersionSource=remote`; `app.json` keeps initial `ios.buildNumber` and `android.versionCode` at `1` so the first remote version sync has a clear baseline, while production builds use `autoIncrement`.

`npm run check:native-release` must pass before EAS build evidence or release-sensitive PRs. This preflight is intentionally source-controlled and secret-free: it checks bundle/package identity, native version pins, permission plugin copy, preview/production profile shape, and `.env.example` coverage. It does not prove Expo/EAS project ownership, Apple/Google signing authority, store/private distribution approval, privacy copy approval, or the public license decision.

## Ignore policy reviewed

`.gitignore` is configured to keep generated or sensitive local state out of git:

- local agent/runtime state: `.omx/`
- dependencies and package-manager caches: `node_modules/`, `.npm/`, `.pnpm-store/`
- secrets and local env files: `.env`, `.env.*`, while keeping `.env.example` trackable for the optional live delivery-server base URL
- build/test/compiler outputs: `dist/`, `build/`, `coverage/`, `.cache/`, `.metro-cache/`, `*.tsbuildinfo`
- Expo/React Native local output: `.expo/`, `.expo-shared/`, `.eas/`, `web-build/`, `*.jsbundle`
- generated native build/tooling output: root/Android Gradle folders, Android `.cxx`, app build/captures/local properties, iOS build/DerivedData/Pods/xcuserdata state, heap profiles
- mobile signing artifacts, store credentials, and binaries: `*.apk`, `*.apks`, `*.aab`, `*.ipa`, `*.dSYM/`, `credentials.json`, `eas-credentials.json`, `google-play-service-account*.json`, `app-store-connect-api-key*.json`, `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`, `*.pem`
- release/physical-device smoke evidence artifacts: `evidence/`, `release-evidence/`, `smoke-evidence/`, matching `docs/*evidence/` folders, completed `release-evidence-manifest-*.md` copies, and `clever-driver-*` screenshot/video/log files generated from `docs/physical-device-smoke-runbook.md`
- OS/editor noise: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`

Generated `android/` and `ios/` source directories are not globally ignored. If this app later adopts Expo prebuild or bare native customization, generated native source can be intentionally reviewed and committed while build outputs remain ignored.

## Dependency audit note

`package.json` currently overrides transitive `postcss` to `8.5.10` because the Expo SDK 54 Metro dependency range otherwise resolves to a moderate npm audit finding. The override keeps `npm audit --audit-level=moderate` clean without using `npm audit fix --force`, which would apply a breaking Expo downgrade. Re-check this override when Expo updates its transitive Metro/PostCSS dependency.

## Pre-PR baseline audit

Before opening an implementation PR, re-check these repo baseline files together with the code diff:

- `.gitignore`: generated Expo/native outputs, signing artifacts, local env files, package caches, compiler artifacts, and agent/runtime state stay ignored; `android/` and `ios/` source directories are intentionally not globally ignored.
- physical-device evidence: screenshots, videos, logs, generated binaries, signing files, credentials, and production PII stay outside git; keep only sanitized references in issues/PRs.
- `.env.example`: every bundled `EXPO_PUBLIC_*` runtime key used by the app is documented, and secret `.env*` files stay ignored.
- `package.json` / `package-lock.json`: scripts, Node floor, Expo SDK dependencies, and audit overrides match the implementation.
- `app.json`: bundle/package identifiers, native build versions, permission copy, plugins, background-location settings, and static project/bootstrap issue metadata match the current native capability slice.
- `eas.json`: preview/internal and production/store profile settings, EAS environment names, require-commit policy, and app version source match the release evidence plan.
- `npm run check:native-release`: local native release config preflight passes, while external owner-controlled blockers remain tracked in `docs/release-readiness.md`.
- `.github/PULL_REQUEST_TEMPLATE.md`: target issue, change-control issue, concurrent-work gate, validation evidence, and context/wiki completion fields are filled before issue closure.
- `CONTRIBUTING.md` and `SECURITY.md`: human workflow, security/privacy reporting, sensitive evidence handling, and generated-file guardrails stay current.
- `docs/release-readiness.md`: physical-device smoke matrix, store/privacy disclosure checklist, and release blockers match current runtime behavior.
- `LICENSE`: remains intentionally absent until an owner selects reuse/distribution terms.

## Follow-up setup decisions

These items are intentionally left for later issues because they affect API, compliance, release, or device behavior beyond this bootstrap:

1. Store/private distribution policy and owner-controlled EAS environment values for preview/production.
2. Server-issued driver session/access token refresh, OTP, managed identity, or stronger re-auth UX beyond the current app-side route+phone re-lookup recovery after short-lived token expiry.
3. Route invite/deep-link URL format and route access code format.
4. Consent legal copy source and consent version contract.
5. Production proof media storage policy: persistent photo/signature/barcode storage ownership, access, retention, and deletion rules.
6. Store disclosure matrix and production privacy copy for continuous background location; tracked in `docs/release-readiness.md`.
7. Expo/EAS project ownership, App Store/Play Store signing ownership, and credential rotation policy.
8. Minimum supported iOS/Android versions and physical-device background-location smoke matrix; tracked in `docs/release-readiness.md`.
9. Physical-device validation of app-side offline retry/discard behavior after network loss, route completion, tracking stop, and the explicit driver session reset/sign-out action.
10. GitHub Actions CI, CODEOWNERS, and additional branch/ruleset automation after the control-plane preflight/admin decision required by `AGENTS.md`.
11. Public license/reuse terms, if the owner decides to grant them.
