import { execFileSync } from 'node:child_process';

const OFFICIAL_DISTRIBUTION_BRANCHES = new Set(['dev', 'main']);

function git(...args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  console.error(`Distribution build blocked: ${message}`);
  process.exit(1);
}

let branch;
let head;
try {
  branch = git('branch', '--show-current');
  head = git('rev-parse', 'HEAD');
} catch {
  fail('the current directory is not a readable Git checkout.');
}

if (!OFFICIAL_DISTRIBUTION_BRANCHES.has(branch)) {
  fail(`branch "${branch || 'detached HEAD'}" is not an official distribution source. Use dev or main.`);
}

if (git('status', '--porcelain') !== '') {
  fail('the worktree contains uncommitted changes.');
}

let remoteHead;
try {
  remoteHead = git('rev-parse', `origin/${branch}`);
} catch {
  fail(`origin/${branch} is unavailable. Fetch the official branch before building.`);
}

if (head !== remoteHead) {
  fail(`local ${branch} (${head}) does not match origin/${branch} (${remoteHead}).`);
}

console.info(`Distribution source verified: branch=${branch} sha=${head}`);
