# PR299 dependency audit — 2026-10-08

## Decision

**Blocked: 20 High findings remain.** These findings propagate from two direct advisories. No compatible published fix was available when checked on 2026-10-08. No dependency version, resolved package, audit threshold, or ignore rule changed. Package and root-lock versions changed only for the 1.3.5 release identity. Host-tool exposure does not mean the vulnerabilities are fixed.

- App baseline reviewed: `4c7f3cc57e28c263e484f2c44fa01b329faca79e`. QA41 includes the subsequent 1.3.5/41 release identity changes; final source SHA is pending.
- Checkout: `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app`.
- Baseline audit `package.json` SHA-256: `cfce1406e23b9f5aeb08989afc1bb248ac28d2a1764dcf5974d381ce23d6e335`.
- Baseline audit `package-lock.json` SHA-256: `8ceaca60f6f4dd82a5334ac2594f3b948c25e42c033121c58cc8ceded6d1af45`.
- QA41 `package.json` SHA-256: `0a998b4af7fe1c09a0a69fd0d1751f5435448599f0d8e70466da78949d2fd9b1`.
- QA41 `package-lock.json` SHA-256: `b26e49a7f9e2bd3860b5fd3291c088631be85bae314b056270ccfa28ea7322a5`.

## Official evidence and compatible versions

| Package | Installed / registry latest | Advisory | Checked result |
| --- | --- | --- | --- |
| `braces` | `3.0.3` / `3.0.3` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), updated 2026-10-02 | Affected through 3.0.3; patched versions: none. Recursive brace-pattern processing can exhaust the host stack. |
| `node-forge` | `1.4.0` / `1.4.0` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), updated 2026-10-01 | Affected through 1.4.0; patched versions: none. Nested DigestAlgorithm elements can bypass RSA PKCS#1 v1.5 signature validation. |

`npm view braces version` and `npm view node-forge version` returned the same affected versions. The [braces upstream report](https://github.com/micromatch/braces/issues/70) remained open. The proposed [Forge fix, PR1152](https://github.com/digitalbazaar/forge/pull/1152), remained open and unmerged. Its proposed 1.4.1 changelog entry is not a published release.

Parent-package checks did not provide a complete compatible fix:

- `@expo/cli` 57.0.28 still depends on `node-forge ^1.3.3` and `@expo/code-signing-certificates ^0.0.6`.
- `@expo/code-signing-certificates` 0.0.7 still depends on affected `node-forge ^1.4.0`.
- `@expo/metro-file-map` 57.0.4 removes its micromatch dependency, but `metro-file-map` 0.84.6 still depends on `micromatch ^4.0.4`. Updating the Expo fork alone does not remove the second braces path or Forge.
- `micromatch` registry latest is 4.0.8; the installed version requires `braces ^3.0.3`.

The audit suggestion to install Expo 44.0.6 is a breaking SDK downgrade. It was not applied.

## Actual dependency and execution paths

The lockfile and installed manifests contain these paths:

```text
expo@57.0.21
└─ @expo/cli@57.0.23
   ├─ node-forge@1.4.0
   ├─ @expo/code-signing-certificates@0.0.6 → node-forge@1.4.0
   └─ @expo/metro-file-map@57.0.3 → micromatch@4.0.8 → braces@3.0.3

@expo/metro@56.0.2 / metro@0.84.5
└─ metro-file-map@0.84.5 → micromatch@4.0.8 → braces@3.0.3
```

Concrete local source evidence:

- `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/node_modules/metro-file-map/src/watchers/common.js`: host file-watch glob matching calls `micromatch.some`.
- `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/node_modules/@expo/code-signing-certificates/build/main.js`: certificate verification and `signBufferRSASHA256AndVerify` call Forge verification.
- `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/node_modules/expo/node_modules/@expo/cli/build/src/utils/codesigning.js`: CLI calls those certificate/signature functions.
- `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/node_modules/expo/node_modules/@expo/cli/build/src/run/ios/codeSigning/Security.js`: CLI also loads Forge for certificate handling.

App `src` and repository `scripts` contain no direct imports of braces, micromatch, or Forge. This narrows the observed execution surface to development/build tooling; it does not prove every possible tool invocation is safe. These dependencies remain under Expo's production install graph, so `--omit=dev` does not remove the audit findings.

## Final QA41 APK exposure evidence and limits

Inspected immutable APK copy:

`/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/cash-qa.apk`

- APK SHA-256: `ce8a8b1e6ebbe76c80a54e1879e73282025dd924dbbe9ac31cf9bf30a25c8ec6`.
- APK manifest confirms `com.evnsolution.clever.routes.cashqa`, versionName `1.3.5`, versionCode `41`.
- Build source: `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/android/app/build/outputs/apk/qa/app-qa.apk`.
- ZIP `assets/index.android.bundle` exactly matches `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/android/app/build/generated/assets/react/qa/index.android.bundle`.
- Immutable source map: `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/cash-qa.bundle.map`.
- Map build source: `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app/android/app/build/generated/sourcemaps/react/qa/index.android.bundle.map`.
- Source-map SHA-256: `97962aa63ff1c5c16e9a4d8dc0c2a6415e1ce52609e7a1ef7bb9f903cb8f8a8b`.
- The map lists 1,455 sources. It lists zero modules from `braces`, `node-forge`, `micromatch`, or `@expo/code-signing-certificates`.
- The Metro runtime file `@expo/cli/build/metro-require/require.js` is present. This evidence must not be described as excluding all Expo CLI files.
- No package-named ZIP entry matches those four packages. Source-map inspection supplies the stronger JavaScript module evidence.

This is the final QA41 APK for device acceptance, not a distribution candidate. It does not certify production signing, the production endpoint, or a final distribution bundle. When a production candidate is built, record its SHA and inspect its exact bundle/source map separately. Even an absent runtime module does not clear a vulnerable build dependency or the CI gate.

## Checks and retained evidence

| Check | Result |
| --- | --- |
| `npm audit --audit-level=moderate` — unchanged CI command | **FAIL**, exit 1; 20 High, 0 other findings |
| `npm audit --audit-level=high --json` | **FAIL**, exit 1; same two advisory roots and 20 High findings |
| `npm audit --audit-level=high --omit=dev --json` | **FAIL**, exit 1; 20 High findings |
| `npm ls braces node-forge --all`, installed manifests, lockfile edge inspection | Dependency paths confirmed |
| Registry versions and upstream advisory/PR status | No published fixed leaf versions |
| Final QA41 bundle/source-map inspection and APK manifest read | Scope and limitations above |
| Structured comparison against baseline package/lock JSON, excluding package and root-lock `version` | PASS; only release identity changed; dependency data remains frozen |

Private raw audit records:

- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-before.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-full.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-production-install.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/cash-qa-bundle-exposure.json`

No red-to-green audit result exists. No app runtime changed, so this dependency investigation did not repeat F01/F02 tests or trigger a native build.

## Concrete next options

1. Use a compatible published upstream fix when available. Verify advisory coverage, pin the resolved versions, and rerun the unchanged audit command. Then run Metro export, certificate/signature checks, and the required app build.
2. If release timing requires a backport, assess it as a separate reviewed dependency change. Pin the actual upstream patch or maintained source. Test deep brace nesting and normal Metro patterns; test malformed nested DigestAlgorithm rejection and valid signing/verification. Establish reproducible package integrity, provenance, license, compatibility, and audit evidence before adoption. Changing only a package name/version to evade detection is not a fix.
3. Until one option passes the existing gate, retain the release block. Do not downgrade the Expo SDK, weaken the audit threshold, suppress the advisories, or treat host-only exposure as a waiver.
