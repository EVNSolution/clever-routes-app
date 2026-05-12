# Repository setup notes

## Purpose

This document records the repo baseline for the `clever-driver-app` implementation branch. Product scope and scenario details remain in `docs/project-brief.md`; agent workflow rules remain in `AGENTS.md`.

## Mobile runtime baseline

- Framework: Expo / React Native
- Target runtime: native iOS and Android app
- Package manager: npm with `package-lock.json`
- Node floor: `.nvmrc` pins `20.19.4`; `package.json` allows Node `>=20.19.4`
- Entry point: `index.ts` registering `App.tsx`
- Current implementation depth: local Expo route+phone lookup, company guidance, consent gate, assigned-route screen, driver access token handoff, native secure token persistence/expiry clearing, optional `EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL` live API mode, delivery-start foreground location permission gate, route-started driver event boundary, foreground one-shot `LOCATION_UPDATED` event sync, continuous background-capable `LOCATION_UPDATED` task setup, native proof photo URI capture, proof media upload references, signature/barcode proof capture, richer stop delivered/failed proof metadata controls, and app-side offline queue/retry for driver events and proof media; production proof-media storage hardening and physical-device background smoke evidence remain later slices

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
| `npm run build` | Export Android and iOS JS bundles to ignored `dist/` folders |

## Ignore policy reviewed

`.gitignore` is configured to keep generated or sensitive local state out of git:

- local agent/runtime state: `.omx/`
- dependencies and package-manager caches: `node_modules/`, `.npm/`, `.pnpm-store/`
- secrets and local env files: `.env`, `.env.*`, while keeping `.env.example` trackable for the optional live delivery-server base URL
- build/test outputs: `dist/`, `build/`, `coverage/`, `.cache/`, `.metro-cache/`
- Expo/React Native local output: `.expo/`, `.expo-shared/`, `web-build/`, `*.jsbundle`
- generated native build output: Android Gradle/app build folders, iOS build/Pods folders
- mobile signing artifacts and binaries: `*.apk`, `*.aab`, `*.ipa`, `*.dSYM/`, `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`, `*.pem`
- OS/editor noise: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`

Generated `android/` and `ios/` source directories are not globally ignored. If this app later adopts Expo prebuild or bare native customization, generated native source can be intentionally reviewed and committed while build outputs remain ignored.

## Dependency audit note

`package.json` currently overrides transitive `postcss` to `8.5.10` because the Expo SDK 54 Metro dependency range otherwise resolves to a moderate npm audit finding. The override keeps `npm audit --audit-level=moderate` clean without using `npm audit fix --force`, which would apply a breaking Expo downgrade. Re-check this override when Expo updates its transitive Metro/PostCSS dependency.

## Pre-PR baseline audit

Before opening an implementation PR, re-check these repo baseline files together with the code diff:

- `.gitignore`: generated Expo/native outputs, signing artifacts, local env files, package caches, and agent/runtime state stay ignored; `android/` and `ios/` source directories are intentionally not globally ignored.
- `.env.example`: every bundled `EXPO_PUBLIC_*` runtime key used by the app is documented, and secret `.env*` files stay ignored.
- `package.json` / `package-lock.json`: scripts, Node floor, Expo SDK dependencies, and audit overrides match the implementation.
- `app.json`: bundle/package identifiers, permission copy, plugins, and background-location settings match the current native capability slice.
- `.github/PULL_REQUEST_TEMPLATE.md`: target issue, change-control issue, concurrent-work gate, validation evidence, and context/wiki completion fields are filled before issue closure.

## Follow-up setup decisions

These items are intentionally left for later issues because they affect API, compliance, release, or device behavior beyond this bootstrap:

1. Release environment profiles and store/private distribution policy.
2. Server-issued driver session/access token refresh or re-auth UX after the current short-lived route+phone lookup token expires.
3. Route invite/deep-link URL format and route access code format.
4. Consent legal copy source and consent version contract.
5. Production proof media storage policy: persistent photo/signature/barcode storage ownership, offline queue retention, and retry/discard rules.
6. Store disclosure matrix and production privacy copy for continuous background location.
7. EAS/App Store/Play Store build profile and signing ownership.
8. Minimum supported iOS/Android versions and physical-device background-location smoke matrix.
9. Production persistence decision for the app-side offline queue if in-memory retry is insufficient for store builds.
