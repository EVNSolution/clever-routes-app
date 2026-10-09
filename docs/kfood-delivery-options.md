# Configured delivery proof and toll navigation

The route contract adds `deliveryProof: {photoRequired, signatureRequired}` and `tollPolicy: ALLOW_TOLLS | AVOID_TOLLS`.
Missing legacy fields mean optional proof and ordinary navigation. Malformed supplied fields reject the route response.
The server owns policy persistence, publication, compatibility checks and proof validation. Policy is fixed before active delivery.

## Driver flow

The driver presses Complete once. Unpaid Cash opens the amount dialog. A route with required proof adds only its required photo/signature controls to that same dialog.
eTransfer does not request Cash. Optional proof does not add a completion step. No synthetic Arrived event is emitted.

The signature pad captures the actual drawing as PNG. It uses the SDK-compatible [React Native view capture library](https://docs.expo.dev/versions/latest/sdk/captureRef/).
Captured photos and signatures are copied into the app-private document directory before a durable reference is shown.
These [document files](https://docs.expo.dev/versions/latest/sdk/filesystem/) survive cache eviction and in-place app updates.
Uninstalling the app still removes app data. Do not uninstall an operating package to diagnose unsent evidence.

## Upload and replay

`POST /driver/proof-media` sends multipart `kind=photo|signature`; omission remains a photo. Signature sends PNG with `source=signature`.
The queue stores upload requests before transport. It retains each server upload receipt in encrypted sensitive storage.
A completion stores immutable Cash, client event, assignment and publication identities plus local proof dependencies.
Transport resolves those dependencies to `proof.photoMediaId` and `proof.signatureMediaId` only after upload receipts exist.
The completion remains saved while uploads are unavailable. A retry uses the same media IDs and event identity.
Unconfirmed completion references pin their upload receipts beyond ordinary terminal audit expiry.
If an upload is permanently rejected before any completion can be sent, the stop detail offers replacement proof.
The original Cash, event, timestamp and assignment remain immutable. A private replacement mapping resolves the original proof dependency.
An upload with a server receipt or an accepted completion cannot be replaced through this path.
Account changes and reassignment cannot replay another account or generation's proof.
Cash input drafts and signature references use the existing encrypted route draft, including Apply and reopen recovery.

## Capability rollout

An official package with versionCode at least 43 and the single completion feature enabled registers `delivery-proof-v1`.
Registration occurs after authentication/restoration/refresh and before route lookup, including an account with no routes.
`POST /driver/capabilities` uses the account bearer and the current refresh token plus capability/versionCode/packageId.
Never log the request body or tokens. QA packages and version 42 do not register this production capability.
The server must be deployed before the new app. Required proof remains off until the compatible app is available.
New ordered events also send `deliveryProofCapability: delivery-proof-v1` when the feature is enabled. Existing queued event metadata is never upgraded in place.
The server separately gates required-proof publication and each completion. A version label alone does not enable proof.

## Toll policy

Route and iOS Google Maps links carry `avoid=tolls`. Android Google Maps does the same; Waze carries `avoid_tolls=true`.
These are supported [Google Maps URL parameters](https://developers.google.com/maps/documentation/urls/get-started) and [Waze deep-link parameters](https://developers.google.com/waze/deeplinks/).
For other Android providers, an avoid-tolls route shows a clear unsupported-provider message instead of silently dropping the policy.
The driver can select Google Maps or Waze in Settings. The external provider still calculates its own navigation route.
Server optimization/ETA must apply the same policy independently. The app cannot prove that an external provider avoided every tolled road.

## Verification and known boundary

Tests cover default/required proof, one completion and Cash value preservation, account/session capability, media-upload ordering,
encrypted cold reopen and delayed completion recovery, old route caches, and toll URL propagation.
The original field report that an app update left an old route has not been reproduced. These regression checks do not establish its root cause.
Native signature PNG, force-stop/offline delivery and a real in-place QA update require device evidence before release approval.

Two native dependencies were added: view-shot 5.1.0 and expo-file-system 57.0.7.
The latter replaces Expo's nested 57.0.6 copy. The reviewed audit graph adds view-shot's peer dependency edge to react-native.
No new advisory is suppressed. Raw npm audit remains exit 1 with the known host-tool findings; pinned backport checks remain mandatory.

The local `--proof` QA build uses versionCode 43 only for the `.cashqa` package. Production remains version 42 in source until a separately verified release reservation.
