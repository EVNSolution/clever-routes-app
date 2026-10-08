import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { before, describe, it, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve('.');
const verifierPath = pathToFileURL(resolve('scripts/verify-host-security.mjs')).href;
const loadVerifier = () => import(verifierPath);
let verifier: Awaited<ReturnType<typeof loadVerifier>>;
before(async () => { verifier = await loadVerifier(); });

type Advisory = { url: string; name: string; dependency: string; severity: string; [key: string]: unknown };
type PackagePolicy = { nodes: string[]; via: string[]; installations: { path: string; version: string; integrity: string }[] };
type Policy = { schemaVersion: number; lockfileSha256: string; patchManifestSha256: string;
  advisories: Record<string, Advisory>; packages: Record<string, PackagePolicy> };
type Vulnerability = { name: string; severity: string; isDirect: boolean; via: (string | Advisory)[];
  effects: string[]; range: string; nodes: string[]; fixAvailable: boolean };
type Report = { auditReportVersion: number; vulnerabilities: Record<string, Vulnerability>;
  metadata: { vulnerabilities: Record<string, number> } };
type Capture = { stdout: string; stderr: string; status: number | null; signal?: string | null; error?: Error };
type Patch = { name: string; file: string; beforeSha256: string; afterSha256: string;
  replacements: { before: string; after: string }[] };
const readPolicy = (): Policy => JSON.parse(readFileSync(resolve(repoRoot, 'scripts/security-patches/audit-policy.json'), 'utf8'));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function reportFor(policy: Policy, names = Object.keys(policy.packages)): Report {
  const vulnerabilities = Object.fromEntries(names.map((name) => [name, {
    name, severity: 'high', isDirect: false, effects: [], range: '*', fixAvailable: false,
    nodes: [...policy.packages[name]!.nodes],
    via: policy.packages[name]!.via.map((via) => policy.advisories[via] ? structuredClone(policy.advisories[via]) : via),
  }]));
  return { auditReportVersion: 2, vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: names.length, critical: 0, total: names.length } } };
}

function capture(report: Report, status = Object.keys(report.vulnerabilities).length > 0 ? 1 : 0): Capture {
  return { stdout: JSON.stringify(report), stderr: '', status, signal: null };
}

function put(root: string, path: string, content: string) {
  const file = resolve(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=Security Test', '-c', 'user.email=security-test@example.invalid', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(resolve(tmpdir(), 'clever-host-verifier-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = resolve(directory, 'repo');
  const outputDir = resolve(directory, 'checks');
  const policy = readPolicy();
  mkdirSync(root);
  for (const path of ['package-lock.json', 'scripts/security-patches/manifest.json',
    'scripts/run-tests.mjs', 'src/release/preflight/hostSecurityPatches.test.ts']) {
    put(root, path, readFileSync(resolve(repoRoot, path), 'utf8'));
  }
  for (const [name, entry] of Object.entries(policy.packages)) {
    for (const installed of entry.installations) put(root, `${installed.path}/package.json`,
      JSON.stringify({ name, version: installed.version }));
  }
  const patches = JSON.parse(readFileSync(resolve(root, 'scripts/security-patches/manifest.json'), 'utf8')).patches as Patch[];
  for (const patch of patches) {
    for (const entry of policy.packages[patch.name]!.installations) {
      put(root, `${entry.path}/${patch.file}`, readFileSync(resolve(repoRoot, entry.path, patch.file), 'utf8'));
    }
  }
  put(root, 'scripts/security-patches/audit-policy.json', JSON.stringify(policy));
  put(root, '.gitignore', 'node_modules/\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Synthetic verification fixture');
  const sha = git(root, 'rev-parse', 'HEAD');
  return { root, outputDir, policy, patches, sha };
}

function nestedCopy(root: string, path = 'node_modules/synthetic/node_modules/braces') {
  cpSync(resolve(root, 'node_modules/braces'), resolve(root, path), { recursive: true });
  return path;
}

function restoreOriginal(root: string, patch: Patch, path = `node_modules/${patch.name}`) {
  const file = resolve(root, path, patch.file);
  let source = readFileSync(file, 'utf8');
  assert.equal(hash(source), patch.afterSha256);
  for (const replacement of [...patch.replacements].reverse()) source = source.replace(replacement.after, replacement.before);
  assert.equal(hash(source), patch.beforeSha256);
  writeFileSync(file, source);
}

const passingTap = 'TAP version 13\n1..13\n# tests 13\n# suites 2\n# pass 13\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const regressionCapture = (stdout = passingTap, status = 0): Capture => ({ stdout, stderr: '', status, signal: null });

describe('host security verification API', () => {
  it('exports the independent audit, installation, source, and collection checks', () => {
    for (const name of ['evaluateAuditReport', 'verifyInstallation', 'verifySource', 'collectAudit', 'runVerification']) {
      assert.equal(typeof verifier[name], 'function');
    }
  });
});

describe('audit graph verification', () => {
  it('accepts the pinned advisory graph, including cycles that reach a known advisory', () => {
    const policy = readPolicy();
    assert.doesNotThrow(() => verifier.evaluateAuditReport(capture(reportFor(policy)), policy));
  });

  it('accepts zero or one remaining root without requiring disappeared findings', () => {
    const policy = readPolicy();
    for (const names of [[], ['braces'], ['node-forge'], ['micromatch', 'braces']]) {
      assert.doesNotThrow(() => verifier.evaluateAuditReport(capture(reportFor(policy, names)), policy));
    }
  });

  it('rejects an unknown advisory even when its severity or URL resembles the allowed finding', () => {
    const policy = readPolicy();
    for (const severity of ['low', 'moderate', 'critical']) {
      const report = reportFor(policy, ['braces']);
      (report.vulnerabilities.braces!.via[0] as Advisory).url += '-unknown';
      (report.vulnerabilities.braces!.via[0] as Advisory).severity = severity;
      assert.throws(() => verifier.evaluateAuditReport(capture(report), policy));
    }
  });

  it('rejects changed advisory fields and an advisory attached to the wrong package', () => {
    const policy = readPolicy();
    const changed = reportFor(policy, ['braces']);
    (changed.vulnerabilities.braces!.via[0] as Advisory).range = '<=999';
    assert.throws(() => verifier.evaluateAuditReport(capture(changed), policy));
    const misplaced = reportFor(policy, ['braces', 'node-forge']);
    misplaced.vulnerabilities.braces!.via = structuredClone(misplaced.vulnerabilities['node-forge']!.via);
    assert.throws(() => verifier.evaluateAuditReport(capture(misplaced), policy));
  });

  it('rejects new package paths and unapproved dependency edges', () => {
    const policy = readPolicy();
    const path = reportFor(policy, ['braces']);
    path.vulnerabilities.braces!.nodes.push('node_modules/unexpected/node_modules/braces');
    assert.throws(() => verifier.evaluateAuditReport(capture(path), policy));
    const edge = reportFor(policy, ['braces', 'node-forge']);
    edge.vulnerabilities.braces!.via.push('node-forge');
    assert.throws(() => verifier.evaluateAuditReport(capture(edge), policy));
    const unknown = reportFor(policy, ['braces']);
    unknown.vulnerabilities.unknown = { ...unknown.vulnerabilities.braces!, name: 'unknown' };
    unknown.metadata.vulnerabilities.high = 2;
    unknown.metadata.vulnerabilities.total = 2;
    assert.throws(() => verifier.evaluateAuditReport(capture(unknown), policy));
  });

  it('rejects dangling edges and cycles with no reachable advisory', () => {
    const policy = readPolicy();
    assert.throws(() => verifier.evaluateAuditReport(capture(reportFor(policy, ['micromatch'])), policy));
    const cycle = reportFor(policy, ['metro', 'metro-config']);
    cycle.vulnerabilities.metro!.via = ['metro-config'];
    assert.throws(() => verifier.evaluateAuditReport(capture(cycle), policy));
  });

  it('rejects forged known-package effects and duplicate effects', () => {
    const policy = readPolicy();
    const forged = reportFor(policy, ['braces', 'node-forge']);
    forged.vulnerabilities.braces!.effects = ['node-forge'];
    assert.throws(() => verifier.evaluateAuditReport(capture(forged), policy));
    const duplicate = reportFor(policy, ['braces', 'micromatch']);
    duplicate.vulnerabilities.braces!.effects = ['micromatch', 'micromatch'];
    assert.throws(() => verifier.evaluateAuditReport(capture(duplicate), policy));
  });

  it('rejects metadata counts that disagree with entries and incorrect audit exit status', () => {
    const policy = readPolicy();
    const report = reportFor(policy, ['braces']);
    report.metadata.vulnerabilities.high = 0;
    assert.throws(() => verifier.evaluateAuditReport(capture(report), policy));
    assert.throws(() => verifier.evaluateAuditReport(capture(reportFor(policy, ['braces']), 0), policy));
    assert.throws(() => verifier.evaluateAuditReport(capture(reportFor(policy, []), 1), policy));
  });

  it('rejects malformed output, unsupported schema, npm error reports, and process failures', () => {
    const policy = readPolicy();
    const unsupported = reportFor(policy);
    unsupported.auditReportVersion = 1;
    for (const value of [
      { stdout: '{not-json', stderr: '', status: 1 },
      { stdout: JSON.stringify({ error: { code: 'EAI_AGAIN' } }), stderr: '', status: 1 },
      { ...capture(reportFor(policy)), error: new Error('spawn failed') },
      { ...capture(reportFor(policy)), status: null, signal: 'SIGTERM' },
      capture(unsupported),
    ]) assert.throws(() => verifier.evaluateAuditReport(value, policy));
  });
});

describe('installed backport verification', () => {
  it('accepts pinned installed copies without mutating the source', (t) => {
    const { root, policy, patches } = fixture(t);
    assert.doesNotThrow(() => verifier.verifyInstallation(root, policy));
    for (const patch of patches) assert.equal(hash(readFileSync(resolve(root, 'node_modules', patch.name, patch.file), 'utf8')), patch.afterSha256);
  });

  it('rejects an unpatched source for either dependency', (t) => {
    for (const name of ['braces', 'node-forge']) {
      const { root, policy, patches } = fixture(t);
      restoreOriginal(root, patches.find((patch) => patch.name === name)!);
      assert.throws(() => verifier.verifyInstallation(root, policy));
    }
  });

  it('rejects changed lockfile, manifest, installed version, or missing copy', (t) => {
    for (const drift of ['lock', 'manifest', 'version', 'missing']) {
      const { root, policy } = fixture(t);
      if (drift === 'lock') put(root, 'package-lock.json', readFileSync(resolve(root, 'package-lock.json'), 'utf8') + '\n');
      if (drift === 'manifest') put(root, 'scripts/security-patches/manifest.json', '{}');
      if (drift === 'version') put(root, 'node_modules/braces/package.json', JSON.stringify({ name: 'braces', version: '99.0.0' }));
      if (drift === 'missing') rmSync(resolve(root, 'node_modules/braces'), { recursive: true });
      assert.throws(() => verifier.verifyInstallation(root, policy));
    }
  });

  it('rejects unknown nested and aliased copies even when their source is already patched', (t) => {
    for (const path of ['node_modules/synthetic/node_modules/braces', 'node_modules/hidden-alias']) {
      const { root, policy } = fixture(t);
      nestedCopy(root, path);
      assert.throws(() => verifier.verifyInstallation(root, policy));
    }
  });

  it('rejects lock integrity drift even if the fixture lock hash is refreshed', (t) => {
    const { root, policy } = fixture(t);
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/braces'].integrity = 'sha512-unreviewed-tarball';
    const bytes = JSON.stringify(lock);
    put(root, 'package-lock.json', bytes);
    policy.lockfileSha256 = hash(bytes);
    assert.throws(() => verifier.verifyInstallation(root, policy), /integrity drift/u);
  });

  it('rejects a partially patched graph when a nested copy is explicitly pinned', (t) => {
    const { root, policy, patches } = fixture(t);
    const path = nestedCopy(root);
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
    lock.packages[path] = { ...lock.packages['node_modules/braces'] };
    const lockBytes = JSON.stringify(lock);
    put(root, 'package-lock.json', lockBytes);
    policy.lockfileSha256 = hash(lockBytes);
    policy.packages.braces!.nodes.push(path);
    policy.packages.braces!.installations.push({ ...policy.packages.braces!.installations[0]!, path });
    assert.doesNotThrow(() => verifier.verifyInstallation(root, policy));
    restoreOriginal(root, patches.find((patch) => patch.name === 'braces')!, path);
    assert.throws(() => verifier.verifyInstallation(root, policy));
  });
});

describe('source identity verification', () => {
  it('accepts exact clean HEAD and rejects a different expected SHA', (t) => {
    const { root, sha } = fixture(t);
    assert.doesNotThrow(() => verifier.verifySource(root, sha));
    assert.throws(() => verifier.verifySource(root, '0'.repeat(40)));
  });

  it('rejects tracked edits and untracked files', (t) => {
    for (const path of ['scripts/run-tests.mjs', 'untracked-source.js']) {
      const { root, sha } = fixture(t);
      put(root, path, '// changed source\n');
      assert.throws(() => verifier.verifySource(root, sha));
    }
  });

  it('rejects changed tracked bytes hidden by assume-unchanged', (t) => {
    const { root, sha } = fixture(t);
    git(root, 'update-index', '--assume-unchanged', 'scripts/run-tests.mjs');
    put(root, 'scripts/run-tests.mjs', '// source drift hidden from status\n');
    assert.equal(git(root, 'status', '--porcelain'), '');
    assert.throws(() => verifier.verifySource(root, sha));
  });
});

describe('raw audit collection and end-to-end verification', () => {
  it('stores malformed stdout, stderr, and actual process status before parsing', (t) => {
    const { root, outputDir } = fixture(t);
    mkdirSync(outputDir);
    const actual = { stdout: '{malformed\n', stderr: 'registry unavailable\n', status: 7, signal: null };
    const collected = verifier.collectAudit(root, outputDir, (command: string, args: string[]) => {
      assert.match(command, /^npm(?:\.cmd)?$/u);
      assert.deepEqual(args, ['audit', '--audit-level=moderate', '--json']);
      return actual;
    });
    assert.equal(collected.stdout, actual.stdout);
    assert.equal(collected.status, 7);
    assert.equal(readFileSync(resolve(outputDir, 'audit.stdout.json'), 'utf8'), actual.stdout);
    assert.equal(readFileSync(resolve(outputDir, 'audit.stderr.log'), 'utf8'), actual.stderr);
    assert.match(readFileSync(resolve(outputDir, 'audit-process.json'), 'utf8'), /7/u);
    assert.throws(() => verifier.collectAudit(root, outputDir, () => ({ ...actual, stdout: 'replacement' })));
    assert.equal(readFileSync(resolve(outputDir, 'audit.stdout.json'), 'utf8'), actual.stdout);
  });

  it('preserves a collection spawn error and does not convert it to audit success', (t) => {
    const { root, outputDir, policy } = fixture(t);
    mkdirSync(outputDir);
    const collected = verifier.collectAudit(root, outputDir, () => ({ stdout: '', stderr: '', status: null, error: new Error('synthetic ENOENT') }));
    assert.match(readFileSync(resolve(outputDir, 'audit-process.json'), 'utf8'), /synthetic ENOENT/u);
    assert.throws(() => verifier.evaluateAuditReport(collected, policy));
  });

  it('executes the fixed regression command and preserves a failed raw audit without release approval', (t) => {
    const { root, outputDir, policy, sha } = fixture(t);
    let regressions = 0;
    const result = verifier.runVerification({ root, outputDir, expectedSourceSha: sha,
      runner: (command: string, args: string[]) => {
        if (args[0] === 'audit') return capture(reportFor(policy));
        assert.equal(command, process.execPath);
        assert.deepEqual(args, ['--import', 'tsx', '--test', '--test-reporter=tap', 'src/release/preflight/hostSecurityPatches.test.ts']);
        regressions += 1;
        return regressionCapture();
      } });
    assert.equal(regressions, 1);
    assert.equal(result.status, 'verified');
    assert.equal(result.rawAudit.status, 'failed');
    assert.equal(result.rawAudit.exitCode, 1);
    assert.equal(result.releaseApproved, false);
  });

  it('requires passing regression output even when npm audit reports zero findings', (t) => {
    for (const regression of [regressionCapture(passingTap, 1),
      regressionCapture(passingTap.replace('# pass 13', '# pass 12').replace('# skipped 0', '# skipped 1')),
      regressionCapture('All tests passed\n')]) {
      const { root, outputDir, policy, sha } = fixture(t);
      assert.throws(() => verifier.runVerification({ root, outputDir, expectedSourceSha: sha,
        runner: (_command: string, args: string[]) => args[0] === 'audit' ? capture(reportFor(policy, [])) : regression }));
      const summary = JSON.parse(readFileSync(resolve(outputDir, 'summary.json'), 'utf8'));
      assert.equal(summary.status, 'failed');
      assert.equal(summary.releaseApproved, false);
      assert.equal(summary.regressions.exitCode, regression.status);
      assert.notEqual(summary.backports.status, 'verified');
    }
  });

  it('rechecks source and installed bytes after executing regressions', (t) => {
    for (const drift of ['source', 'installed']) {
      const { root, outputDir, policy, patches, sha } = fixture(t);
      assert.throws(() => verifier.runVerification({ root, outputDir, expectedSourceSha: sha,
        runner: (_command: string, args: string[]) => {
          if (args[0] === 'audit') return capture(reportFor(policy));
          if (drift === 'source') put(root, 'scripts/run-tests.mjs', '// changed during regression execution\n');
          else restoreOriginal(root, patches[0]!);
          return regressionCapture();
        } }));
    }
  });
});
