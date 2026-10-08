# Pinned host dependency security patches

These patches change executable dependency source. They preserve package names,
versions, licenses, and the npm lockfile. They do not suppress npm advisories.
The unchanged audit command still reports 20 High findings on 2026-10-08.

## Scope and provenance

- `braces@3.0.3`, MIT: a local parser guard rejects nested AST containers deeper
  than 100 before recursive compilation, expansion, or stringification.
  [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
  [upstream report](https://github.com/micromatch/braces/issues/70).
  This guards string inputs parsed by braces. It does not certify arbitrary
  caller-created AST objects that bypass the parser. Quotes and escapes remain
  literal; normal Metro glob matching and 100-level patterns remain supported.
- `node-forge@1.4.0`, BSD-3-Clause OR GPL-2.0: the exact `lib/rsa.js` hunk from
  [upstream PR1157](https://github.com/digitalbazaar/forge/pull/1157), commit
  `683ab3344899cc08a581e4d5675a33e87aff7b04`, checks nested DigestAlgorithm child
  counts and requires any ASN.1 NULL parameters to be empty. This supplements
  [PR1152](https://github.com/digitalbazaar/forge/pull/1152) for
  [the advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
  PR1157 was open and unmerged when checked on 2026-10-08. This is a reviewed
  backport, not a claim that an upstream fixed release exists.

`manifest.json` pins tarball integrity, original source SHA-256, patched source
SHA-256, and each exact replacement. Original package license files remain intact.

## Installation and checks

`npm ci` runs `scripts/patch-host-security.mjs` first in `postinstall`, followed by
the existing Expo location notification patch. The installer validates every
locked copy, including nested copies, before writing any source. It rejects
unexpected versions, integrity metadata, source bytes, or paths outside the
installed dependency tree. An already patched file must match the exact patched
hash. Repeated installation is idempotent.

Run:

```sh
npm run postinstall
npm run test:host-security
npm audit --audit-level=moderate
```

The tests cover deep braces and parentheses, normal Metro matching, malformed
DigestAlgorithm children, nonempty NULL parameters, valid optional NULL forms,
and actual Expo certificate/signature operations. Synthetic private-key signatures
test parser acceptance; they do not demonstrate forgery without a private key.
Fixture tests check exact application, idempotence, source drift, version drift,
integrity drift, and nested dependency copies.

The local security regressions pass. The npm audit gate remains red because the
original versions remain in the lockfile and npm does not attest these source
patches. No exception, threshold change, version disguise, or release waiver is
part of this change.

## Maintenance

When a compatible upstream fix is published, review its advisory coverage and
source changes. Update the pinned dependency and manifest deliberately. Rerun
the security and normal-operation regressions, a clean install, the unchanged
audit command, and the required build checks. Do not change package identities
only to make the scanner stop reporting an affected version.
