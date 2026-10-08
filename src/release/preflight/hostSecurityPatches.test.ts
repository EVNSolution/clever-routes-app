import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, createHash, generateKeyPairSync, privateEncrypt } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = createRequire(import.meta.url);
const braces = load('braces');
const forge = load('node-forge');
const signing = load('@expo/code-signing-certificates');
const metro = load(resolve(repoRoot, 'node_modules/metro-file-map/src/watchers/common.js'));
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
const digest = createHash('sha256').update('synthetic host security regression').digest();

function digestSignature(includeNull: boolean, extraTypes: number[] = [], nullValue = ''): string {
  const { asn1 } = forge;
  const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
    asn1.oidToDer(forge.oids.sha256).getBytes())];
  if (includeNull) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, nullValue));
  for (const type of extraTypes) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, type, false,
    type === asn1.Type.NULL ? '' : 'unconsumed-attacker-bytes'));
  const value = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest.toString('binary')),
  ]);
  return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(asn1.toDer(value).getBytes(), 'binary')).toString('binary');
}

describe('host dependency security regressions', () => {
  it('rejects deep braces and parentheses before recursive walkers exhaust the stack', () => {
    for (const depth of [101, 4000]) {
      for (const [open, close] of [['{', '}'], ['(', ')']]) {
        const pattern = open.repeat(depth) + 'a' + close.repeat(depth);
        for (const operation of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
          assert.throws(() => operation(pattern), (error: unknown) => error instanceof SyntaxError
            && error.message === 'Nesting depth exceeds maximum of 100');
        }
      }
    }
  });

  it('keeps valid brace expansion, escaping, quotes, and 100-level patterns', () => {
    assert.deepEqual(braces.expand('src/{domain,api}/*.{ts,tsx}'), [
      'src/domain/*.ts', 'src/domain/*.tsx', 'src/api/*.ts', 'src/api/*.tsx',
    ]);
    assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a' + '}'.repeat(100)));
    assert.equal(braces.compile('"' + '{'.repeat(300) + '"'), '{'.repeat(300));
    assert.equal(braces.compile('\\{'.repeat(300)), '{'.repeat(300));
  });

  it('preserves actual Metro watcher matching for extensions, nested paths, and dot files', () => {
    const patterns = ['src/**/*.{ts,tsx}', 'assets/*.{png,jpg}'];
    assert.equal(metro.includedByGlob('f', patterns, false, 'src/domain/stop/file.ts'), true);
    assert.equal(metro.includedByGlob('f', patterns, false, 'src/ui/View.tsx'), true);
    assert.equal(metro.includedByGlob('f', patterns, false, 'assets/marker.png'), true);
    assert.equal(metro.includedByGlob('f', patterns, false, 'assets/marker.svg'), false);
    assert.equal(metro.includedByGlob('f', [], false, '.hidden'), false);
    assert.equal(metro.includedByGlob('f', [], true, '.hidden'), true);
  });

  it('rejects extra DigestAlgorithm elements with and without optional NULL parameters', () => {
    for (const [includeNull, extras] of [
      [true, [forge.asn1.Type.OCTETSTRING]], [false, [forge.asn1.Type.OCTETSTRING]],
      [true, [forge.asn1.Type.NULL]],
    ] as [boolean, number[]][]) {
      const signature = digestSignature(includeNull, extras);
      assert.throws(() => publicKey.verify(digest.toString('binary'), signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/u);
    }
  });

  it('preserves valid SHA256 signatures with optional NULL and rejects changed digests', () => {
    for (const includeNull of [true, false]) {
      const signature = digestSignature(includeNull);
      assert.equal(publicKey.verify(digest.toString('binary'), signature), true);
      assert.equal(publicKey.verify(Buffer.alloc(32).toString('binary'), signature), false);
    }
  });

  it('rejects nonempty DigestAlgorithm NULL parameters', () => {
    // Synthetic private-key signatures test parser acceptance, not keyless forgery.
    for (const length of [1, 8, 32, 33]) {
      const signature = digestSignature(true, [], 'x'.repeat(length));
      assert.throws(() => publicKey.verify(digest.toString('binary'), signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/u);
    }
  });

  it('preserves Expo self-signed certificate validation and manifest signing', () => {
    const keyPair = signing.convertKeyPairPEMToKeyPair({ publicKeyPEM: publicKeyPem, privateKeyPEM: privateKeyPem });
    const certificate = signing.generateSelfSignedCodeSigningCertificate({
      keyPair, validityNotBefore: new Date(Date.now() - 60_000),
      validityNotAfter: new Date(Date.now() + 60_000), commonName: 'Synthetic host regression',
    });
    assert.doesNotThrow(() => signing.validateSelfSignedCertificate(certificate, keyPair));
    const message = Buffer.from('{"synthetic":true}');
    const signature = signing.signBufferRSASHA256AndVerify(keyPair.privateKey, certificate, message);
    assert.equal(certificate.publicKey.verify(createHash('sha256').update(message).digest('binary'),
      Buffer.from(signature, 'base64').toString('binary')), true);
  });
});

type Patch = { name: string; version: string; file: string; tarballIntegrity: string; beforeSha256: string; afterSha256: string;
  replacements: { before: string; after: string }[] };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function fixture(t: TestContext): { root: string; patches: Patch[] } {
  const root = mkdtempSync(resolve(tmpdir(), 'clever-host-security-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const patches = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/security-patches/manifest.json'), 'utf8')).patches as Patch[];
  const packages: Record<string, { version: string; integrity: string }> = {};
  for (const patch of patches) {
    const directory = resolve(root, 'node_modules', patch.name);
    mkdirSync(dirname(resolve(directory, patch.file)), { recursive: true });
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: patch.name, version: patch.version }));
    let source = readFileSync(resolve(repoRoot, 'node_modules', patch.name, patch.file), 'utf8');
    if (sha256(source) === patch.afterSha256) {
      for (const replacement of [...patch.replacements].reverse()) source = source.replace(replacement.after, replacement.before);
    }
    assert.equal(sha256(source), patch.beforeSha256);
    writeFileSync(resolve(directory, patch.file), source);
    packages[`node_modules/${patch.name}`] = { version: patch.version, integrity: patch.tarballIntegrity };
  }
  writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ packages }));
  return { root, patches };
}

function apply(root: string) {
  return spawnSync(process.execPath, [resolve(repoRoot, 'scripts/patch-host-security.mjs'), root], { encoding: 'utf8' });
}

describe('host patch install integrity', () => {
  it('requires the exact reviewed patched source in the installed dependency tree', () => {
    const { patches } = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/security-patches/manifest.json'), 'utf8')) as { patches: Patch[] };
    for (const patch of patches) assert.equal(sha256(readFileSync(resolve(repoRoot, 'node_modules', patch.name, patch.file), 'utf8')), patch.afterSha256);
  });

  it('applies exact pinned bytes and is idempotent', (t) => {
    const { root, patches } = fixture(t);
    const first = apply(root);
    assert.equal(first.status, 0, first.stderr);
    for (const patch of patches) assert.equal(sha256(readFileSync(resolve(root, 'node_modules', patch.name, patch.file), 'utf8')), patch.afterSha256);
    const second = apply(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /0 changed/u);
  });

  it('fails on unknown source bytes before patching any dependency', (t) => {
    const { root, patches } = fixture(t);
    const target = patches.at(-1)!;
    writeFileSync(resolve(root, 'node_modules', target.name, target.file), 'unrecognized source');
    const result = apply(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported source hash/u);
    const first = patches[0]!;
    assert.equal(sha256(readFileSync(resolve(root, 'node_modules', first.name, first.file), 'utf8')), first.beforeSha256);
  });

  it('fails on installed version or lockfile version drift', (t) => {
    for (const drift of ['installed', 'lock']) {
      const { root, patches } = fixture(t);
      const target = patches[0]!;
      if (drift === 'installed') writeFileSync(resolve(root, 'node_modules', target.name, 'package.json'), JSON.stringify({ name: target.name, version: '999.0.0' }));
      else {
        const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
        lock.packages[`node_modules/${target.name}`].version = '999.0.0';
        writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify(lock));
      }
      const result = apply(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unsupported package version/u);
    }
  });

  it('patches every locked nested copy without changing package identities', (t) => {
    const { root, patches } = fixture(t);
    const patch = patches[0]!;
    const nested = `node_modules/synthetic-parent/node_modules/${patch.name}`;
    cpSync(resolve(root, 'node_modules', patch.name), resolve(root, nested), { recursive: true });
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
    lock.packages[nested] = { version: patch.version, integrity: patch.tarballIntegrity };
    writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify(lock));
    const result = apply(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sha256(readFileSync(resolve(root, nested, patch.file), 'utf8')), patch.afterSha256);
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, nested, 'package.json'), 'utf8')), { name: patch.name, version: patch.version });
  });

  it('rejects lockfile integrity drift instead of treating another tarball as the pinned source', (t) => {
    const { root, patches } = fixture(t);
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
    lock.packages[`node_modules/${patches[0]!.name}`].integrity = 'sha512-unreviewed';
    writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify(lock));
    const result = apply(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported package integrity/u);
  });
});
