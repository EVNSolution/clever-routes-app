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
  justification and explicit consent. The same Play policy page flags upcoming
  minimum-scope guidance for precise location and a Contacts Permissions policy
  effective October 28, 2026, so owner/legal review should re-check those items
  before store submission.
- [Google Play photo/video policy](https://support.google.com/googleplay/android-developer/answer/16935362):
  broad photo/video access should be avoided when a system picker or scoped flow
  is enough.

## Current runtime summary

The current app is a driver-only delivery app. It does not include advertising,
tracking, analytics SDKs, or social login. It does include MapLibre React Native
for route maps; owner review must include the production map style, tile, and
glyph providers in the final third-party data-flow inventory.
The app can transmit driver workflow data to `clever-delivery-server` only after E.164 phone + PIN account authentication (or one-time invitation registration) establishes an account boundary, followed by account-authenticated route lookup. Local mock mode is
for development only and is not a production disclosure basis.

Runtime source anchors for this worksheet:

- `app.json`: native permission strings and background location flags
- `docs/route-access-flow.md`: app-side API, event, proof, and offline queue boundaries
- `src/domain/location/continuousLocationStream.ts`: continuous/background-capable location task guard
- `src/domain/proof/proofPhotoCapture.ts`, `src/domain/proof/proofMediaUpload.ts`: proof photo capture/upload
- `src/domain/proof/proofSignatureCapture.ts`: signature proof metadata
- `src/domain/offline/offlineSubmissionQueue.ts`: local retry retention/discard policy

## Data disclosure worksheet

| Data or permission area | Current app behavior | App Store privacy review input | Google Play Data safety review input | Owner/legal decision needed |
| --- | --- | --- | --- | --- |
| Phone number | Driver enters an E.164-normalized phone for account login or first registration; route lookup then uses the account bearer. | Likely Contact Info / Phone Number, linked to driver account and route access, purpose: App Functionality. | Likely Personal info / Phone number, collected for App functionality. | Confirm phone retention, account deletion, and production log redaction policy. |
| Six-digit PIN / invitation code | PIN is submitted only to account login/registration and is not persisted by the app; the first-registration invitation is administrator-created and not requested by the app. | Treat as authentication data and do not expose it in analytics, screenshots, logs, backups, or support evidence. | Treat as authentication data and keep it out of logs/backups; confirm final account security disclosure. | Confirm server hashing, rate limits, reset/recovery, and invitation expiry policy. |
| Contacts / address book | The current app does not request Contacts permissions or read the device address book. Driver phone account entry is manual only. | Usually no Contacts disclosure for the current build unless a future feature reads contacts. | Do not declare Contacts permissions for the current build; Google Play has announced a Contacts Permissions policy effective October 28, 2026, and future broad contact access should use minimum-scope alternatives or a separate approved issue. | Keep contacts access out of native config unless owner/legal approves a future contact-picker feature and updates store disclosures. |
| Route assignment identifiers | Server returns concrete route identifiers only after account authentication and account-bearer lookup resolves active assignments. | Likely Identifiers or Other Data depending on final App Store taxonomy selection; linked to user/driver, purpose: App Functionality. | Likely App activity or app-specific identifiers/other data; collected for App functionality. | Confirm exact store taxonomy after production server payload review. |
| Company/shop/route guidance | App displays company, shop, route name/date, pickup/support contact. | Usually not user-collected driver data by itself, but route assignment context is linked to driver workflow. | Usually app content/operational data, but route assignment context may be linked to driver. | Confirm whether any displayed support contact is personal data. |
| Foreground location | App requests while-in-use location only after explicit delivery start and records location update events. | Location / Precise Location, linked to driver, purpose: App Functionality. | Location / Precise location, collected for App functionality. | Confirm whether approximate-only fallback is acceptable for any workflow. |
| Background-capable location | App can start a named continuous location task after `delivery_active`; native config enables iOS/Android background support. | Location / Precise Location, linked to driver, purpose: App Functionality; disclose background use in review notes. | Location / Precise location and background location declaration; core purpose is active delivery tracking. | Confirm store review justification, in-app prominent disclosure, and production wording. |
| Camera proof photo | App can launch camera through Expo ImagePicker and upload proof photo media. | User Content / Photos or Videos, linked to driver/stop/route, purpose: App Functionality. | Photos and videos, collected for App functionality. | Confirm if production build uses scoped picker/camera only and avoids broad media library permissions. |
| Photo library proof attachment | App can attach proof photos from library through Expo ImagePicker. | User Content / Photos or Videos, linked to driver/stop/route, purpose: App Functionality. | Photos and videos, collected for App functionality. | Confirm Android permission manifest after native build and whether Play photo/video declaration is needed. |
| Signature proof | App stores signer name plus signature stroke/point counts as metadata, not raw signature image data. | User Content / Other User Content or Other Data; linked to proof event, purpose: App Functionality. | Personal info / Name if signer name is personal data; also app content/proof metadata. | Confirm whether signer name is driver, recipient, or other person and update privacy policy. |
| Proof media references | Server returns media id, storage key, content type, upload time, optional hash/size; server-side scan rejection hook support exists before accepted media persistence, and rejected proof media is not queued as durable proof. | Identifiers / Other Data linked to proof media and route, purpose: App Functionality. | Files and docs or Other data, collected for App functionality depending on final Play form taxonomy. | Confirm production object storage, signed access, retention, deletion, deployed scanner backend, and monitoring evidence. |
| Driver events | App sends route/stop events such as route started, location updated, stop delivered/failed, route completed. | Other Data / App Activity depending on final taxonomy; linked to driver, purpose: App Functionality. | App activity and/or Other data, collected for App functionality. | Confirm event retention and support/audit use. |
| Secure account and route tokens | Account access/refresh and route-scoped driver access are stored separately in Expo SecureStore. Deleted assignments clear route cache; expired account refresh or session reset clears the account. | If tokens are treated as auth/session evidence, classify with identifiers only if the current store form requires it. | Device or other IDs / app-specific identifier only if the final form treats tokens as identifiers. | Confirm refresh-token logging, revocation, retention, and account recovery policy. |
| Offline evidence | SQLCipher stores account-bound redacted workflow envelopes, short-retention encrypted replay payloads/file URI references, location batches, quarantine, stable error codes, and a 30-day ACK/attempt/reconciliation journal. Workflow rows exclude notes, recipient/address data, signatures/media references, file URIs, and raw errors. The database key is in SecureStore; Android app backup is disabled and the iOS SQLite directory is excluded from backup. AsyncStorage is read only for transactional legacy migration and removed after reread plus keyed-HMAC verification. A corrupt legacy blob is capped to a 64 KiB encrypted row, retained for a 30-day support window, then replaced by a redacted purge summary; earlier support purge requires an explicit durable export marker. | Disclose the underlying data types represented in queued payloads; local-only evidence may not be collected until transmitted. | Disclose underlying collected data when retry sends it; local-only evidence still needs privacy review even though it is backup-excluded. | Validate encryption, expiry, account isolation, support export/purge authorization, and backup exclusions on physical release builds and confirm production log redaction. |

## Current collection and sharing assumptions

- Collection purpose: App Functionality / active delivery execution, proof of
  delivery, driver assignment verification, safety/compliance logging.
- Tracking / advertising: no tracking, advertising, data broker, or cross-app
  analytics use is evident in the current repository.
- Third-party SDKs: current runtime uses Expo/React Native libraries for
  location, task manager, image picker/camera proof photos, secure storage, and
  status bar, plus MapLibre React Native for route maps.
  Owner must verify SDK privacy manifests / Play SDK disclosures before
  submission.
- Sharing: current code sends driver data to EVNSolution-owned delivery server
  endpoints. Owner must confirm whether hosting, storage, security scanning, or
  operations vendors count as service providers/processors in the final store
  forms and privacy policy.
- Deletion: transient location evidence can be cleared by route completion,
  account change, retry limit, or the 72-hour age limit. Ordered workflow and
  proof evidence is quarantined at retry limits or sign-out until explicit
  reconciliation; proof-media scan rejection remains non-retryable. Server-side
  deletion/retention is not production-final until proof-media storage and
  scheduled cleanup evidence are approved.

## Store review notes to prepare

### Background location justification

Draft review rationale: CLEVER Routes uses background-capable location only
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
- Play Console policy review against current location minimum-scope guidance,
  including the October 28, 2026 location-button recommendation if submission
  timing or target SDK policy makes it applicable

### Photo proof justification

Draft review rationale: Camera/photo library access is limited to proof of
delivery during an active delivery flow. Failed, denied, unavailable, or
cancelled capture flows do not become durable proof evidence.

Required evidence before submission:

- native build manifest/permission audit for photo/video/media permissions
- physical-device camera/library success and denial evidence
- confirmation that broad photo/video library access is not requested unless an
  approved core use case requires it

### Contacts permission avoidance

The current driver access model intentionally uses manual E.164 phone entry. It does not need address-book lookup, contact import,
or call-log/SMS permissions. `npm run check:native-release` rejects
source-controlled Android Contacts permissions and iOS Contacts usage
descriptions before EAS evidence builds. Store evidence should still include a
native manifest check showing no Contacts permissions are present. If a future
support feature needs contact selection, open a new issue first and prefer the
minimum-scope system contact picker or equivalent alternative instead of broad
Contacts permission.

## Pre-submission blockers

- Owner-approved privacy policy URL naming EVNSolution / CLEVER Routes.
- App Store Connect App Privacy answers reviewed against the final build.
- Google Play Data safety answers reviewed against the final build.
- Google Play background location declaration, if production Android build keeps
  background location enabled.
- Google Play minimum-scope permission review completed for location,
  photo/video, and Contacts permissions; current app should not request Contacts
  permissions.
- Production proof-media object storage, signed access, scanner backend deployment
  evidence, and scheduled cleanup evidence.
- Physical iOS/Android device smoke matrix in `docs/release-readiness.md`.
- App Store / Play Store or private distribution path decision.
