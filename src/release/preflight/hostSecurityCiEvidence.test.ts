import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { before, describe, it, type TestContext } from 'node:test';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const loadReporter = () => import(pathToFileURL(resolve('scripts/report-host-security.mjs')).href);
const loadVerifier = () => import(pathToFileURL(resolve('scripts/verify-host-security.mjs')).href);
let reporter: Awaited<ReturnType<typeof loadReporter>>;
let verifier: Awaited<ReturnType<typeof loadVerifier>>;
before(async () => { reporter = await loadReporter(); verifier = await loadVerifier(); });

type Advisory = { url: string; name: string; dependency: string; severity: string; [key: string]: unknown };
type Policy = { schemaVersion: number; lockfileSha256: string; patchManifestSha256: string;
  advisories: Record<string, Advisory>; packages: Record<string, { nodes: string[]; via: string[] }> };
type Patch = { name: string; version: string; afterSha256: string };
const repoRoot = resolve('.');
const sha = 'a'.repeat(40);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const tap = 'TAP version 13\n1..13\n# tests 13\n# suites 2\n# pass 13\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';

function put(root: string, path: string, content: string) {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(resolve(tmpdir(), 'clever-ci-security-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = resolve(directory, 'repo');
  const evidenceDir = resolve(directory, 'evidence');
  const stepSummaryPath = resolve(directory, 'step-summary.md');
  const policyBytes = readFileSync(resolve(repoRoot, 'scripts/security-patches/audit-policy.json'), 'utf8');
  const patchBytes = readFileSync(resolve(repoRoot, 'scripts/security-patches/manifest.json'), 'utf8');
  const policy = JSON.parse(policyBytes) as Policy;
  const patches = JSON.parse(patchBytes).patches as Patch[];
  put(root, 'scripts/security-patches/audit-policy.json', policyBytes);
  put(root, 'scripts/security-patches/manifest.json', patchBytes);
  put(root, 'package-lock.json', readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'));
  const vulnerabilities = Object.fromEntries(Object.entries(policy.packages).map(([name, entry]) => [name, {
    name, severity: 'high', isDirect: false, effects: [], range: '*', fixAvailable: false, nodes: entry.nodes,
    via: entry.via.map((via) => policy.advisories[via] ?? via),
  }]));
  const count = Object.keys(vulnerabilities).length;
  const rawReport = { auditReportVersion: 2, vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: count, critical: 0, total: count } } };
  const auditProcess = { command: 'npm audit --audit-level=moderate --json', exitCode: 1, signal: null, error: null };
  const summary = {
    status: 'verified', releaseApproved: false, source: { sha, fileCount: 2, contentSha256: 'b'.repeat(64) },
    policySha256: sha256(policyBytes),
    rawAudit: verifier.evaluateAuditReport({ stdout: JSON.stringify(rawReport), stderr: '', status: 1 }, policy),
    backports: { status: 'verified', lockfileSha256: policy.lockfileSha256, patchManifestSha256: policy.patchManifestSha256,
      copies: patches.flatMap((patch) => policy.packages[patch.name]!.nodes.map((path) => ({
        name: patch.name, version: patch.version, path, sourceSha256: patch.afterSha256,
      }))) },
    regressions: { command: [process.execPath, '--import', 'tsx', '--test', '--test-reporter=tap', 'src/release/preflight/hostSecurityPatches.test.ts'],
      nodeVersion: process.version, exitCode: 0, signal: null, error: null as string | null, stdoutSha256: sha256(tap) },
  };
  put(evidenceDir, 'audit.stdout.json', JSON.stringify(rawReport));
  put(evidenceDir, 'audit.stderr.log', '');
  put(evidenceDir, 'audit-process.json', JSON.stringify(auditProcess));
  put(evidenceDir, 'summary.json', JSON.stringify(summary));
  put(evidenceDir, 'regressions.stdout.log', tap);
  put(evidenceDir, 'regressions.stderr.log', '');
  const options = { root, evidenceDir, checkoutSha: sha, workflowSha: sha,
    runUrl: 'https://github.com/EVNSolution/clever-routes-app/actions/runs/12345',
    artifactName: 'host-security-evidence-synthetic', stepSummaryPath };
  return { ...options, options, summary, rawReport, auditProcess, policyBytes, patchBytes };
}

function assertFailureRecorded(value: ReturnType<typeof fixture>) {
  assert.ok(existsSync(resolve(value.evidenceDir, 'ci-context.json')));
  const context = JSON.parse(readFileSync(resolve(value.evidenceDir, 'ci-context.json'), 'utf8'));
  assert.equal(context.evidenceStatus, 'failed');
  assert.equal(context.checkoutSha, value.options.checkoutSha);
  assert.ok(readFileSync(value.stepSummaryPath, 'utf8').length > 0);
}

describe('host security CI evidence', () => {
  it('exports the evidence reporter', () => {
    assert.equal(typeof reporter.writeHostSecurityEvidence, 'function');
  });

  it('retains raw audit exit 1 with verified backports and no release approval', (t) => {
    const value = fixture(t);
    writeFileSync(value.stepSummaryPath, 'Existing workflow summary\n');
    const context = reporter.writeHostSecurityEvidence(value.options);
    assert.equal(context.evidenceStatus, 'verified');
    assert.equal(context.checkoutSha, sha);
    assert.equal(context.workflowSha, sha);
    assert.equal(context.runUrl, value.runUrl);
    assert.equal(context.artifactName, value.artifactName);
    assert.equal(context.nodeVersion, process.version);
    assert.equal(context.rawAuditExitCode, 1);
    assert.equal(context.rawAuditStatus, 'failed');
    assert.equal(context.supplementalStatus, 'verified');
    assert.equal(context.releaseApproved, false);
    assert.equal(readFileSync(resolve(value.evidenceDir, 'audit-policy.json'), 'utf8'), value.policyBytes);
    assert.equal(readFileSync(resolve(value.evidenceDir, 'patch-manifest.json'), 'utf8'), value.patchBytes);
    assert.deepEqual(context.files.map((file: { path: string }) => file.path).sort(), [
      'audit-process.json', 'audit-policy.json', 'audit.stderr.log', 'audit.stdout.json',
      'patch-manifest.json', 'regressions.stderr.log', 'regressions.stdout.log', 'summary.json',
    ].sort());
    for (const file of context.files) {
      const bytes = readFileSync(resolve(value.evidenceDir, file.path));
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(file.bytes, bytes.length);
    }
    const preserved = JSON.parse(readFileSync(resolve(value.evidenceDir, 'summary.json'), 'utf8'));
    assert.equal(preserved.rawAudit.exitCode, 1);
    assert.equal(preserved.rawAudit.status, 'failed');
    assert.equal(preserved.releaseApproved, false);
    const rendered = readFileSync(value.stepSummaryPath, 'utf8');
    assert.ok(rendered.startsWith('Existing workflow summary\n'));
    assert.match(rendered, /raw.*audit/iu);
    assert.match(rendered, /failed/iu);
    assert.match(rendered, /verified/iu);
    assert.match(JSON.stringify(context), new RegExp(sha256(value.policyBytes), 'u'));
    assert.match(JSON.stringify(context), new RegExp(sha256(value.patchBytes), 'u'));
  });

  it('accepts existing empty stderr logs and rejects every missing mandatory evidence file', (t) => {
    const valid = fixture(t);
    assert.equal(readFileSync(resolve(valid.evidenceDir, 'audit.stderr.log'), 'utf8'), '');
    assert.equal(readFileSync(resolve(valid.evidenceDir, 'regressions.stderr.log'), 'utf8'), '');
    assert.doesNotThrow(() => reporter.writeHostSecurityEvidence(valid.options));
    for (const name of ['audit.stdout.json', 'audit.stderr.log', 'audit-process.json', 'summary.json',
      'regressions.stdout.log', 'regressions.stderr.log']) {
      const value = fixture(t);
      rmSync(resolve(value.evidenceDir, name));
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });

  it('records CI context and a step summary when summary JSON is malformed', (t) => {
    const value = fixture(t);
    put(value.evidenceDir, 'summary.json', '{invalid summary');
    assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
    assertFailureRecorded(value);
    assert.equal(readFileSync(resolve(value.evidenceDir, 'summary.json'), 'utf8'), '{invalid summary');
  });

  it('preserves failed verifier diagnostics when regression logs are incomplete', (t) => {
    const value = fixture(t);
    const failed = { status: 'failed', releaseApproved: false, rawAudit: { status: 'not-validated', exitCode: 1 },
      backports: { status: 'not-verified' }, error: 'Synthetic audit collection failure' };
    put(value.evidenceDir, 'summary.json', JSON.stringify(failed));
    put(value.evidenceDir, 'audit.stderr.log', 'Synthetic registry diagnostic\n');
    rmSync(resolve(value.evidenceDir, 'regressions.stdout.log'));
    rmSync(resolve(value.evidenceDir, 'regressions.stderr.log'));
    assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
    assertFailureRecorded(value);
    assert.deepEqual(JSON.parse(readFileSync(resolve(value.evidenceDir, 'summary.json'), 'utf8')), failed);
    assert.equal(readFileSync(resolve(value.evidenceDir, 'audit.stderr.log'), 'utf8'), 'Synthetic registry diagnostic\n');
  });

  it('rejects checkout, workflow, or verifier source SHA drift', (t) => {
    for (const drift of ['checkout', 'workflow', 'summary']) {
      const value = fixture(t);
      if (drift === 'checkout') value.options.checkoutSha = 'c'.repeat(40);
      if (drift === 'workflow') value.options.workflowSha = 'c'.repeat(40);
      if (drift === 'summary') {
        value.summary.source.sha = 'c'.repeat(40);
        put(value.evidenceDir, 'summary.json', JSON.stringify(value.summary));
      }
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });

  it('rejects raw audit and process metadata that contradict the verifier summary', (t) => {
    for (const drift of ['report', 'summary', 'exit', 'error', 'signal', 'command']) {
      const value = fixture(t);
      if (drift === 'report') {
        value.rawReport.metadata.vulnerabilities.high -= 1;
        put(value.evidenceDir, 'audit.stdout.json', JSON.stringify(value.rawReport));
      } else if (drift === 'summary') {
        value.summary.rawAudit.status = 'passed';
        put(value.evidenceDir, 'summary.json', JSON.stringify(value.summary));
      } else {
        const changed = { ...value.auditProcess, ...(drift === 'exit' ? { exitCode: 0 } : {}),
          ...(drift === 'error' ? { error: 'spawn failure' } : {}), ...(drift === 'signal' ? { signal: 'SIGTERM' } : {}),
          ...(drift === 'command' ? { command: 'npm audit --audit-level=critical' } : {}) };
        put(value.evidenceDir, 'audit-process.json', JSON.stringify(changed));
      }
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });

  it('rejects policy, manifest, or recorded installed-source hash drift', (t) => {
    for (const drift of ['policy', 'manifest', 'summary-policy', 'summary-manifest', 'copy']) {
      const value = fixture(t);
      if (drift === 'policy') put(value.root, 'scripts/security-patches/audit-policy.json', value.policyBytes + '\n');
      if (drift === 'manifest') put(value.root, 'scripts/security-patches/manifest.json', value.patchBytes + '\n');
      if (drift === 'summary-policy') value.summary.policySha256 = '0'.repeat(64);
      if (drift === 'summary-manifest') value.summary.backports.patchManifestSha256 = '0'.repeat(64);
      if (drift === 'copy') value.summary.backports.copies[0]!.sourceSha256 = '0'.repeat(64);
      put(value.evidenceDir, 'summary.json', JSON.stringify(value.summary));
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });

  it('rejects incomplete, failed, changed, or mismatched-runtime regression evidence', (t) => {
    for (const drift of ['exit', 'error', 'node', 'hash', 'command', 'missing-command', 'skip', 'fail', 'missing-summary']) {
      const value = fixture(t);
      if (drift === 'exit') value.summary.regressions.exitCode = 1;
      if (drift === 'error') value.summary.regressions.error = 'Synthetic regression spawn failure';
      if (drift === 'node') value.summary.regressions.nodeVersion = 'v0.0.0';
      if (drift === 'hash') value.summary.regressions.stdoutSha256 = '0'.repeat(64);
      if (drift === 'command') value.summary.regressions.command = [process.execPath, '--test', 'another.test.ts'];
      if (drift === 'missing-command') Reflect.deleteProperty(value.summary.regressions, 'command');
      if (['skip', 'fail', 'missing-summary'].includes(drift)) {
        const changed = drift === 'skip' ? tap.replace('# skipped 0', '# skipped 1')
          : drift === 'fail' ? tap.replace('# fail 0', '# fail 1') : 'Tests passed\n';
        put(value.evidenceDir, 'regressions.stdout.log', changed);
        value.summary.regressions.stdoutSha256 = sha256(changed);
      }
      put(value.evidenceDir, 'summary.json', JSON.stringify(value.summary));
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });

  it('rejects a claimed release approval or unverified backports', (t) => {
    for (const drift of ['release', 'backports', 'status']) {
      const value = fixture(t);
      const changed = { ...value.summary, ...(drift === 'release' ? { releaseApproved: true } : {}),
        ...(drift === 'status' ? { status: 'failed' } : {}),
        ...(drift === 'backports' ? { backports: { ...value.summary.backports, status: 'not-verified' } } : {}) };
      put(value.evidenceDir, 'summary.json', JSON.stringify(changed));
      assert.throws(() => reporter.writeHostSecurityEvidence(value.options));
      assertFailureRecorded(value);
    }
  });
});
