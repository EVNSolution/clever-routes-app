# Store privacy disclosure worksheet

## Status

This is a draft worksheet for owner/legal review. It is not final App Store
listing copy, not final Google Play Data safety form text, and not a privacy
policy. Do not submit store answers from this document without checking the
current App Store Connect / Play Console forms, the production server retention
policy, third-party SDK inventory, and the approved EVNSolution privacy notice.

## Reference basis

- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/):
  App Store Connect requires disclosure of data the app or third-party partners
  collect, and responses must stay accurate when practices change.
- [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469):
  Play Console requires developers to declare app data collection/sharing and
  provide a privacy policy for Play-distributed apps except limited
  internal/private cases.
- [Google Play sensitive permissions](https://support.google.com/googleplay/android-developer/answer/16558241):
  location is personal/sensitive data; background location needs a core-purpose
  justification and explicit consent.
- [Google Play photo/video policy](https://support.google.com/googleplay/android-developer/answer/16935362):
  broad photo/video access should be avoided when a system picker or scoped flow
  is enough.

## Current runtime summary

The current app is a driver-only delivery app. It does not include advertising,
tracking, analytics SDKs, social login, or third-party map SDKs in this repo.
The app can transmit data to `clever-delivery-server` only after a route context
and E.164 phone lookup establishes a driver route boundary. Local mock mode is
for development only and is not a production disclosure basis.

Runtime source anchors for this worksheet:

- `app.json`: native permission strings and background location flags
- `docs/route-access-flow.md`: app-side API, event, proof, and offline queue boundaries
- `src/continuousLocationStream.ts`: continuous/background-capable location task guard
- `src/proofPhotoCapture.ts`, `src/proofMediaUpload.ts`: proof photo capture/upload
- `src/proofSignatureCapture.ts`, `src/proofBarcodeCapture.ts`: signature/barcode proof metadata
- `src/offlineSubmissionQueue.ts`: local retry retention/discard policy

## Data disclosure worksheet

| Data or permission area | Current app behavior | App Store privacy review input | Google Play Data safety review input | Owner/legal decision needed |
| --- | --- | --- | --- | --- |
| Phone number | Driver enters E.164 phone for route access lookup. | Likely Contact Info / Phone Number, linked to driver route access, purpose: App Functionality. | Likely Personal info / Phone number, collected for App functionality. | Confirm if phone is retained in production logs and privacy policy. |
| Route context and route assignment identifiers | Driver enters route context; server returns concrete route identifiers only after `INVITED`. | Likely Identifiers or Other Data depending on final App Store taxonomy selection; linked to user/driver, purpose: App Functionality. | Likely App activity or app-specific identifiers/other data; collected for App functionality. | Confirm exact store taxonomy after production server payload review. |
| Company/shop/route guidance | App displays company, shop, route name/date, pickup/support contact. | Usually not user-collected driver data by itself, but route assignment context is linked to driver workflow. | Usually app content/operational data, but route assignment context may be linked to driver. | Confirm whether any displayed support contact is personal data. |
| Foreground location | App requests while-in-use location only after explicit delivery start and records location update events. | Location / Precise Location, linked to driver, purpose: App Functionality. | Location / Precise location, collected for App functionality. | Confirm whether approximate-only fallback is acceptable for any workflow. |
| Background-capable location | App can start a named continuous location task after `delivery_active`; native config enables iOS/Android background support. | Location / Precise Location, linked to driver, purpose: App Functionality; disclose background use in review notes. | Location / Precise location and background location declaration; core purpose is active delivery tracking. | Confirm store review justification, in-app prominent disclosure, and production wording. |
| Camera proof photo | App can launch camera through Expo ImagePicker and upload proof photo media. | User Content / Photos or Videos, linked to driver/stop/route, purpose: App Functionality. | Photos and videos, collected for App functionality. | Confirm if production build uses scoped picker/camera only and avoids broad media library permissions. |
| Photo library proof attachment | App can attach proof photos from library through Expo ImagePicker. | User Content / Photos or Videos, linked to driver/stop/route, purpose: App Functionality. | Photos and videos, collected for App functionality. | Confirm Android permission manifest after native build and whether Play photo/video declaration is needed. |
| Barcode scanning | App can scan proof barcodes using camera and include barcode data/symbology in proof events. | User Content or Other Data depending on barcode contents; linked to stop/route, purpose: App Functionality. | App activity / Other user-generated content or Other data depending on barcode contents. | Define allowed barcode contents and prohibit customer PII unless approved. |
| Signature proof | App stores signer name plus signature stroke/point counts as metadata, not raw signature image data. | User Content / Other User Content or Other Data; linked to proof event, purpose: App Functionality. | Personal info / Name if signer name is personal data; also app content/proof metadata. | Confirm whether signer name is driver, recipient, or other person and update privacy policy. |
| Proof media references | Server returns media id, storage key, content type, upload time, optional hash/size. | Identifiers / Other Data linked to proof media and route, purpose: App Functionality. | Files and docs or Other data, collected for App functionality depending on final Play form taxonomy. | Confirm production object storage, signed access, retention, deletion, and malware scanning. |
| Driver events | App sends route/stop events such as route started, location updated, stop delivered/failed, route completed. | Other Data / App Activity depending on final taxonomy; linked to driver, purpose: App Functionality. | App activity and/or Other data, collected for App functionality. | Confirm event retention and support/audit use. |
| Secure driver token | Short-lived server token is stored in Expo SecureStore and cleared on expiry/invalid/live downstream `401`/session reset. | If token is transmitted and retained server-side only as auth/session evidence, classify with identifiers only if store form requires it. | Device or other IDs / app-specific identifier only if final form treats token as an identifier. | Confirm token logging policy and any refresh/strong re-auth design beyond route+phone re-lookup recovery. |
| Offline queue | AsyncStorage stores non-secret retry metadata, driver event payloads, proof media file URI references, attempts, timestamps, and errors until retry/discard/reset. | Disclose underlying data types represented in queued payloads; local-only queue metadata may not be collected until transmitted. | Disclose underlying collected data when retry sends it; local-only metadata still needs privacy review if included in backups/logs. | Confirm backup/exclusion policy and production log redaction. |

## Current collection and sharing assumptions

- Collection purpose: App Functionality / active delivery execution, proof of
  delivery, driver assignment verification, safety/compliance logging.
- Tracking / advertising: no tracking, advertising, data broker, or cross-app
  analytics use is evident in the current repository.
- Third-party SDKs: current runtime uses Expo/React Native libraries for
  location, task manager, camera/image picker, secure storage, and status bar.
  Owner must verify SDK privacy manifests / Play SDK disclosures before
  submission.
- Sharing: current code sends driver data to EVNSolution-owned delivery server
  endpoints. Owner must confirm whether hosting, storage, security scanning, or
  operations vendors count as service providers/processors in the final store
  forms and privacy policy.
- Deletion: app-side local retry state can be cleared by session reset, route
  completion cleanup, max attempt discard, or 72-hour stale discard. Server-side
  deletion/retention is not production-final until proof-media storage and
  scheduled cleanup evidence are approved.

## Store review notes to prepare

### Background location justification

Draft review rationale: Clever Driver uses background-capable location only
after the driver explicitly starts an active delivery route. The purpose is to
record delivery progress and active route location events for dispatch,
customer-support, and proof/compliance workflows. Tracking must stop when the
route is completed, when the driver stops continuous tracking, or when the
driver resets the session. Location must not be used for advertising,
analytics, or tracking outside active delivery.

Required evidence before submission:

- physical iPhone and Android smoke evidence for foreground/background prompts
- screenshot/video showing location prompt timing after delivery start
- screenshot/video showing stop/reset behavior
- approved in-app disclosure/consent copy
- production server retention and deletion policy

### Photo and barcode proof justification

Draft review rationale: Camera/photo library access is limited to proof of
delivery during an active delivery flow. Barcode scanning is limited to proof
barcode capture. Failed, denied, unavailable, or cancelled capture flows do not
become durable proof evidence.

Required evidence before submission:

- native build manifest/permission audit for photo/video/media permissions
- physical-device camera/library/scanner success and denial evidence
- confirmation that broad photo/video library access is not requested unless an
  approved core use case requires it

## Pre-submission blockers

- Owner-approved privacy policy URL naming EVNSolution / Clever Driver.
- App Store Connect App Privacy answers reviewed against the final build.
- Google Play Data safety answers reviewed against the final build.
- Google Play background location declaration, if production Android build keeps
  background location enabled.
- Production proof-media object storage, signed access, malware scanning, and
  scheduled cleanup evidence.
- Physical iOS/Android device smoke matrix in `docs/release-readiness.md`.
- App Store / Play Store or private distribution path decision.
