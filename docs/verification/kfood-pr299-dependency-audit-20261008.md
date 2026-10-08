# PR299 dependency audit — 2026-10-08

## Decision

**The audit gate remains blocked with 20 High findings.** Pinned source patches now reject the tested brace-depth and malformed DigestAlgorithm inputs. The security and normal-operation regressions pass. These results do not make the unchanged npm audit gate green.

The patches preserve dependency versions, resolved packages, the lockfile, audit thresholds, and ignore rules. `package.json` adds the security installer to `postinstall` and a focused test command. No app runtime or release identity changed in this security follow-up. No compatible published fix was available when checked on 2026-10-08.

- App baseline reviewed: `4c7f3cc57e28c263e484f2c44fa01b329faca79e`. QA41 includes the 1.3.5/41 release identity changes committed as `985f999ad2c4f9354ff2c856174e4542410c6554`.
- Checkout: `/Users/jiin/.codex/worktrees/kfood-app-single-completion-cash/clever-routes-app`.
- Baseline audit `package.json` SHA-256: `cfce1406e23b9f5aeb08989afc1bb248ac28d2a1764dcf5974d381ce23d6e335`.
- Baseline audit `package-lock.json` SHA-256: `8ceaca60f6f4dd82a5334ac2594f3b948c25e42c033121c58cc8ceded6d1af45`.
- QA41 `package.json` SHA-256: `0a998b4af7fe1c09a0a69fd0d1751f5435448599f0d8e70466da78949d2fd9b1`.
- QA41 `package-lock.json` SHA-256: `b26e49a7f9e2bd3860b5fd3291c088631be85bae314b056270ccfa28ea7322a5`.
- Security follow-up baseline: `757baefff29f3e7afef800d0fd080df1fad721d8`. The package hashes above describe the historical QA41 input, before the new installer scripts.

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

Application runtime source has no direct imports of braces, micromatch, or Forge. The new security regression harness intentionally loads these host dependencies. The observed application execution surface remains development/build tooling; this does not prove every possible tool invocation is safe. These dependencies remain under Expo's production install graph, so `--omit=dev` does not remove the audit findings.

## Implemented source patches and regression evidence

The reproducible installer is `scripts/patch-host-security.mjs`. The exact replacements, tarball integrity, source hashes, and provenance are in `scripts/security-patches/manifest.json`. Maintenance instructions are in `scripts/security-patches/README.md`.

- `braces@3.0.3`: a local parser guard rejects AST container depth above 100 before recursive traversal. String inputs with 101 or 4,000 nested braces or parentheses now throw a controlled `SyntaxError`. Normal Metro watcher patterns, escaped/quoted literals, and 100-level nesting pass. This does not certify manually constructed AST objects that bypass the parser.
- `node-forge@1.4.0`: the exact `lib/rsa.js` hunk from [upstream PR1157](https://github.com/digitalbazaar/forge/pull/1157), commit `683ab3344899cc08a581e4d5675a33e87aff7b04`, rejects extra DigestAlgorithm children and nonempty ASN.1 NULL parameters. The PR was open and unmerged on 2026-10-08. This hunk includes and supplements the earlier PR1152 proposal. Valid absent/empty NULL forms and actual Expo certificate validation and signing pass.
- The installer validates every locked copy before changing any file. It checks package name/version, lock version/integrity, original or patched source hash, and target containment. Unknown source bytes fail closed. Nested copies and repeated installation are tested. Original MIT and BSD-3-Clause OR GPL-2.0 package license files remain intact.

| Target | Original source SHA-256 | Patched source SHA-256 |
| --- | --- | --- |
| `braces/lib/parse.js` | `e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310` | `4bb65f436abe7574f3eeb221d95c3794d99d10ec97c4f7398c4e8d2d0218ade6` |
| `node-forge/lib/rsa.js` | `fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50` | `22cdfb3220439533211cf00ff7c7e6605607761d77a2c3c263411d4c70798c4f` |

The first regression run against original sources failed both security tests: deep input did not receive the controlled rejection, and extra DigestAlgorithm children were accepted. Normal-operation and installer fixture tests passed. A later review added the nonempty NULL regression. It failed against the PR1152-only intermediate patch, then passed after PR1157 was applied. The final focused suite passes all 13 tests. These synthetic private-key signatures demonstrate malformed parser acceptance and rejection; they do not demonstrate keyless forgery.

The postinstall chain passes and reports `2 verified, 0 changed` on repetition. Scoped ESLint and TypeScript diagnostics pass. Clean `npm ci` replay and final Android/iOS exports belong to final CI verification; this local result does not claim those checks have completed.

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

This is the final QA41 APK for device acceptance, not a distribution candidate. It does not certify production signing, the production endpoint, or a final distribution bundle. Even an absent runtime module does not clear a vulnerable build dependency or the CI gate.

## Signed production AAB exposure evidence and limits

The subsequent EAS production build used source `985f999ad2c4f9354ff2c856174e4542410c6554` and produced the 1.3.5/41 operating-package candidate. That preserved AAB was built **before** these host source patches. It retains the original feature-OFF configuration and cannot be relabeled as a patched or activated candidate. This security follow-up did not rebuild or replace it.

- AAB SHA-256: `3c620a406c54e7bf8af0b9d1f1c2b0bbd7a682daa0252d30fa1986e67313b789`.
- Exact embedded `base/assets/index.android.bundle` SHA-256: `2f7f4a08653b1db8157c860ab0a83a1e5172e89c80c60e4608eebd1b353c3187`.
- No package-name/path marker for `braces`, `node-forge`, `micromatch`, or `@expo/code-signing-certificates` appeared in ZIP entries or the UTF-8/UTF-16LE bundle scan.
- No production JavaScript source map or module inventory was available in the inspected artifacts. The production and QA bundles differ. The QA map cannot establish production module absence.

The exact AAB probe found no direct package-marker evidence; it does **not** prove that vulnerable code is absent. Production signing and endpoint checks are recorded separately in the [candidate record](kfood-pr299-release-candidate-20261008.md). Build-host exposure and the 20 High audit failure remain. Probe details: private `checks/eas-candidate-dependency-exposure.json`.

## Checks and retained evidence

| Check | Result |
| --- | --- |
| `npm audit --audit-level=moderate` — unchanged CI command | **FAIL**, exit 1; 20 High, 0 other findings |
| `npm audit --audit-level=high --json` | **FAIL**, exit 1; same two advisory roots and 20 High findings |
| `npm audit --audit-level=high --omit=dev --json` | **FAIL**, exit 1; 20 High findings |
| `npm ls braces node-forge --all`, installed manifests, lockfile edge inspection | Dependency paths confirmed |
| Registry versions and upstream advisory/PR status | No published fixed leaf versions |
| Final QA41 bundle/source-map inspection and APK manifest read | Scope and limitations above |
| Historical QA41 comparison against baseline package/lock JSON, excluding package and root-lock `version` | PASS at QA41 creation; only release identity changed then |
| Security follow-up package/lock changes | `package.json` adds installer/test commands; lockfile and dependency identities unchanged |
| `npm run test:host-security` | PASS, 13/13; security rejection, actual Metro/Expo signing, and install integrity |
| `npm run postinstall` | PASS; security patches verify without further changes; existing Expo patch chain completes |
| Scoped ESLint, TypeScript diagnostics, `git diff --check` | PASS |
| Post-patch `npm audit --audit-level=moderate --json` | **FAIL**, exit 1; still 20 High findings |

Private raw audit records:

- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-before.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-full.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/dependency-audit-production-install.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/cash-qa-bundle-exposure.json`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/host-security-before.log`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/host-security-null-before.log`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/host-security-after.log`
- `/Users/jiin/.codex/artifacts/kfood-pr299-release-ready-20261008/checks/host-security-audit-after.json`

No red-to-green audit result exists. npm reports affected package identities; it does not attest local source patches. The executable host sources changed and the listed regressions pass. No app runtime changed, and this security follow-up did not repeat F01/F02 device cases or trigger a native build.

## Concrete next options

1. Review the implemented pinned patches and final CI clean-install/export evidence. The source-level regression results support this bounded backport; they do not authorize an audit exception.
2. To clear the existing audit gate, adopt a compatible published fixed dependency or a reviewed dependency-path replacement that removes the affected code and passes the unchanged scanner. Verify advisory coverage and rerun the security, Metro, signing, and required build checks. Changing only a package name/version to evade detection is not a fix.
3. Until the unchanged gate passes, retain the release block. No SDK downgrade, threshold reduction, advisory suppression, or host-only exposure waiver is included.
