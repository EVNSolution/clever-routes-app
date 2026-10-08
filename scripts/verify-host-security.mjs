import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const advisoryUrls = ['https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  'https://github.com/advisories/GHSA-86w9-cpqp-85rv'];
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const requireEvidence = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === new Set(a).size && isDeepStrictEqual([...a].sort(), [...b].sort());

// A raw npm failure remains a failure. This classifies only the reviewed graph.
export function evaluateAuditReport(capture, policy) {
  requireEvidence(!capture.error && !capture.signal && [0, 1].includes(capture.status), 'Audit collection failed');
  let report;
  try { report = JSON.parse(capture.stdout); } catch { throw new Error('Invalid audit JSON'); }
  requireEvidence(object(report) && !report.error && report.auditReportVersion === 2
    && object(report.vulnerabilities) && object(report.metadata?.vulnerabilities), 'Invalid audit schema or collection error');
  requireEvidence(policy.schemaVersion === 1 && sameSet(Object.keys(policy.advisories), advisoryUrls), 'Invalid advisory policy');
  const entries = Object.entries(report.vulnerabilities);
  const counts = Object.fromEntries(severities.map((level) => [level, 0]));
  const roots = new Map();
  const dependencies = new Map();
  for (const [name, item] of entries) {
    const allowed = policy.packages[name];
    requireEvidence(object(item) && allowed && item.name === name && severities.includes(item.severity)
      && Array.isArray(item.via) && item.via.length > 0 && Array.isArray(item.effects), `Unreviewed or invalid audit package: ${name}`);
    requireEvidence(sameSet(item.nodes, allowed.nodes), `Unreviewed audit path: ${name}`);
    requireEvidence(new Set(item.effects).size === item.effects.length && item.effects.every((effect) =>
      typeof effect === 'string' && Object.hasOwn(policy.packages, effect)
      && policy.packages[effect].via.includes(name)
      && Array.isArray(report.vulnerabilities[effect]?.via)
      && report.vulnerabilities[effect].via.includes(name)), `Unreviewed audit effect: ${name}`);
    counts[item.severity] += 1;
    const direct = new Set();
    const via = [];
    const seen = new Set();
    for (const source of item.via) {
      const identity = typeof source === 'string' ? source : source?.url;
      requireEvidence(typeof identity === 'string' && allowed.via.includes(identity) && !seen.has(identity), `Unreviewed audit advisory or dependency: ${name}`);
      seen.add(identity);
      if (typeof source === 'string') {
        requireEvidence(Object.hasOwn(report.vulnerabilities, source), `Missing audit dependency: ${source}`);
        via.push(source);
      } else {
        requireEvidence(object(source) && source.name === name && source.dependency === name
          && Object.hasOwn(policy.advisories, identity) && isDeepStrictEqual(source, policy.advisories[identity]), `Unreviewed advisory details: ${name}`);
        direct.add(identity);
      }
    }
    roots.set(name, direct);
    dependencies.set(name, via);
  }
  // npm's aggregate graph contains cycles. Propagate roots to a fixed point,
  // then reject any disconnected cycle rather than trusting package names.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, via] of dependencies) {
      for (const dependency of via) {
        for (const advisory of roots.get(dependency)) {
          if (!roots.get(name).has(advisory)) { roots.get(name).add(advisory); changed = true; }
        }
      }
    }
  }
  for (const [name, item] of entries) {
    requireEvidence(roots.get(name).size > 0, `Audit dependency has no reviewed advisory root: ${name}`);
    const severity = Math.max(...[...roots.get(name)].map((url) => severities.indexOf(policy.advisories[url].severity)));
    requireEvidence(severities.indexOf(item.severity) === severity, `Audit severity drift: ${name}`);
  }
  const metadata = report.metadata.vulnerabilities;
  for (const level of severities) requireEvidence(metadata[level] === counts[level], `Invalid audit count: ${level}`);
  requireEvidence(metadata.total === entries.length, 'Invalid audit total');
  const failed = counts.moderate + counts.high + counts.critical > 0;
  requireEvidence(capture.status === (failed ? 1 : 0), 'Audit exit code contradicts reported findings');
  return { status: failed ? 'failed' : 'passed', exitCode: capture.status, counts: { ...counts, total: entries.length },
    reportedAdvisories: [...new Set([...roots.values()].flatMap((set) => [...set]))].sort(),
    paths: entries.flatMap(([name, item]) => item.nodes.map((path) => ({ name, path, advisoryUrls: [...roots.get(name)].sort() }))) };
}

function installedFile(root, path) {
  const full = resolve(root, path);
  requireEvidence(full.startsWith(`${root}${sep}node_modules${sep}`)
    && realpathSync(full) === full, `Installed path or symlink drift: ${path}`);
  return full;
}

export function verifyInstallation(directory, policy) {
  const root = realpathSync(directory);
  const lockBytes = readFileSync(join(root, 'package-lock.json'));
  const patchBytes = readFileSync(join(root, 'scripts/security-patches/manifest.json'));
  requireEvidence(sha256(lockBytes) === policy.lockfileSha256, 'Lockfile hash drift');
  requireEvidence(sha256(patchBytes) === policy.patchManifestSha256, 'Patch manifest hash drift');
  const lock = JSON.parse(lockBytes);
  const manifest = JSON.parse(patchBytes);
  requireEvidence(manifest.schemaVersion === 1 && sameSet(manifest.patches.map((p) => p.name), ['braces', 'node-forge']), 'Invalid patch manifest');
  for (const [name, item] of Object.entries(policy.packages)) {
    requireEvidence(sameSet(item.nodes, item.installations.map((entry) => entry.path)), `Invalid installation policy: ${name}`);
    for (const expected of item.installations) {
      const locked = lock.packages[expected.path];
      const metadata = json(installedFile(root, `${expected.path}/package.json`));
      requireEvidence(locked?.version === expected.version && locked?.integrity === expected.integrity
        && metadata.name === name && metadata.version === expected.version, `Installed version or integrity drift: ${expected.path}`);
    }
  }
  const targetNames = new Set(manifest.patches.map((patch) => patch.name));
  const discovered = [];
  function visitModules(modules) {
    if (!existsSync(modules)) return;
    requireEvidence(realpathSync(modules) === modules, 'Unexpected node_modules symlink');
    function visitPackage(path) {
      requireEvidence(lstatSync(path).isDirectory() && realpathSync(path) === path, `Unexpected installed package path: ${relative(root, path)}`);
      const metadataPath = join(path, 'package.json');
      const pathName = relative(modules, path).split(sep).join('/');
      const metadata = existsSync(metadataPath) ? json(metadataPath) : null;
      if (targetNames.has(metadata?.name) || targetNames.has(pathName)) discovered.push(relative(root, path).split(sep).join('/'));
      visitModules(join(path, 'node_modules'));
    }
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith('.')) continue;
      const path = join(modules, entry);
      if (entry.startsWith('@')) {
        requireEvidence(lstatSync(path).isDirectory() && realpathSync(path) === path, 'Unexpected installed scope path');
        for (const child of readdirSync(path)) visitPackage(join(path, child));
      } else visitPackage(path);
    }
  }
  visitModules(join(root, 'node_modules'));
  const expectedPaths = manifest.patches.flatMap((patch) => policy.packages[patch.name].nodes);
  requireEvidence(sameSet(discovered, expectedPaths), 'Unreviewed or missing installed patch copy');
  const copies = [];
  for (const patch of manifest.patches) {
    const lockedPaths = Object.keys(lock.packages).filter((path) => path === `node_modules/${patch.name}` || path.endsWith(`/node_modules/${patch.name}`));
    requireEvidence(sameSet(lockedPaths, policy.packages[patch.name].nodes), `Locked copy path drift: ${patch.name}`);
    for (const path of lockedPaths) {
      requireEvidence(lock.packages[path].version === patch.version && lock.packages[path].integrity === patch.tarballIntegrity, `Patch version or integrity drift: ${path}`);
      const digest = sha256(readFileSync(installedFile(root, `${path}/${patch.file}`)));
      requireEvidence(digest === patch.afterSha256, `Unpatched source or hash drift: ${path}`);
      copies.push({ name: patch.name, version: patch.version, path, sourceSha256: digest });
    }
  }
  return { status: 'verified', lockfileSha256: sha256(lockBytes), patchManifestSha256: sha256(patchBytes), copies };
}

export function verifySource(directory, expectedSha) {
  const root = realpathSync(directory);
  requireEvidence(/^[a-f0-9]{40}$/.test(expectedSha), 'Expected exact source SHA is required');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    requireEvidence(!result.error && result.status === 0, 'Source Git inspection failed');
    return result.stdout;
  };
  requireEvidence(realpathSync(git('rev-parse', '--show-toplevel').trim()) === root, 'Source must be the repository root');
  requireEvidence(git('rev-parse', 'HEAD').trim() === expectedSha, 'Source SHA mismatch');
  requireEvidence(git('status', '--porcelain', '--untracked-files=all').trim() === '', 'Source tree is dirty');
  const digests = [];
  // Read committed blobs directly: assume-unchanged/skip-worktree must not hide drift.
  for (const entry of git('ls-tree', '-r', '-z', '--full-tree', 'HEAD').split('\0').filter(Boolean)) {
    const split = entry.indexOf('\t');
    const [mode, type, expectedBlob] = entry.slice(0, split).split(' ');
    const path = entry.slice(split + 1);
    requireEvidence(type === 'blob', 'Unsupported source submodule');
    const full = resolve(root, path);
    requireEvidence(full.startsWith(`${root}${sep}`), 'Source path escapes repository');
    const bytes = mode === '120000' ? Buffer.from(readlinkSync(full)) : readFileSync(full);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireEvidence(blob === expectedBlob, `Source content drift: ${path}`);
    digests.push(`${path}\0${sha256(bytes)}`);
  }
  return { sha: expectedSha, fileCount: digests.length, contentSha256: sha256(digests.join('\n')) };
}

function execute(runner, command, args, options) {
  try { return runner(command, args, options); } catch (error) { return { status: null, stdout: '', stderr: '', error }; }
}

export function collectAudit(root, outputDir, runner = spawnSync) {
  const capture = execute(runner, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--audit-level=moderate', '--json'],
    { cwd: root, encoding: null, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(outputDir, 'audit.stdout.json'), capture.stdout ?? '', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outputDir, 'audit.stderr.log'), capture.stderr ?? '', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(outputDir, 'audit-process.json'), JSON.stringify({ command: 'npm audit --audit-level=moderate --json',
    exitCode: capture.status ?? null, signal: capture.signal ?? null, error: capture.error ? String(capture.error.message ?? capture.error) : null }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return capture;
}

export function runVerification({ root: directory, expectedSourceSha, outputDir: output, runner = spawnSync }) {
  const root = realpathSync(directory);
  const outputDir = resolve(output);
  requireEvidence(!existsSync(outputDir), 'Evidence output must be a new directory');
  const parent = realpathSync(dirname(outputDir));
  requireEvidence(parent !== root && !parent.startsWith(`${root}${sep}`), 'Evidence must be outside the repository');
  mkdirSync(outputDir, { mode: 0o700 });
  const result = { status: 'failed', releaseApproved: false, rawAudit: { status: 'not-collected' }, backports: { status: 'not-verified' } };
  try {
    const capture = collectAudit(root, outputDir, runner);
    result.rawAudit = { status: 'not-validated', exitCode: capture.status ?? null };
    result.source = verifySource(root, expectedSourceSha);
    const policy = json(join(root, 'scripts/security-patches/audit-policy.json'));
    result.policySha256 = sha256(readFileSync(join(root, 'scripts/security-patches/audit-policy.json')));
    result.rawAudit = evaluateAuditReport(capture, policy);
    const installation = verifyInstallation(root, policy);
    result.backports = { ...installation, status: 'not-verified' };
    // Choose TAP explicitly; Node versions differ in their default reporter.
    const regressionArgs = ['--import', 'tsx', '--test', '--test-reporter=tap', 'src/release/preflight/hostSecurityPatches.test.ts'];
    const regression = execute(runner, process.execPath, regressionArgs,
      { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(join(outputDir, 'regressions.stdout.log'), regression.stdout ?? '', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(outputDir, 'regressions.stderr.log'), regression.stderr ?? '', { flag: 'wx', mode: 0o600 });
    result.regressions = { command: [process.execPath, ...regressionArgs], nodeVersion: process.version,
      exitCode: regression.status ?? null, signal: regression.signal ?? null,
      error: regression.error ? String(regression.error.message ?? regression.error) : null,
      stdoutSha256: sha256(regression.stdout ?? '') };
    requireEvidence(!regression.error && !regression.signal && regression.status === 0, 'Security regressions failed');
    for (const [field, expected] of Object.entries({ tests: 13, pass: 13, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
      const matches = [...(regression.stdout ?? '').matchAll(new RegExp(`^# ${field} (\\d+)\\r?$`, 'gm'))];
      requireEvidence(matches.length === 1 && Number(matches[0][1]) === expected, `Security regression summary mismatch: ${field}`);
    }
    requireEvidence(isDeepStrictEqual(result.source, verifySource(root, expectedSourceSha)), 'Source changed during verification');
    requireEvidence(isDeepStrictEqual(installation, verifyInstallation(root, policy)), 'Installed sources changed during verification');
    result.backports = installation;
    result.status = 'verified';
  } catch (error) {
    result.error = error.message;
    writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    throw Object.assign(new Error(error.message), { result });
  }
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireEvidence(args.length === 4 && args[0] === '--source-sha' && args[2] === '--output',
      'Usage: node scripts/verify-host-security.mjs --source-sha <exact HEAD> --output <new outside-repo directory>');
    console.log(JSON.stringify(runVerification({ root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      expectedSourceSha: args[1], outputDir: args[3] }), null, 2));
  } catch (error) {
    console.log(JSON.stringify(error.result ?? { status: 'failed', releaseApproved: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
