# PR299 supplemental host-security verification proposal — 2026-10-08

**The existing raw npm audit gate remains unchanged.** This document proposes a separate acceptance rule for the two pinned host-source patches. It does not modify `.github/workflows/ci.yml`, approve an exception, or authorize deployment. Implementation commit: **recorded by PR**.

The current CI step runs `npm audit --audit-level=moderate`. The recorded report fails with exit 1. A supplemental verifier may return 0 only when its independent patch and regression checks pass. That result means **the bounded patch policy passed**, not that npm audit passed or all release gates passed.

## Bounded scope and command

Reuse the implementation and evidence in [dependency audit](kfood-pr299-dependency-audit-20261008.md), [patch manifest](../../scripts/security-patches/manifest.json), and [patch maintenance](../../scripts/security-patches/README.md). The only eligible advisory roots are:

| Package / pinned version | Advisory | Bounded patch |
| --- | --- | --- |
| `braces@3.0.3` | `GHSA-vfj7-8cjw-p6xm` | Parser-depth rejection before recursive processing of parsed string inputs. It does not certify arbitrary externally constructed ASTs. |
| `node-forge@1.4.0` | `GHSA-86w9-cpqp-85rv` | DigestAlgorithm child-count and empty-NULL validation from the pinned upstream proposal. |

The verifier interface is:

```sh
npm run verify:host-security -- \
  --source-sha "$(git rev-parse HEAD)" \
  --output "$RUNNER_TEMP/host-security-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

`--source-sha` must resolve to the exact current 40-character commit. The working source must be clean. The output must be a new evidence directory outside the repository. Do not reuse stale evidence or substitute a prior commit's successful regressions.

Acceptance requires all of the following:

1. Capture the current `npm audit --audit-level=moderate --json` stdout bytes, stderr, and process exit code without rewriting or suppressing them. Collection errors are failures.
2. Independently verify pinned lockfile, patch-policy, patch-manifest, and source hashes. An installer's earlier success is insufficient.
3. Enumerate and verify every installed target copy, including nested paths. Require exact pinned versions, allowed paths, package integrity, and final patched bytes. Reject missing, unexpected, outside-tree, or partially patched copies.
4. Validate the actual current advisory graph against the bounded policy: advisory identity/content, affected package/version, dependency propagation, and installed paths. Reject any new or changed advisory, version, path, graph, or hash. Report actual findings and root counts. **Do not require a fixed count of 20**, infer absent roots, or treat fewer findings as proof of a patch. Zero or one reported root must be represented as such and independently validated.
5. Run the existing 13 host-security regressions against the current installation and source. Require their successful exit and complete results. These cover deep input rejection, malformed DigestAlgorithm rejection, normal Metro matching, valid Expo signing/certificates, and installation integrity. A regression failure or incomplete run fails acceptance.
6. Emit the source commit, checked policy/digests, installed-copy inventory, actual advisory graph, regression results, and supplemental decision alongside the untouched audit evidence. A raw exit 1 remains recorded as 1 even if supplemental acceptance is 0.

Do not change dependency names or versions only to hide detection. Do not add audit ignores, lower the moderate threshold, filter audit output, use `continue-on-error`, or discard stderr. This policy addresses only the two listed roots and their verified propagation paths. It is not a general permission for high findings.

## Verifier validation

The verifier tests pass **24/24** with zero skips. Cases include the current two-root graph, zero/one-root reports, supported cycles, unknown or forged advisory/dependency/effect paths, incorrect counts/exit codes, missing or partial patches, nested/aliased copies, lock/manifest/integrity drift, source SHA and hidden tracked-file drift, collection errors, failed or incomplete regressions, and mutation during regression execution.

The existing 13 security tests remain unchanged. The verifier requests the TAP reporter explicitly because Node versions have different default reporters. A successful process without the exact complete test summary is insufficient. Scoped lint and TypeScript checks passed. Exact committed-source execution and final CI results are recorded in PR299 and the external evidence directory; neither result changes the active CI audit policy.

Output files are `audit.stdout.json`, `audit.stderr.log`, `audit-process.json`, `regressions.stdout.log`, `regressions.stderr.log`, and `summary.json`. Collection/verification failures preserve available evidence. A regression is not run after an earlier validation failure. Output directories must be new, and existing evidence files are never overwritten.

## Not-applied CI proposal

The diff below is a **proposal for later explicit review**. The repository's current audit step stays in place until that policy decision. If approved, the verifier would run the unchanged raw audit command internally and use a distinct supplemental acceptance result for the CI step. That is an acceptance-policy change, not a green raw audit.

Only the audit step and unconditional evidence upload would change; install, workspace, lint, build, Expo alignment, and whitespace checks remain as they are:

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@
-      - name: Audit npm dependencies
-        run: npm audit --audit-level=moderate
+      - name: Verify bounded host-security patches and preserve raw audit
+        run: |
+          npm run verify:host-security -- \
+            --source-sha "$(git rev-parse HEAD)" \
+            --output "$RUNNER_TEMP/host-security-${{ github.run_id }}-${{ github.run_attempt }}"
+
+      - name: Upload host-security evidence
+        if: always()
+        uses: actions/upload-artifact@v4
+        with:
+          name: host-security-${{ github.sha }}-${{ github.run_attempt }}
+          path: ${{ runner.temp }}/host-security-${{ github.run_id }}-${{ github.run_attempt }}/
+          if-no-files-found: error
       - name: Check Expo dependency alignment against installed SDK
```

The upload runs even when verification fails. Missing evidence is a failure, not an empty success. The artifact must contain the raw audit output/exit and the separate supplemental decision. A later reviewer must be able to see a failed raw audit without reconstructing it from a summary.

## Transition and maintenance

When an upstream fixed release becomes available, verify its advisory coverage and compatible dependency paths. Deliberately refresh dependency pins and the verifier policy, then rerun clean installation, raw audit, all 13 regressions, and affected build checks. Remove a backport only after the fixed installed bytes are verified. Do not silently broaden the policy when an advisory or dependency graph changes. A change outside the pinned policy fails until reviewed.

## Integration status and independent release gates

Read-only GitHub observation at **2026-10-08 13:15:53 UTC**:

| PR | Observed state | Head / base |
| --- | --- | --- |
| [Server 486](https://github.com/EVNSolution/clever-route-server/pull/486) | OPEN, Draft; unmerged | `9bd6e7b8408508c83b1e4255a62c37ee9b983bf0` → `main` |
| [Server 489](https://github.com/EVNSolution/clever-route-server/pull/489) | OPEN, Draft; unmerged | `bd132f199c2a058d8e14fe33d97497307a51af45` → `codex/kfood-live-route-change` |
| [App 297](https://github.com/EVNSolution/clever-routes-app/pull/297) | OPEN, Draft; unmerged | `e2236e67efb8ece0bddfe5af503deb7fa77d4e6f` → `dev` |
| [App 299](https://github.com/EVNSolution/clever-routes-app/pull/299) | OPEN, Draft; unmerged | `082a13e4256527852868e40c271e67b95b371e0b` → `cc-314-kfood-live-change` |

All four returned null `mergedAt` and `mergeCommit`. The app PR head above is an observation baseline; the verifier implementation commit is recorded by PR and its own exact-source evidence.

The read-only [canonical app context](https://github.com/EVNSolution/clever-context-monorepo/blob/1d0e0ce18699f4dcba95f965090a9f6c741fe2bf/docs/services/clever-routes-app/index.md) remains at main `1d0e0ce18699f4dcba95f965090a9f6c741fe2bf`, file blob `a39d60642f57a44068d8b09cd2919bd94ce5686a`. It still describes payment collection as read-only. The required context reconciliation remains separate; this task does not write to that repository.

Server migration application, compatible deployment, and final app/server integration evidence remain **unverified here**. Open PR status proves neither deployment nor its absence. Follow the existing [feature activation conditions](kfood-pr299-feature-activation-20261008.md): server486 → 489 with schema/deployment proof, then app297 → 299 integration, then a separately reviewed exact-source ON candidate and distribution/rollback plan.

The signed **1.3.5 / 41 AAB stays OFF and unchanged**. Supplemental security acceptance does not turn it ON, reserve a version, build a replacement, waive native/integration gates, or authorize merge, publication, deployment, or operating-app replacement.
