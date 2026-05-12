# Physical-device smoke evidence runbook

## Purpose

This runbook turns the release-readiness matrix into an executable iPhone and Android smoke sequence for `clever-driver-app`.
It does not contain real evidence. Actual screenshots, videos, logs, generated binaries, signing files, credentials, and production PII stay outside git.

Use this after a committed source revision is selected and the owner-controlled Expo/EAS, Apple, Google, and delivery-server environment values are ready.

## Preconditions

Record these values in the external release evidence store before testing:

- source commit SHA and PR/merge reference
- EAS build profile: `preview` or `production`
- app version/build identifiers from the installed binary
- device model, OS version, locale/timezone, and network mode
- delivery-server environment and whether synthetic or production-approved data is used
- tester, date, and evidence storage location

Use `docs/release-evidence-manifest.template.md` as the external manifest shape for these values and for each smoke row's evidence references. Copy it outside git before filling it.

Do not proceed if any of these are missing:

- owner-approved distribution path for the device under test
- EAS `preview` or `production` environment values
- Apple/Google signing authority for the selected profile
- synthetic driver/route data, unless production validation is explicitly approved
- privacy disclosure text for background location if testing production/store candidate builds

## Build and install evidence

Use committed source only. `eas.json` sets `cli.requireCommit=true`, so build evidence must point to a commit that exists in GitHub.

Recommended preview commands:

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

Production candidate command, only after owner approval:

```bash
npx eas-cli build --platform all --profile production
```

Store the EAS build URLs, install method, and build artifacts in the external evidence store. Do not commit `.apk`, `.aab`, `.ipa`, screenshots, videos, signing files, or generated native build outputs to this repository.
The repository `.gitignore` also blocks common local evidence folders and `clever-driver-*` evidence file names, but the primary control is to keep the artifacts in the external evidence store.

## Evidence file naming

Use names that identify device, platform, scenario, and timestamp without exposing personal data:

```text
clever-driver-<platform>-<device>-<scenario>-<yyyyMMdd-HHmm>-<shortsha>.<ext>
```

Examples:

- `clever-driver-ios-iphone15-route-lookup-20260513-1015-7fc4331.png`
- `clever-driver-android-pixel8-background-tracking-20260513-1030-7fc4331.mp4`
- `clever-driver-ios-iphone15-session-reset-20260513-1045-7fc4331.txt`

## Smoke sequence

Run the full sequence once on a real iPhone and once on a real Android phone.
Use synthetic route, stop, proof, barcode, and signature data unless production validation is explicitly approved.

| Step | Expected evidence | Stop condition |
| --- | --- | --- |
| Fresh install and launch | App opens with version/build identifier recorded. | App cannot launch or crashes before route lookup. |
| Route context + E.164 phone lookup | Company guidance appears before any stop/customer data. | Route data appears before company guidance or consent. |
| Multi-company guidance | Shop/company name, route name/date, timezone, pickup guidance, and support contact match the test assignment. | Wrong tenant/company guidance appears. |
| Consent gate | Required location-information and personal-information consent can be recorded; failure/retry state is visible if simulated. | Assigned route appears before consent success. |
| Assigned route and stop list | Route summary and ordered stop cards match synthetic route data. | Wrong route, wrong date/timezone, or another driver's stop appears. |
| Stop-card OS map handoff | `Open map` launches the native map handler from coordinates; address fallback works for a stop without coordinates. | Map opens the wrong destination or no fallback exists. |
| Delivery start foreground location | OS foreground location prompt appears only after explicit delivery start; denial keeps delivery out of `delivery_active`. | Location prompt appears before delivery start or denial still activates delivery. |
| Continuous/background-capable tracking | Background permission prompt and foreground service/background indicator behavior match the platform; `LOCATION_UPDATED` events record or queue. | Tracking starts before active delivery or cannot be stopped. |
| Proof capture | Camera/library photo, signature drawing, and barcode scan success/denial/unavailable states are visible. | Proof controls are available before active delivery or failed capture becomes durable proof. |
| Offline retry/discard | Network loss queues driver events/proof media; retry syncs or discards according to policy; app restart hydrates queue count. | Queue loses pending evidence unexpectedly or stores driver access tokens. |
| Delivery finish cleanup | Finish stops continuous tracking, records or queues `ROUTE_COMPLETED`, and only clears route-scoped queue items after recorded completion. | Tracking continues after finish or queued completion evidence is discarded after failed record. |
| Driver session reset | Reset stops tracking, clears SecureStore driver access, clears queued retry state, blanks lookup inputs, and returns to safe lookup state. | Secure token or queued retry state remains after reset. |
| Token expiry/invalid token recovery | Expired or malformed persisted token is cleared before reuse; live downstream `401` from consent, assigned route, event, proof media, or offline retry clears the active token, stops/clears active route UI state, and requires route context + phone lookup again. | Expired token can still access downstream route/event/proof APIs or retry loops without re-lookup guidance. |

## Evidence notes

For each step, record:

- pass/fail
- exact device/platform
- app version/build identifier
- source commit SHA
- delivery-server environment
- screenshot/video/log reference in the external evidence store
- tester notes and blocker IDs

Keep logs minimal. Do not copy raw access tokens, phone numbers beyond approved synthetic fixtures, customer PII, exact production coordinates, signing secrets, or binary evidence into git or GitHub comments.

## Completion gate

The release smoke gate is complete only when:

- every row in `docs/release-readiness.md` has iPhone and Android evidence references in the external evidence store
- the external copy of `docs/release-evidence-manifest.template.md` is filled for the release candidate
- blockers are either fixed in follow-up PRs or explicitly accepted by the owner
- store/private distribution policy and privacy disclosure copy are approved
- EAS build records point to committed source
- generated artifacts and sensitive evidence remain outside git

If any step fails, stop the release candidate, create a new target issue and change-control issue, and attach only sanitized evidence references.
