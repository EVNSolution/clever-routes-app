# CLEVER Routes App code organization

This document is the source-of-truth folder-role index for `clever-driver-app`. The repository no longer uses a flat `src/` layout: production source files under `src/` must live in one approved role folder and `npm run check:source-layout` enforces that rule.

## Current source tree

```txt
App.tsx                         # Expo bootstrap re-export only
src/
  app/
    AppRoot.tsx                 # Current app composition shell and screen flow host
    config/
      driverRuntimeConfig.ts
  api/
    deliveryServer/
      driverApiClients.ts
      driverApiError.ts
  domain/
    consent/                    # consent state and consent service contract/mock/API behavior
    delivery/                   # delivery start/finish lifecycle decisions
    driver/                     # separate account/route token store and session reset policy
    driverAuth/                 # phone/PIN login, invitation registration, and account refresh contract
    driverFlow/                 # driver flow guards and MVP route-tab metadata
    events/                     # driver event recording decisions
    location/                   # foreground/background location event decisions
    offline/                    # offline queue model and retry/discard policy
    proof/                      # proof capture/upload decisions
    phone/                      # supported-country i18n metadata, national phone formatting, E.164 normalization
    route/                      # assigned-route model and lookup loading decisions
    routeAccess/                # account-bearer route-access decisions
    stop/                       # stop navigation and proof-event decisions
  platform/
    expo/
      camera/                   # Expo camera/image-picker adapters
      location/                 # Expo location/task adapters
      secureStore/              # Expo SecureStore adapter
      storage/                  # AsyncStorage queue adapter
  release/
    evidence/                   # release evidence seed/verifier CLIs and tests
    preflight/                  # native release and source-layout preflights
  ui/
    components/                 # reusable UI components and pure component helpers
```

Reserved roots from the target architecture remain valid for future additions when needed: `src/features/`, `src/shared/`, `src/test/`, `tests/integration/`, and `tests/smoke/`. Do not add placeholder files just to create empty directories.

## Folder role index

| Folder | Owns | May import | Must not import | Test placement |
| --- | --- | --- | --- | --- |
| `App.tsx` | Expo bootstrap only. | `src/app/AppRoot`. | Business logic, UI implementation, native adapters. | No tests unless bootstrap logic is added. |
| `src/app/` | App composition, provider/dependency wiring, app-level state, current screen flow host. | `api`, `domain`, `platform`, `ui`. | New standalone domain decisions that belong under `domain/*`. | Co-located tests for app/config/state helpers. |
| `src/app/config/` | Runtime env parsing and service factory selection. | `api`, `domain`, `platform`. | React Native UI components. | Co-located tests. |
| `src/api/deliveryServer/` | Delivery-server client composition, bearer-token headers, no-store/no-cookie request options, response parsing, driver API error mapping. | `domain` contracts and standard `fetch` injection. | UI components and Expo native adapters. | Co-located API boundary tests with fake `fetchImpl`. |
| `src/domain/` | Pure business decisions and service contracts. | Sibling domain modules plus API error types where currently required. | React, React Native, Expo modules, AsyncStorage, SecureStore, direct UI composition. | Co-located `*.test.ts` next to each module. |
| `src/platform/expo/` | Expo/React Native adapters for native capabilities. | Domain service interfaces. | UI screens and delivery-server client composition. | Co-located adapter tests only when native calls can be faked. |
| `src/release/` | Release readiness checks, source layout guardrails, release evidence seed/verification. | Node standard library and release-local helpers. | Runtime app state and UI screens. | Co-located tests. |
| `src/ui/` | Reusable UI primitives and UI-only behavior helpers. | `react`, `react-native`, UI-local helpers. | API clients, Expo service factories, route/delivery business decisions. | Co-located pure helper tests; visual/device checks in smoke evidence. |
| `src/features/` | Future screen-level feature extraction by user scenario. | `domain`, `ui`, app-provided props/hooks. | Direct `fetch` and direct native service construction. | Component/scenario tests when a React Native harness is introduced. |
| `src/shared/` | Future generic utilities with no Clever-specific business ownership. | Other `shared` modules only. | Domain, API, UI, Expo. | Co-located tests. |
| `src/test/` | Future reusable fixtures/fakes/builders. | Production modules needed to build fixtures. | Production code must not import this folder. | Helper tests only when helpers contain logic. |

## Import direction rules

1. `App.tsx` stays a tiny bootstrap file.
2. `src/app/` composes dependencies and is the only layer allowed to connect API, platform adapters, domain decisions, and UI in one place.
3. `src/api/deliveryServer/` does not import `src/platform/`, `src/ui/`, or `src/app/`.
4. `src/platform/expo/` implements domain service interfaces and does not import API clients or screen components.
5. `src/domain/` owns business decisions and does not import React Native or Expo modules.
6. `src/ui/` owns reusable component presentation and UI-only helpers; it does not import API clients or native service factories.
7. Production code never imports from `src/test/`, `tests/`, generated `dist/`, or ignored device evidence folders.
8. New files go in the lowest folder that can own them without violating this table.

## Test organization rules

- Keep module-level tests co-located with the source file: `module.ts` and `module.test.ts`.
- Put cross-module app-flow tests in `tests/integration/` only when they exercise more than one role folder.
- Put physical-device checks, adb/logcat notes, and live-server smoke runbooks in `tests/smoke/` or `docs/physical-device-smoke-runbook.md`.
- Do not commit generated binaries, screenshots, videos, full logcat dumps, completed release evidence manifests, signing material, or `.env` files.

## Current path index

| Area | Current files |
| --- | --- |
| Bootstrap | `App.tsx`, `src/app/AppRoot.tsx` |
| Runtime config | `src/app/config/driverRuntimeConfig.ts`, `src/app/config/driverRuntimeConfig.test.ts` |
| Delivery-server API | `src/api/deliveryServer/driverApiClients.ts`, `src/api/deliveryServer/driverApiClients.test.ts`, `src/api/deliveryServer/driverApiError.ts`, `src/api/deliveryServer/driverApiRequestOptions.ts`, `src/api/deliveryServer/driverApiRequestOptions.test.ts` |
| Consent domain | `src/domain/consent/driverConsent.ts`, `src/domain/consent/driverConsent.test.ts` |
| Delivery lifecycle domain | `src/domain/delivery/deliveryStart.ts`, `src/domain/delivery/deliveryStart.test.ts`, `src/domain/delivery/deliveryFinish.ts`, `src/domain/delivery/deliveryFinish.test.ts` |
| Driver domain | `src/domain/driver/driverAccessTokenStore.ts`, `src/domain/driver/driverAccessTokenStore.test.ts`, `src/domain/driver/driverSessionReset.ts`, `src/domain/driver/driverSessionReset.test.ts` |
| Driver flow domain | `src/domain/driverFlow/driverFlow.ts`, `src/domain/driverFlow/driverFlow.test.ts` |
| Events domain | `src/domain/events/driverEvents.ts`, `src/domain/events/driverEvents.test.ts` |
| Location domain | `src/domain/location/continuousLocationStream.ts`, `src/domain/location/continuousLocationStream.test.ts`, `src/domain/location/foregroundLocationEvent.ts`, `src/domain/location/foregroundLocationEvent.test.ts` |
| Offline domain | `src/domain/offline/offlineSubmissionQueue.ts`, `src/domain/offline/offlineSubmissionQueue.test.ts` |
| Proof domain | `src/domain/proof/proofPhotoCapture.ts`, `src/domain/proof/proofPhotoCapture.test.ts`, `src/domain/proof/proofMediaUpload.ts`, `src/domain/proof/proofMediaUpload.test.ts`, `src/domain/proof/proofSignatureCapture.ts`, `src/domain/proof/proofSignatureCapture.test.ts` |
| Phone domain | `src/domain/phone/phoneEntry.ts`, `src/domain/phone/phoneEntry.test.ts` |
| Route domain | `src/domain/route/assignedRoute.ts`, `src/domain/route/assignedRoute.test.ts` |
| Route-access domain | `src/domain/routeAccess/routeAccess.ts`, `src/domain/routeAccess/routeAccess.test.ts` |
| Stop domain | `src/domain/stop/stopNavigation.ts`, `src/domain/stop/stopNavigation.test.ts`, `src/domain/stop/stopProofEvents.ts`, `src/domain/stop/stopProofEvents.test.ts` |
| Expo proof photo adapter | `src/platform/expo/camera/expoProofPhotoCaptureService.ts` |
| Expo location adapters | `src/platform/expo/location/expoLocationPermissionService.ts`, `src/platform/expo/location/expoForegroundLocationSnapshotService.ts`, `src/platform/expo/location/expoContinuousLocationStreamService.ts` |
| Expo storage adapters | `src/platform/expo/secureStore/expoSecureDriverAccessTokenStore.ts`, `src/platform/expo/storage/expoOfflineSubmissionQueueStorage.ts` |
| Release evidence | `src/release/evidence/releaseEvidenceSeed.ts`, `src/release/evidence/releaseEvidenceSeedCli.ts`, `src/release/evidence/releaseEvidenceSeed.test.ts`, `src/release/evidence/releaseEvidenceVerifier.ts`, `src/release/evidence/releaseEvidenceVerifierCli.ts`, `src/release/evidence/releaseEvidenceVerifier.test.ts` |
| Release preflight | `src/release/preflight/nativeReleasePreflight.ts`, `src/release/preflight/nativeReleasePreflightCli.ts`, `src/release/preflight/nativeReleasePreflight.test.ts`, `src/release/preflight/releaseBuildProfiles.test.ts`, `src/release/preflight/sourceLayoutPreflight.ts`, `src/release/preflight/sourceLayoutPreflightCli.ts`, `src/release/preflight/sourceLayoutPreflight.test.ts` |
| UI components | `src/ui/components/TransientToast.tsx`, `src/ui/components/transientToastBehavior.ts`, `src/ui/components/transientToast.test.ts` |

## Naming rules

- Root bootstrap remains `App.tsx`; app composition lives in `src/app/AppRoot.tsx`.
- Reusable UI components use PascalCase file names: `TransientToast.tsx`.
- UI helper files that would collide on case-insensitive filesystems use descriptive camelCase names such as `transientToastBehavior.ts` instead of `transientToast.ts` beside `TransientToast.tsx`.
- Pure domain modules use camelCase file names and co-located `.test.ts` files.
- API composition files live under `src/api/deliveryServer/`.
- Expo adapter files begin with `expo` and end with `Service.ts` or `Store.ts`.
- Release CLIs end with `Cli.ts` and live next to their release helper.

## Change review checklist

Before merging code that adds or moves files, reviewers verify:

- `npm run check:source-layout` passes.
- The file path matches the folder role index.
- Import direction follows the import direction rules above.
- Unit tests remain co-located for module-level logic.
- Native adapter code stays under `src/platform/expo/`.
- Delivery-server HTTP code stays under `src/api/deliveryServer/`.
- Release tooling stays under `src/release/`.
- `App.tsx` stays a small bootstrap file.
- README documentation map links this document and any refactor execution record.
