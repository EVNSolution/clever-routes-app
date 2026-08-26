# Repository setup notes

## Purpose

This document records the repo baseline for the `clever-routes-app` implementation branch. Product scope and scenario details remain in `docs/project-brief.md`; agent workflow rules remain in `AGENTS.md`.

## Mobile runtime baseline

- Framework: Expo / React Native
- Target runtime: native iOS and Android app
- Package manager: npm with `package-lock.json`
- Node floor: `.nvmrc` pins `20.19.4`; `package.json` allows Node `>=20.19.4`
- Text normalization: `.editorconfig` sets UTF-8, LF, final newline, trailing-whitespace trim, and two-space indentation for source/docs files; `.gitattributes` normalizes reviewed TypeScript/JavaScript/Markdown/YAML/JSON/shell text files to LF and marks evidence/release/signing artifact patterns as binary
- Entry point: `index.ts` registering `App.tsx`
- Current implementation depth: native Expo phone + six-digit PIN account login, invitation + forced-PIN first registration without driver name, separate SecureStore account/route credentials, account refresh and account-bearer route lookup, authoritative deleted-route cache clearing, consent and assigned-route views, map/location tracking, proof capture/upload, offline retry/discard, route completion cleanup, direct Android update discovery, version 1.2.1 (`versionCode` 19) Android native source, and EAS preview/production profile scaffolding. Shopify invitation/signup creation remains manual and outside app/server automation; SMS OTP, forgotten-PIN recovery, production signing/store approval, and final privacy evidence remain later owner-approved slices.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start` | Start Expo local dev server |
| `npm run ios` | Start Expo and launch iOS target when available |
| `npm run android` | Start Expo and launch Android target when available |
| `npm run test` | Enumerate `src/**/*.test.ts` files with `scripts/run-tests.mjs`, then run the Node test runner through `tsx` without shell-glob dependence; optional path arguments narrow the run |
| `npm run typecheck` | Run TypeScript without emitting build outputs |
| `npm run lint` | Run Expo ESLint config |
| `npm run check:workspace` | Run typecheck and tests together |
| `npm run check:native-release` | Validate source-controlled Expo/EAS identity, permission, profile, and public runtime env release preflight gates |
| `npm run release:evidence:seed` | Print a non-secret release evidence seed from the committed source revision |
| `npm run release:evidence:verify -- <manifest-path>` | Validate a completed external release evidence manifest copy before release approval |
| `npm run build` | Export Android and iOS JS bundles to ignored `dist/` folders |

## Continuous integration

`.github/ISSUE_TEMPLATE/` contains release evidence intake forms for
physical-device smoke and native build/store/privacy approval issues. The forms
point to the external evidence manifests/runbooks and explicitly forbid pasting
private artifacts, signing material, screenshots, videos, secrets, raw PII, or
completed manifests into GitHub.

`.github/workflows/ci.yml` is manually dispatched when remote verification is needed, avoiding automatic Actions-minute use on every PR/push. The workflow uses the Node version from `.nvmrc`, installs from
`package-lock.json` with `npm ci`, then runs the same source-controlled gates
used before release-sensitive PRs: `npm run check:workspace`, `npm run lint`,
`npm run check:native-release`, `npm run release:evidence:seed`, `npm run
build`, `npm audit --audit-level=moderate`, `npx expo install --check`, and
`git diff --check`.

The workflow intentionally stays secret-free. It exports JS bundles only; it does
not run EAS binary builds, access Apple/Google signing credentials, or collect
physical-device/store/privacy evidence.

## Native build profiles

`eas.json` defines the source-controlled native build profile scaffold:

| Profile | Purpose | Command |
| --- | --- | --- |
| `preview` | Internal physical-device evidence builds; Android emits `.apk`; iOS uses internal distribution credentials | `npx eas-cli build --platform android --profile preview` / `npx eas-cli build --platform ios --profile preview` |
| `production` | Store/TestFlight/Google Play candidate archives | `npx eas-cli build --platform all --profile production` |

Use `npm run android:dev:install` only for an intentional Metro-backed developer device, then use `npm run android:dev:start` for JS/TS iteration. QA devices use `npm run android:qa:build`; the repository intentionally provides no ambiguous `npm run android` alias. Local release-mode smoke uses `npm run build:android:device-smoke`, which is self-contained but is not an approved distributable artifact.

The EAS config intentionally does not commit Expo project IDs, Apple/Google credentials, signing files, store metadata, or concrete delivery-server origins. EAS `preview` and `production` environment values must be created in the owner-controlled Expo/EAS project before native builds are run.

`eas.json` sets `cli.requireCommit=true` to bind native build evidence to committed source. It also sets `cli.appVersionSource=remote`; `app.json` keeps the reviewed native source version, currently Android `1.2.1` (`versionCode` 19), while future production store builds use `autoIncrement`.

`npm run check:native-release` must pass before EAS build evidence or release-sensitive PRs. This preflight is intentionally source-controlled and secret-free: it checks bundle/package identity, native version pins, permission plugin copy, preview/production profile shape, and `.env.example` coverage. It does not prove Expo/EAS project ownership, Apple/Google signing authority, store/private distribution approval, privacy copy approval, or the public license decision.

## File hygiene policy reviewed

`.editorconfig` and `.gitattributes` are source-controlled so contributors and release reviewers see the same text-file defaults across macOS/Linux/Windows clients. The policy is intentionally small: normalize reviewed source/docs/config files to UTF-8/LF with final newlines, keep two-space indentation where this repo already uses it, and treat evidence media, release binaries, and signing/credential-like artifacts as binary if an explicit owner-approved exception ever requires tracking one.

`.gitignore` is configured to keep generated or sensitive local state out of git:

- local agent/runtime state: `.omx/`
- dependencies and package-manager caches: `node_modules/`, `.npm/`, `.pnpm-store/`
- secrets and local env files: `.env`, `.env.*`, while keeping `.env.example` trackable for the optional live delivery-server base URL
- build/test/compiler outputs: `dist/`, `build/`, `coverage/`, `.cache/`, `.metro-cache/`, `*.tsbuildinfo`
- Expo/React Native local output: `.expo/`, `.expo-shared/`, `.eas/`, `web-build/`, `*.jsbundle`
- generated native build/tooling output: root/Android Gradle folders, Android `.cxx`, app build/captures/local properties, iOS build/DerivedData/Pods/xcuserdata state, heap profiles
- mobile signing artifacts, store credentials, and binaries: `*.apk`, `*.apks`, `*.aab`, `*.ipa`, `*.dSYM/`, `credentials.json`, `eas-credentials.json`, `google-play-service-account*.json`, `app-store-connect-api-key*.json`, `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`, `*.pem`
- release/physical-device smoke evidence artifacts: `evidence/`, `release-evidence/`, `smoke-evidence/`, matching `docs/*evidence/` folders, completed `release-evidence-manifest-*.md` copies, and `clever-routes-*` screenshot/video/log/PDF/media files generated from `docs/physical-device-smoke-runbook.md`
- OS/editor noise: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`

`.dockerignore` mirrors the same secret/evidence/generated-output policy for any
future local Docker tooling. This repo does not currently deploy the mobile app
through Docker; the file is a guardrail so accidental build contexts do not copy
dependency folders, native build artifacts, signing material, environment files,
or completed release evidence.

Generated `android/` and `ios/` source directories are not globally ignored. If this app later adopts Expo prebuild or bare native customization, generated native source can be intentionally reviewed and committed while build outputs remain ignored.

## Dependency audit note

`package.json` currently overrides transitive `postcss` to `8.5.10` because the Expo SDK 54 Metro dependency range otherwise resolves to a moderate npm audit finding. The override keeps `npm audit --audit-level=moderate` clean without using `npm audit fix --force`, which would apply a breaking Expo downgrade. Re-check this override when Expo updates its transitive Metro/PostCSS dependency.

## Pre-PR baseline audit

Before opening an implementation PR, re-check these repo baseline files together with the code diff:

- `.editorconfig` / `.gitattributes`: UTF-8/LF/final-newline defaults and binary patterns for evidence, release, and signing artifacts stay aligned with the repo hygiene policy.
- `.gitignore` / `.dockerignore`: generated Expo/native outputs, signing artifacts, local env files, package caches, compiler artifacts, release evidence, and agent/runtime state stay ignored; `android/` and `ios/` source directories are intentionally not globally ignored.
- physical-device evidence: screenshots, videos, logs, generated binaries, signing files, credentials, and production PII stay outside git; keep only sanitized references in issues/PRs.
- `.env.example`: every bundled `EXPO_PUBLIC_*` runtime key used by the app is documented, and secret `.env*` files stay ignored.
- `package.json` / `package-lock.json`: scripts, Node floor, Expo SDK dependencies, and audit overrides match the implementation.
- `app.json`: bundle/package identifiers, native build versions, permission copy, plugins, background-location settings, and static project/bootstrap issue metadata match the current native capability slice.
- `eas.json`: preview/internal and production/store profile settings, EAS environment names, require-commit policy, and app version source match the release evidence plan.
- `npm run check:native-release`: local native release config preflight passes, while external owner-controlled blockers remain tracked in `docs/release-readiness.md`.
- `npm run release:evidence:verify -- <external-manifest-path>`: completed external release evidence manifests are checked before release approval; the completed manifest itself stays out of git.
- `.github/workflows/ci.yml`: manually dispatched CI keeps remote source-controlled gates aligned with the documented release-sensitive validation commands.
- `.github/PULL_REQUEST_TEMPLATE.md`: target issue, change-control issue, concurrent-work gate, validation evidence, and context/wiki completion fields are filled before issue closure.
- `CONTRIBUTING.md` and `SECURITY.md`: human workflow, security/privacy reporting, sensitive evidence handling, and generated-file guardrails stay current.
- `docs/release-readiness.md`: physical-device smoke matrix, store/privacy disclosure checklist, and release blockers match current runtime behavior.
- `LICENSE`: remains intentionally absent until an owner selects reuse/distribution terms.

## Follow-up setup decisions

These items are intentionally left for later issues because they affect API, compliance, release, or device behavior beyond this bootstrap:

1. Store/private distribution policy and owner-controlled EAS environment values for preview/production.
2. Server-owned SMS OTP onboarding/recovery, forgotten-PIN policy, and any stronger managed identity or device-binding policy beyond the current account refresh session.
3. Consent legal copy source and consent version contract.
5. Production proof media storage policy: persistent photo/signature storage ownership, access, retention, and deletion rules.
6. Store disclosure matrix and production privacy copy for continuous background location; tracked in `docs/release-readiness.md`.
7. Expo/EAS project ownership, App Store/Play Store signing ownership, and credential rotation policy.
8. Minimum supported iOS/Android versions and physical-device background-location smoke matrix; tracked in `docs/release-readiness.md`.
9. Physical-device validation of app-side offline retry/discard behavior after network loss, route completion, tracking stop, and the explicit driver session reset/sign-out action.
10. CODEOWNERS and additional branch/ruleset automation after the control-plane admin decision required by `AGENTS.md`.
11. Public license/reuse terms, if the owner decides to grant them.
