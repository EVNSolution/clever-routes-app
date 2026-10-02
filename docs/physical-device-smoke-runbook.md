# Physical-device smoke evidence runbook

## Purpose

This runbook turns the release-readiness matrix into an executable iPhone and Android smoke sequence for `clever-routes-app`.
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
npm run android:qa:build
npx eas-cli build --platform ios --profile preview
```

Never install `npm run android:dev:install` output on a QA device: it is a Metro-backed Development Build. For a local self-contained Android diagnostic before EAS evidence exists, use `npm run build:android:device-smoke`, record it as non-distributable local evidence, and verify that the package is not `DEBUGGABLE` before launch.

Production candidate command, only after owner approval:

```bash
npx eas-cli build --platform all --profile production
```

Store the EAS build URLs, install method, and build artifacts in the external evidence store. Do not commit `.apk`, `.aab`, `.ipa`, screenshots, videos, signing files, or generated native build outputs to this repository.
The repository `.gitignore` also blocks common local evidence folders and `clever-routes-*` evidence file names, but the primary control is to keep the artifacts in the external evidence store.

## Evidence file naming

Use names that identify device, platform, scenario, and timestamp without exposing personal data:

```text
clever-routes-<platform>-<device>-<scenario>-<yyyyMMdd-HHmm>-<shortsha>.<ext>
```

Examples:

- `clever-routes-ios-iphone15-route-lookup-20260513-1015-7fc4331.png`
- `clever-routes-android-pixel8-background-tracking-20260513-1030-7fc4331.mp4`
- `clever-routes-ios-iphone15-session-reset-20260513-1045-7fc4331.txt`

## Android Waze smoke from a Toronto Store Pickup location

Use this procedure when the connected Android phone is physically outside Canada but Waze must be checked against a Toronto assigned-stop destination. The destination must remain the address and coordinates supplied by the app. Only the phone's current location is mocked.

Waze documents `q` as an address search, `ll` as coordinates, and `navigate=yes` as the request to navigate to the destination: <https://developers.google.com/waze/deeplinks>.

### Safety boundary

- Use a synthetic or production-approved `Ready` route.
- Resolve the current Store Pickup latitude and longitude from the approved route/depot source. Do not copy a customer stop into the current-location variables.
- Do not press `Start Session`, `Arrive`, `Skip Stop`, or any other CLEVER operational mutation during this smoke. After the handoff, do not interact with Waze; `navigate=yes` can start guidance automatically.
- Do not put exact production coordinates, customer data, screenshots, or raw `dumpsys location` output in git or GitHub.
- These commands were verified on a Samsung Android 13 physical device. Recheck `adb shell cmd location help` before using them on a different Android version.

### Start the temporary location stream

Connect the phone by USB, replace the two placeholders, and run this block in a dedicated terminal. Keep it running while opening Waze. Press `Ctrl-C` after the turn-by-turn guidance screen appears; the exit trap removes the test providers and restores the original location-switch state.

```bash
set -eu

store_pickup_latitude='<STORE_PICKUP_LATITUDE>'
store_pickup_longitude='<STORE_PICKUP_LONGITUDE>'
initial_location_enabled="$(adb shell cmd location is-location-enabled | tr -d '\r')"
adb_shell_uid="$(adb shell id -u | tr -d '\r')"

cleanup_mock_location() {
  set +e
  for provider_name in gps network fused; do
    adb shell cmd location providers remove-test-provider "$provider_name" >/dev/null 2>&1
  done
  adb shell appops set "$adb_shell_uid" android:mock_location deny
  if [ "$initial_location_enabled" = 'true' ]; then
    adb shell cmd location set-location-enabled false
    adb shell cmd location set-location-enabled true
  else
    adb shell cmd location set-location-enabled false
  fi
}
trap cleanup_mock_location EXIT INT TERM

adb devices -l
adb shell appops set "$adb_shell_uid" android:mock_location allow

for provider_name in gps network fused; do
  adb shell cmd location providers remove-test-provider "$provider_name" >/dev/null 2>&1 || true
  adb shell cmd location providers add-test-provider "$provider_name"
  adb shell cmd location providers set-test-provider-enabled "$provider_name" true
done

mock_provider_count="$(adb shell dumpsys location | rg -c '^\s+(gps|network|fused) provider \[mock\]:' || true)"
if [ "$mock_provider_count" != '3' ]; then
  echo "Expected 3 mock providers, found $mock_provider_count. Stop and investigate before opening Waze."
  exit 1
fi

while :; do
  for provider_name in gps network fused; do
    if ! adb shell cmd location providers set-test-provider-location "$provider_name" \
      --location "$store_pickup_latitude,$store_pickup_longitude" \
      --accuracy 5 >/dev/null 2>&1; then
      # Some vendor builds can replace a test provider while Waze starts.
      adb shell cmd location providers add-test-provider "$provider_name"
      adb shell cmd location providers set-test-provider-enabled "$provider_name" true
      adb shell cmd location providers set-test-provider-location "$provider_name" \
        --location "$store_pickup_latitude,$store_pickup_longitude" \
        --accuracy 5
    fi
  done
  sleep 1
done
```

Mocking only `gps` is insufficient for this test. Waze can still receive a Seoul value from Android's `network` or `fused` location state. Keep all three providers aligned and refreshed until Waze starts guidance.

### Run and classify the Waze check

1. Confirm the test route still shows `Ready`.
2. Open `Detail`, select an assigned delivery stop, and tap `Navigate` once.
3. Confirm Waze starts turn-by-turn guidance for the same assigned-stop destination without requiring a separate `View routes` or `Go` tap. This automatic start is the expected `navigate=yes` behavior.
4. Confirm the map and route remain within Toronto. ETA and distance vary with traffic and route choice; judge locality, not an exact saved value.
5. Press `Ctrl-C` in the location-stream terminal and run the cleanup checks below.

Interpret failures before changing app or server code:

| Observation | Classification |
| --- | --- |
| Waze shows roughly `10,000 km` or an overseas route | Test-location failure: a real or cached Seoul provider is still active. Recheck all three providers; do not change the assigned stop. |
| Waze finds the right destination but opens only its place card or route chooser | The installed APK is stale or the Waze link lacks `navigate=yes`. Verify the installed build before investigating geocoding. |
| Waze opens directly but the destination itself is wrong | Assigned-stop payload or app deep-link construction failure. Compare the displayed destination with the approved synthetic stop. |
| All three providers are current and Waze still reports no route | Check Waze connectivity/GPS state before treating it as an app or OSRM failure. |

### Verify cleanup

```bash
adb shell cmd location is-location-enabled
adb shell appops get "$(adb shell id -u | tr -d '\r')" android:mock_location
adb shell dumpsys location | rg '^\s+(gps|network|fused) provider \[mock\]:|^\s+last location=.* mock\]' || true
```

The location-enabled result must match its pre-test value, the mock-location app-op must be `deny`, and the final command must print nothing. Return to CLEVER Routes and confirm the route is still `Ready`.

## Smoke sequence

Run the full sequence once on a real iPhone and once on a real Android phone.
Use synthetic route, stop, proof, and signature data unless production validation is explicitly approved.

| Step | Expected evidence | Stop condition |
| --- | --- | --- |
| Fresh install and launch | App opens with version/build identifier recorded. | App cannot launch or crashes before route lookup. |
| E.164 phone + PIN login | Existing account signs in without another invitation code; no company/route data appears before account authentication. | Phone alone reveals company, route, stop, or customer data. |
| First invitation registration | An administrator-created invitation code plus matching six-digit PIN/confirmation creates the account without asking for a driver name. | The app attempts to create/request a Shopify invitation, persists the PIN/invitation, or accepts mismatched PINs. |
| Multi-company guidance | Shop/company name, route name/date, timezone, pickup guidance, and support contact match the test assignment. | Wrong tenant/company guidance appears. |
| Consent gate | Required location-information and personal-information consent can be recorded; failure/retry state is visible if simulated. | Assigned route appears before consent success. |
| Assigned route and stop list | Route summary and ordered stop cards match synthetic route data. | Wrong route, wrong date/timezone, or another driver's stop appears. |
| Stop-card OS map handoff | `Open map` launches the native map handler from coordinates; address fallback works for a stop without coordinates. On Android, the selected Waze handler starts guidance directly without a second `View routes` or `Go` tap. | Map opens the wrong destination, no fallback exists, or Waze stops at a place card/route chooser. |
| Delivery start foreground location | OS foreground location prompt appears only after explicit delivery start; denial keeps delivery out of `delivery_active`. | Location prompt appears before delivery start or denial still activates delivery. |
| Continuous/background-capable tracking | Background permission prompt and foreground service/background indicator behavior match the platform; `LOCATION_UPDATED` events record or queue. | Tracking starts before active delivery or cannot be stopped. |
| Proof capture | Camera/library photo and signature drawing success/denial/unavailable states are visible. | Proof controls are available before active delivery or failed capture becomes durable proof. |
| Proof media scan rejection | In local mock mode, set `Local proof media upload mock` to `scan_rejected`; in live mode, use a server `PROOF_MEDIA_REJECTED` upload response. The app shows recapture guidance without queuing that photo as retryable proof. | Rejected proof media becomes durable evidence or remains in the retry queue. |
| Encrypted offline retry/quarantine | Network loss queues driver events/proof media in SQLCipher; foreground+online retry preserves persisted sequence, a quarantined ordered head blocks later same-route events across restart, and explicit reconciliation ACK releases the route. Sign out/in with a second test account and confirm it cannot count or replay the first account's rows. | Ordered evidence disappears, later same-route events bypass quarantine, another account sees the rows, retries run in background/offline, or storage opens without SQLCipher. |
| Delivery finish cleanup | Finish stops continuous tracking, records or queues `ROUTE_COMPLETED`, and only clears route-scoped queue items after recorded completion. | Tracking continues after finish or queued completion evidence is discarded after failed record. |
| Driver session reset | Reset stops tracking, clears SecureStore driver access, removes location samples, seals ordered workflow/proof evidence for reconciliation, blanks lookup inputs, and returns to safe lookup state. | Evidence is deleted unexpectedly or can replay under a different account. |
| Token expiry/invalid token recovery | Expired route access triggers account refresh plus route lookup and one retry; expired account refresh clears authentication and requires phone + PIN login. | Account and route tokens are confused, or expired credentials continue to access downstream APIs. |
| Deleted/unassigned route refresh | Removing an assignment server-side makes the route disappear after refresh while the account remains signed in. | Deleted routes remain actionable or a transient network failure incorrectly signs the account out. |

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
- native manifest/store review confirms the current app does not request
  Contacts permissions, and current Google Play minimum-scope permission caveats
  for location and photo/video have been reviewed

If any step fails, stop the release candidate, create a new target issue and change-control issue, and attach only sanitized evidence references.
