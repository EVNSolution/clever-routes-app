import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { evaluateAuditReport } from './verify-host-security.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireEvidence = (condition, message) => { if (!condition) throw new Error(message); };
const evidenceFiles = ['audit.stdout.json', 'audit.stderr.log', 'audit-process.json', 'summary.json',
  'regressions.stdout.log', 'regressions.stderr.log', 'audit-policy.json', 'patch-manifest.json'];

// This always-run step retains diagnostics, but missing/failed evidence stays red.
export function writeHostSecurityEvidence({ root, evidenceDir, checkoutSha, workflowSha, runUrl, artifactName, stepSummaryPath }) {
  mkdirSync(evidenceDir, { recursive: true });
  const context = { checkoutSha, workflowSha, runUrl, artifactName, nodeVersion: process.version,
    rawAuditExitCode: null, rawAuditStatus: 'unverified', supplementalStatus: 'unverified',
    releaseApproved: false, evidenceStatus: 'failed', errors: [], files: [] };
  const read = (name) => {
    const path = join(evidenceDir, name);
    requireEvidence(existsSync(path) && lstatSync(path).isFile(), `Missing evidence file: ${name}`);
    return readFileSync(path);
  };
  try {
    const policyBytes = readFileSync(join(root, 'scripts/security-patches/audit-policy.json'));
    const patchBytes = readFileSync(join(root, 'scripts/security-patches/manifest.json'));
    writeFileSync(join(evidenceDir, 'audit-policy.json'), policyBytes, { flag: 'wx' });
    writeFileSync(join(evidenceDir, 'patch-manifest.json'), patchBytes, { flag: 'wx' });
    const policy = JSON.parse(policyBytes);
    const patches = JSON.parse(patchBytes).patches;
    const auditBytes = read('audit.stdout.json');
    read('audit.stderr.log'); // An empty stderr is valid; an absent file is not.
    const auditProcess = JSON.parse(read('audit-process.json'));
    context.rawAuditExitCode = auditProcess.exitCode;
    requireEvidence(auditProcess.command === 'npm audit --audit-level=moderate --json', 'Audit command drift');
    const report = JSON.parse(read('summary.json'));
    context.supplementalStatus = report.status === 'verified' ? 'verified' : 'failed';
    const raw = evaluateAuditReport({ stdout: auditBytes, status: auditProcess.exitCode,
      error: auditProcess.error, signal: auditProcess.signal }, policy);
    context.rawAuditStatus = raw.status;
    requireEvidence(isDeepStrictEqual(raw, report.rawAudit), 'Raw audit evidence differs from the verifier result');
    requireEvidence(/^[a-f0-9]{40}$/.test(checkoutSha) && checkoutSha === workflowSha
      && report.source?.sha === checkoutSha, 'Evidence source SHA does not match the workflow checkout');
    requireEvidence(report.status === 'verified' && report.backports?.status === 'verified'
      && report.releaseApproved === false, 'Supplemental verification failed or release approval is invalid');
    requireEvidence(report.policySha256 === sha256(policyBytes) && policy.patchManifestSha256 === sha256(patchBytes)
      && report.backports.patchManifestSha256 === sha256(patchBytes), 'Policy or patch evidence hash drift');
    const lockHash = sha256(readFileSync(join(root, 'package-lock.json')));
    requireEvidence(policy.lockfileSha256 === lockHash && report.backports.lockfileSha256 === lockHash, 'Lock evidence hash drift');
    const expectedCopies = patches.flatMap((patch) => policy.packages[patch.name].nodes.map((path) =>
      ({ name: patch.name, version: patch.version, path, sourceSha256: patch.afterSha256 })));
    const byPath = (a, b) => a.path.localeCompare(b.path);
    requireEvidence(Array.isArray(report.backports.copies)
      && isDeepStrictEqual([...report.backports.copies].sort(byPath), expectedCopies.sort(byPath)), 'Patched copy evidence mismatch');
    const regressionBytes = read('regressions.stdout.log');
    read('regressions.stderr.log');
    requireEvidence(isDeepStrictEqual(report.regressions?.command, [process.execPath, '--import', 'tsx',
      '--test', '--test-reporter=tap', 'src/release/preflight/hostSecurityPatches.test.ts']), 'Regression command drift');
    requireEvidence(report.regressions?.exitCode === 0 && !report.regressions.error && !report.regressions.signal
      && report.regressions.nodeVersion === process.version && report.regressions.stdoutSha256 === sha256(regressionBytes),
    'Regression process, Node version or log hash mismatch');
    for (const [field, expected] of Object.entries({ tests: 13, pass: 13, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
      const matches = [...regressionBytes.toString('utf8').matchAll(new RegExp(`^# ${field} (\\d+)\\r?$`, 'gm'))];
      requireEvidence(matches.length === 1 && Number(matches[0][1]) === expected, `Incomplete regression evidence: ${field}`);
    }
    context.evidenceStatus = 'verified';
  } catch (error) {
    context.errors.push(error instanceof SyntaxError ? 'Invalid evidence JSON' : error.message);
  }
  for (const name of evidenceFiles) {
    const path = join(evidenceDir, name);
    if (existsSync(path) && lstatSync(path).isFile()) {
      const bytes = readFileSync(path);
      context.files.push({ path: name, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  writeFileSync(join(evidenceDir, 'ci-context.json'), JSON.stringify(context, null, 2) + '\n', { flag: 'wx' });
  const summaryText = (value) => String(value).replace(/[^a-zA-Z0-9_.: /-]/g, '?');
  appendFileSync(stepSummaryPath, [
    '### Host security evidence', '', '| Check | Result |', '| --- | --- |',
    `| Checkout SHA | \`${summaryText(checkoutSha)}\` |`,
    `| Raw npm audit | ${context.rawAuditStatus}; exit ${summaryText(context.rawAuditExitCode ?? 'unavailable')} |`,
    `| Supplemental verification | ${context.supplementalStatus} |`,
    `| Evidence integrity | ${context.evidenceStatus} |`,
    `| Node | ${process.version} |`, '| Release approved | **false** |', '',
    'Raw audit failure is retained. Bounded backport acceptance is not deployment approval.',
    `Workflow run: ${summaryText(runUrl)} · Artifact: \`${summaryText(artifactName)}\``, '',
  ].join('\n'));
  requireEvidence(context.evidenceStatus === 'verified', `Host-security evidence failed: ${context.errors.join('; ')}`);
  return context;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const checkout = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    requireEvidence(checkout.status === 0 && process.argv.length === 3 && process.env.GITHUB_STEP_SUMMARY
      && process.env.GITHUB_SHA && process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
      && process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY, 'Missing CI evidence context');
    const context = writeHostSecurityEvidence({ root, evidenceDir: resolve(process.argv[2]),
      checkoutSha: checkout.stdout.trim(), workflowSha: process.env.GITHUB_SHA,
      runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      artifactName: `host-security-${process.env.GITHUB_SHA}-${process.env.GITHUB_RUN_ATTEMPT}`,
      stepSummaryPath: process.env.GITHUB_STEP_SUMMARY });
    console.log(JSON.stringify(context, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
