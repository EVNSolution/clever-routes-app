# KFood live-change client verification

Issue: EVNSolution/clever-routes-app#296. Change control: EVNSolution/clever-change-control#314.

## Checks

- `npm run check:workspace`: source layout, TypeScript, and 1,015 tests passed.
- `npm run lint`: zero errors; three `resetRouteProgress` callback dependency warnings remain.
- `npm run build`: Android and iOS Hermes exports passed using an explicit local test API origin.
- `npm run check:native-release`: all local configuration checks passed; external distribution gates remain separate.
- `EXPO_OFFLINE=1 npx expo install --check`: installed dependency alignment passed. Offline mode does not verify the remote registry.
- [Actual Shopify/server/mobile HTTP verification](./kfood-live-change-local-api-20261007.md): ten scenarios passed against the final source digest in the result JSON.
- `git diff --check`: passed.

The full suite initially exposed an existing diagnostic test whose fixed credential
expired relative to the real clock. The same failure reproduced on unchanged main.
The test now injects the same fixed clock as its other harness. Diagnostic runtime
behavior was not changed. Existing source assertions were updated for the new
recovery helper and nonprojecting authentication refresh.

## Review checks

Review covered private Save, exact publication application, ACK loss, new
publications during ACK, terminal stop preservation, input persistence, cold
recovery, same-route reassignment, and original offline evidence identity.
READY routes retain their baseline without calling an active-delivery-only API.
DSV routes do not enter this KFood flow. An unresolved recovery gate postpones
offline replay rather than quarantining evidence based on an unconfirmed version.

The actual banner component was inspected in a 360-pixel browser layout preview
with native-style mapping. Pending, disabled, ACK retry, and error states remained
readable with a visible route name and action. This preview is not a React Native
device screenshot.

## Release limits

The local Android APK build and its source/hash metadata are separate artifacts
outside Git. Neither exported bundles nor an APK build prove physical-device
SQLCipher, SecureStore, camera, push, or background OS behavior. Those acceptance
checks remain open. No driver's installed application was replaced.

No production migration, deployment, merge, store publication, or real driver
notification was performed. The office feature must remain disabled until the
matching server/app release and device acceptance are approved.

The context service pointer was reviewed. Repository responsibilities and the
server-owned API authority remain unchanged. This draft adopts the existing
server contract and documents the client behavior in the owning repository.
The canonical context's general push-refresh description needs an explicit
KFood Apply exception before integration/release; it was not rewritten as a claim
about currently deployed behavior. Issue closure remains pending that review and
the release acceptance checks.
