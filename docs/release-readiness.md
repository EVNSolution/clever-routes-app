# Release readiness checklist

## Purpose

This document tracks the non-code evidence needed before a production iOS/Android release of `clever-driver-app`. Product scope remains in `docs/project-brief.md`; app-side API/runtime behavior remains in `docs/route-access-flow.md`.

## Distribution decision

The app targets native iPhone and Android phone runtime. The release channel is still pending owner decision:

- App Store/TestFlight and Google Play testing or production tracks
- Apple Business Manager Custom Apps and managed Google Play/private app for restricted driver distribution

Do not add final store listing copy, screenshots, signing ownership, or public license terms without an explicit owner decision.

## Physical-device smoke matrix

Before production release, capture evidence on at least one real iPhone and one real Android phone. Use synthetic driver/route data unless production validation is explicitly approved.

| Area | iPhone evidence | Android evidence | Notes |
| --- | --- | --- | --- |
| Fresh install and app launch | pending | pending | Include app version/build identifier. |
| Route context + E.164 phone lookup | pending | pending | Verify tenant/company context before route data. |
| Company guidance and support contact display | pending | pending | Confirm multi-company wording. |
| Consent gate and retry/error handling | pending | pending | Verify consent versions/copy source. |
| Assigned route and stop list | pending | pending | Use shop/route timezone `deliveryDate`. |
| Delivery start foreground location permission | pending | pending | Confirm denial and recovery UX. |
| Continuous/background-capable location task | pending | pending | Confirm native background configuration and OS prompts. |
| Proof photo capture from camera/library | pending | pending | Use synthetic proof media. |
| Signature and barcode proof capture | pending | pending | Confirm unavailable/denied states. |
| Offline queue retry/discard UI after network loss | pending | pending | Confirm app restart hydration. |
| Token expiry or invalid persisted token recovery | pending | pending | Confirm SecureStore clearing path. |
| Delivery finish or route completion cleanup | pending | pending | Confirm location stop behavior. |

## Store and privacy disclosure checklist

Store/privacy metadata must match actual runtime behavior and server retention policy before release:

- Foreground location use: active delivery route tracking and location updates.
- Background location use: only after delivery start and only when native background tracking is enabled.
- Camera/photos: proof-of-delivery photo capture/upload.
- Camera barcode scanning: proof barcode capture when available.
- Driver identifiers: route context, phone lookup, server-issued driver access token, route assignment identifiers.
- Proof media: photo file, signature metadata, barcode metadata, and related stop/route identifiers.
- Offline queue: non-secret retry metadata and file URI references retained locally until retry/discard policy runs.
- Retention/deletion: production thresholds for proof media and offline queue items are still pending server/release policy.
- Support contact: company/operator support contact must be available in route guidance or store support metadata.

## Evidence storage policy

- Keep screenshots/videos containing synthetic data in the PR or approved evidence location.
- Do not commit large binary evidence, generated app bundles, signing artifacts, or production PII to this repo.
- If an evidence artifact is necessary but sensitive, reference the private storage location in the change-control issue instead of committing it.

## Release blockers still open

- Production proof-media storage ownership, retention, deletion, and access-control evidence.
- Production durable offline queue retention/discard thresholds after repeated failure, route completion, or driver sign-out.
- Physical iOS/Android device smoke evidence for background tracking and proof capture.
- Store/private distribution policy and privacy disclosure copy.
- Context-monorepo service document after production runtime/API boundaries are confirmed.
