import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// All target versions and complete source hashes must match before the first write.
// Package names/versions stay unchanged: this does not suppress npm audit advisories.
const root = realpathSync(resolve(process.argv[2] ?? process.cwd()));
const manifest = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  'security-patches/manifest.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const sha256 = (source) => createHash('sha256').update(source).digest('hex');
const changes = [];
let checked = 0;

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.patches) || manifest.patches.length === 0) {
  throw new Error('Invalid host security patch manifest');
}

for (const patch of manifest.patches) {
  const packagePaths = Object.keys(lock.packages ?? {}).filter((path) =>
    path === `node_modules/${patch.name}` || path.endsWith(`/node_modules/${patch.name}`));
  if (packagePaths.length === 0) throw new Error(`Missing locked security dependency: ${patch.name}`);

  for (const packagePath of packagePaths) {
    const directory = realpathSync(resolve(root, packagePath));
    const file = realpathSync(resolve(directory, patch.file));
    if (!directory.startsWith(`${root}${sep}node_modules${sep}`) || !file.startsWith(`${directory}${sep}`)) {
      throw new Error(`Security dependency points outside the install root: ${packagePath}`);
    }
    const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    if (metadata.name !== patch.name || metadata.version !== patch.version
      || lock.packages[packagePath].version !== patch.version) {
      throw new Error(`Unsupported package version for ${packagePath}; expected ${patch.name}@${patch.version}`);
    }
    if (lock.packages[packagePath].integrity !== patch.tarballIntegrity) {
      throw new Error(`Unsupported package integrity for ${packagePath}`);
    }
    const source = readFileSync(file, 'utf8');
    const hash = sha256(source);
    checked += 1;
    if (hash === patch.afterSha256) continue;
    if (hash !== patch.beforeSha256) throw new Error(`Unsupported source hash for ${packagePath}/${patch.file}: ${hash}`);
    let patched = source;
    for (const replacement of patch.replacements) {
      if (patched.split(replacement.before).length !== 2) {
        throw new Error(`Patch context must match exactly once: ${packagePath}/${patch.file}`);
      }
      patched = patched.replace(replacement.before, replacement.after);
    }
    if (sha256(patched) !== patch.afterSha256) throw new Error(`Patched source hash mismatch for ${packagePath}/${patch.file}`);
    changes.push({ file, patched });
  }
}

for (const { file, patched } of changes) writeFileSync(file, patched);
console.log(`Host security patches: ${checked} verified, ${changes.length} changed.`);
