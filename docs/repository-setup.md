# Repository setup notes

## Purpose

This document records the repo baseline for the `clever-driver-app` implementation branch. Product scope and scenario details remain in `docs/project-brief.md`; agent workflow rules remain in `AGENTS.md`.

## Mobile runtime baseline

- Framework: Expo / React Native
- Target runtime: native iOS and Android app
- Package manager: npm with `package-lock.json`
- Node floor: `.nvmrc` pins `20.19.4`; `package.json` allows Node `>=20.19.4`
- Entry point: `index.ts` registering `App.tsx`
- Current implementation depth: placeholder navigation skeleton and pure flow guards only; no real driver API calls or background location collection in this slice

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
- secrets and local env files: `.env`, `.env.*`, while keeping `.env.example` trackable
- build/test outputs: `dist/`, `build/`, `coverage/`, `.cache/`, `.metro-cache/`
- Expo/React Native local output: `.expo/`, `.expo-shared/`, `web-build/`, `*.jsbundle`
- generated native build output: Android Gradle/app build folders, iOS build/Pods folders
- mobile signing artifacts and binaries: `*.apk`, `*.aab`, `*.ipa`, `*.dSYM/`, `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`, `*.pem`
- OS/editor noise: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`

Generated `android/` and `ios/` source directories are not globally ignored. If this app later adopts Expo prebuild or bare native customization, generated native source can be intentionally reviewed and committed while build outputs remain ignored.

## Dependency audit note

`package.json` currently overrides transitive `postcss` to `8.5.10` because the Expo SDK 54 Metro dependency range otherwise resolves to a moderate npm audit finding. The override keeps `npm audit --audit-level=moderate` clean without using `npm audit fix --force`, which would apply a breaking Expo downgrade. Re-check this override when Expo updates its transitive Metro/PostCSS dependency.

## Follow-up setup decisions

These items are intentionally left for later issues because they affect API, compliance, release, or device behavior beyond this bootstrap:

1. Delivery server driver-facing API base URL and environment strategy.
2. Route invite/deep-link URL format and route access code format.
3. Consent legal copy source and consent version contract.
4. Foreground/background location permission copy and store disclosure matrix.
5. EAS/App Store/Play Store build profile and signing ownership.
6. Minimum supported iOS/Android versions and physical-device smoke matrix.
