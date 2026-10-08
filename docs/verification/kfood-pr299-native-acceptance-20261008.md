# PR299 focused native acceptance — 2026-10-08

The focused native pass completed on **R3CN80SCYPL** using the isolated QA package. The synthetic server recorded **7 `STOP_DELIVERED`, 0 `STOP_ARRIVED`, and 7 receipts**. Each client event ID has exactly one completion event and one receipt.

Both process-kill cases preserved the original Cash request. The final offline receipt screen showed **Recorded by server** and **CAD 50.00**. Server receipts and native queue diagnostics also confirm acknowledgement.

## Build and evidence identity

- Source: `985f999ad2c4f9354ff2c856174e4542410c6554`.
- Native package: `com.evnsolution.clever.routes.cashqa`, version `1.3.5` / `41`.
- APK SHA-256: `ce8a8b1e6ebbe76c80a54e1879e73282025dd924dbbe9ac31cf9bf30a25c8ec6`.
- Test service: local synthetic fixture using the server PR489 contract.
- Times below use UTC. The device displayed its local time.
- Sanitized records and selected artifact hashes: [native acceptance JSON](kfood-pr299-native-acceptance-20261008.json).
- Raw artifacts remain outside Git at `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008`.

The JSON whitelists completion IDs, times, amounts, stop indexes, counts, and build/evidence metadata. It does not copy location coordinates, credentials, PINs, or contact values. XML and PNG hashes identify the original captures without committing them.

## Screen and behavior results

| Case | Observed result | Selected evidence suffix |
| --- | --- | --- |
| Current stop 1 | One `Complete Delivery` action; no arrival action | `current-first-stop` |
| Empty Cash amount | Popup starts empty; confirmation shows the required-amount error | `cash-empty-current`, `cash-empty-error` |
| Cancel Cash 122 | No completion receipt; reopening restores `122` | `cash-cancelled`, `cash-draft-restored`, `cash-before-first-confirm.json` |
| Cash 122 | Receipt shows actual 122.00 and difference -0.25 | `recovered-receipt-details` |
| Cash 122.25 | Receipt shows actual 122.25 and difference 0.00 | `receipt-equal` |
| Cash 123 | Receipt shows actual 123.00 and difference +0.75; expected amount is struck through | `receipt-123` |
| Cash 0 | Zero is accepted; receipt shows difference -122.25 | `receipt-zero` |
| Current stop 5 e-Transfer | One completion press; no Cash popup; receipt count advances to 6 | `current-etransfer-before`, `etransfer-one-tap-complete`, `etransfer-one-tap.json` |
| Future stop 8 | Out-of-order confirmation appears; cancel leaves receipt count 1; confirm creates one receipt and keeps current stop 2 | `future-order-confirmation`, `future-cancelled`, `future-confirmed` |
| Stop details | Address/copy control, order, phone, Call, and Message are available | `stop-details-address` |
| Missing phone at stop 8 | `Phone unavailable`; Call and Message are absent | `missing-phone-details` |
| Offline stop 9 after restart | Submitted CAD 50.00 remains visible with `Awaiting server confirmation` | `offline-restored-amount` |
| Offline stop 9 after acknowledgement | `Recorded by server`, actual CAD 50.00, unknown expected amount and difference retained | `offline-final-server-receipt` |

Screenshot names use `screenshots/R3CN80SCYPL-<suffix>.png` and `.xml`. The JSON contains exact filenames, SHA-256 values, dimensions, and selected XML assertions. Interaction results combine captures, native operator observations, and server checkpoints; a static screenshot alone does not prove the full interaction sequence.

## Receipt ledger

Amounts are CAD decimal strings. A dash means the server returned no amount or difference. The JSON includes the exact client event, server event, and receipt IDs.

| Stop | Method | Original event time | Expected | Actual | Difference | Server events / receipts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | CASH | 11:39:26.884Z | 122.25 | 122.00 | -0.25 | 1 / 1 |
| 8 | ETRANSFER | 11:48:16.630Z | 122.25 | — | — | 1 / 1 |
| 2 | CASH | 11:49:36.361Z | 122.25 | 122.25 | 0.00 | 1 / 1 |
| 3 | CASH | 11:50:43.110Z | 122.25 | 123.00 | 0.75 | 1 / 1 |
| 4 | CASH | 11:51:49.072Z | 122.25 | 0.00 | -122.25 | 1 / 1 |
| 5 | ETRANSFER | 11:52:52.098Z | 122.25 | — | — | 1 / 1 |
| 9 | CASH | 11:54:35.058Z | — | 50.00 | — | 1 / 1 |

## Kill after server commit, before response

1. Stop 1 submitted client event `1aef6f0f-9c05-4a82-bcbb-98b9efb30148` at `11:39:26.884Z`, with Cash `122.00`.
2. The server committed at `11:39:27.270Z`. It held the response at `11:39:27.305Z`; `responseDelivered` was false.
3. The native process `16662` was force-stopped at `11:39:27.474969Z`. No process remained after the kill.
4. The same installation restarted as process `17941`. At `11:43:04.106Z`, native diagnostics reported queue depth 1 with oldest time `11:39:26.884Z`.
5. Receipt recovery reduced queue depth to 0 at `11:43:04.935Z`. The receipt screen showed actual Cash `122.00`.
6. The server retained exactly one event and receipt `7e88c6a5-80e7-4977-acb8-27e6a3332829` for that original ID.

Evidence: `native-kill-after-commit.json`, `after-commit-restart.json`, `native-fixture.json`, and the restart/recovered-receipt captures. The process IDs come from the native test record and operator observations.

## Offline submission, kill, restart, and recovery

1. The QA server destroyed transport while offline. Stop 9 queued client event `d88b41cf-3fce-4c8c-92ff-4b15ef2e349c` at `11:54:35.058Z`, with Cash `50.00`.
2. Process `17941` was force-stopped at `11:55:30.692283Z`. There were still 6 server receipts. The installation was retained.
3. Process `21070` restarted while transport remained offline. The stop detail screen showed the saved `50.00` and pending confirmation state.
4. After reconnect and explicit refresh, the server committed the original request at `11:58:55.038Z`. The original ID, time, and amount matched the receipt.
5. The response was held at `11:58:55.062Z`. The client connection closed at `11:59:10.040Z` after the request timed out. The queue retained the original Cash request.
6. A second explicit refresh reconciled the applied receipt. Native diagnostics reported queue depth 0 at `12:01:49.545Z`, and again at `12:02:11.373Z`.
7. The server retained one event and receipt `f0562969-1de8-42a0-98de-a4a248fd4e2a` for that original ID.

The queue also contained independent location events during offline recovery. Its total depth was not a Cash-only count. The original Cash timestamp and final zero depth provide the relevant queue evidence.

Evidence: `offline-native-kill.json`, `offline-after-refresh.json`, `native-fixture.json`, and `offline-restored-amount`/`offline-restored-pending-list` captures. The final `offline-final-server-receipt` capture and visual review confirmed the acknowledged Cash 50.00 after the temporary device interruption ended.

## Native storage corroboration

The inspected APK contains `lib/arm64-v8a/libexpo-sqlite.so` (AArch64, 1,901,944 bytes). Its SHA-256 is `a72ccca61adfaeda45d5c88b90b67e92bae3442c8a4a6f2004750f5d645db07c`.

The library defines `sqlcipher_version`, `exsqlite3_key`, `exsqlite3_key_v2`, `exsqlite3_rekey`, and `exsqlite3_rekey_v2`. SQLCipher export, cipher-version, and integrity-check markers are present. App and Android configuration enable SQLCipher. Storage applies the key before cipher/schema reads and rejects unavailable cipher or invalid-key access.

The configured database is `clever_driver_evidence_v2.db`. Its derived Android user-0 location is `/data/user/0/com.evnsolution.clever.routes.cashqa/files/SQLite/clever_driver_evidence_v2.db`. The key remains in SecureStore; no key value or database bytes were extracted. These native-library/configuration findings and real device restarts support native persistence. They are not direct encrypted-file inspection or file-mock evidence.

`checks/native-storage-evidence.json` was written before the offline kill case. Its pending-offline statement is superseded by this record. Its direct-database-inspection limitation remains. The fixture omits diagnostic operation/error details, so diagnostics cannot prove the absence of every SQLite or cipher error.

## Boundaries and remaining native checks

At `12:02:20.481605Z`, the device foreground changed externally to `com.android.settings/.Settings$WifiSettingsActivity`. The QA helper rejected input. All device mutations stopped. `device-occupation-interruption.json` records the boundary. After the QA app returned to the foreground, a separate read-only check found only this task's log readers. Input resumed only for the final receipt capture and cleanup.

- Native account-switch, reassignment, and PR297 Dispatch screen checks were not run in this focused pass. They remain supplemental native release checks.
- Recovery used explicit refresh. Unattended reconnect latency was not established.
- Native store-build/device acceptance and wider legacy release gates are separate from this QA-package evidence.
- No merge, deployment, store rollout, or production-app replacement is claimed or authorized by this record.

## Cleanup and preserved applications

At `12:08:56.876367Z`, the Cash QA process was stopped and its owned reverse port 8445 was removed. HTTPS, Fastify and Prisma were closed; temporary PostgreSQL and synthetic proof files were stopped/removed. QA installation data remains intact. Only task-owned log readers were terminated.

The operating package remained `1.3.3` / `39`, and the prior `.qa` package remained `1.3.4` / `40`. Their version, first-install and last-update metadata matched the before/after records. PR297 and server/Shopify product code were not edited.

The captured log buffer for process `21070` contained 972 lines and no SQLiteException, released-object or FATAL EXCEPTION match. This is scoped evidence from this run, not a claim that every storage error is impossible.
