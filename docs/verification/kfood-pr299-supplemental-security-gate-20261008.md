# PR299 applied supplemental host-security CI policy — 2026-10-08

**CI now requires the bounded supplemental verifier.** The [workflow](../../.github/workflows/ci.yml) replaces its audit-only step with `npm run verify:host-security`. The verifier retains the raw `npm audit --audit-level=moderate --json` output and exit code, independently checks the pinned patches, and supplies a separate acceptance result. This is an applied CI policy change, not an audit suppression or deployment approval. Implementation commit: **recorded by PR**.

The historical [CI run 37785180770](https://github.com/EVNSolution/clever-routes-app/actions/runs/37785180770) failed at the raw audit gate. Its 20 High findings and exit 1 remain valid evidence. A supplemental result `verified` / exit 0 means the bounded patch policy passed; it does not change raw audit `failed` / exit 1. `releaseApproved` remains `false`. New CI success is claimed only when the final source's run and uploaded evidence are verified.

## Bounded scope and command

Reuse the implementation and evidence in [dependency audit](kfood-pr299-dependency-audit-20261008.md), [patch manifest](../../scripts/security-patches/manifest.json), and [patch maintenance](../../scripts/security-patches/README.md). The only eligible advisory roots are:

| Package / pinned version | Advisory | Bounded patch |
| --- | --- | --- |
| `braces@3.0.3` | `GHSA-vfj7-8cjw-p6xm` | Parser-depth rejection before recursive processing of parsed string inputs. It does not certify arbitrary externally constructed ASTs. |
| `node-forge@1.4.0` | `GHSA-86w9-cpqp-85rv` | DigestAlgorithm child-count and empty-NULL validation from the pinned upstream proposal. |

The verifier interface is:

```sh
npm run verify:host-security -- \
  --source-sha "$GITHUB_SHA" \
  --output "$RUNNER_TEMP/host-security-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

`--source-sha` must match the exact current 40-character checkout commit and `GITHUB_SHA`. CI uses Node **20.19.4** from [`.nvmrc`](../../.nvmrc). The working source must be clean. The output must be a new evidence directory outside the repository. Do not reuse stale evidence or substitute a prior commit's successful regressions.

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

The CI evidence reporter tests pass **10/10**. They check raw exit 1 alongside verified patches, empty versus missing stderr, malformed/partial records, exact audit command, source/hash/Node/regression drift, all artifact file hashes, and rejection of a claimed release approval.

The first integration run [37791356956](https://github.com/EVNSolution/clever-routes-app/actions/runs/37791356956) exposed an existing diagnostics-test clock mismatch: fixed October 1 records expired under the real October 8 outbox clock after seven days. The failed assertions left timers active, so the run was cancelled after retaining its logs. The affected test outboxes now use their harness clock; runtime retention and assertions remain unchanged. The always-run evidence step correctly failed on missing audit output and uploaded its three-file failure diagnostic artifact. This cancelled run is not acceptance evidence.

The existing 13 security tests remain unchanged. The verifier requests the TAP reporter explicitly because Node versions have different default reporters. A successful process without the exact complete test summary is insufficient. Scoped lint and TypeScript checks passed. Exact committed-source execution and final CI results are bound to the uploaded evidence and [PR299](https://github.com/EVNSolution/clever-routes-app/pull/299). Prior verifier tests establish implementation coverage; they do not substitute for a successful final-source CI run.

Output files are `audit.stdout.json`, `audit.stderr.log`, `audit-process.json`, `regressions.stdout.log`, `regressions.stderr.log`, and `summary.json`. Collection/verification failures preserve available evidence. A regression is not run after an earlier validation failure. Output directories must be new, and existing evidence files are never overwritten.

## Applied CI evidence contract

The [workflow](../../.github/workflows/ci.yml) runs the mandatory verifier with exact `GITHUB_SHA` and the new outside-repository directory `RUNNER_TEMP/host-security-<runId>-<attempt>`. Install, workspace, lint, build, Expo alignment, and whitespace checks remain mandatory. No `continue-on-error`, audit ignore, threshold reduction, branch-protection change, or release waiver is part of this policy.

An **always-run evidence/summary step** checks the mandatory raw audit files and `summary.json`. When the supplemental result is verified, it also requires complete regression stdout/stderr evidence. It copies the original audit policy and patch manifest into the evidence directory and writes `ci-context.json`. Missing or invalid evidence fails this step, including when the verifier failed earlier. The artifact upload also runs with `if: always()` and `if-no-files-found: error`.

The uploaded record must expose both decisions clearly:

| Evidence | Meaning |
| --- | --- |
| `audit.stdout.json`, `audit.stderr.log`, `audit-process.json` | Untouched scanner output and actual process exit; the known affected report is raw `failed`, exit 1, 20 High. |
| `summary.json` | Exact source/policy/hash/installed-copy/advisory/regression assessment. Supplemental `verified`, exit 0 is distinct from raw audit success; `releaseApproved=false`. |
| `regressions.stdout.log`, `regressions.stderr.log` | Current-source execution evidence for all 13 regressions when verification succeeds. |
| Original audit policy and patch manifest copies | The exact bounded acceptance policy and source patches evaluated by this run. |
| `ci-context.json` | `checkoutSha`, `workflowSha`, CI URL, and artifact name bind the evidence to the actual checkout, workflow, and run. |

The final commit SHA, CI URL, and artifact identifiers are not self-embedded in this document. Read them from the uploaded `ci-context.json` / `summary.json` and the final verification record on [PR299](https://github.com/EVNSolution/clever-routes-app/pull/299). The [workflow run list](https://github.com/EVNSolution/clever-routes-app/actions/workflows/ci.yml) supplies the original run and downloadable artifact. Review must match those identities; a prior run or local pass is insufficient. The private final manifest may record the same verified binding after CI finishes.

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
