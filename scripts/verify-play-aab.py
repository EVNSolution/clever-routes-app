#!/usr/bin/env python3
"""Verify metadata extracted from a signed AAB, not the Gradle source file."""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

ANDROID = '{http://schemas.android.com/apk/res/android}'
PACKAGE = 'com.evnsolution.clever.routes'
ARM_ABIS = {'armeabi-v7a', 'arm64-v8a'}


def verify(artifact, manifest, version_code, version_name, expected_signer, actual_signer):
    normalize = lambda value: value.replace(':', '').strip().lower()
    signer = normalize(actual_signer)
    if len(signer) != 64 or signer != normalize(expected_signer):
        raise ValueError('AAB upload certificate mismatch')
    root = ET.parse(manifest).getroot()
    expected = {'package': PACKAGE, ANDROID + 'versionCode': str(version_code),
                ANDROID + 'versionName': version_name}
    for attribute, value in expected.items():
        if root.get(attribute) != value:
            raise ValueError(f'AAB manifest mismatch: {attribute}')
    app = root.find('application')
    if app is None or app.get(ANDROID + 'debuggable', 'false') != 'false':
        raise ValueError('AAB must contain a non-debuggable application')
    with zipfile.ZipFile(artifact) as archive:
        abis = {parts[2] for name in archive.namelist()
                if len(parts := name.split('/')) >= 4 and parts[1] == 'lib'}
    if abis != ARM_ABIS:
        raise ValueError(f'AAB ABI mismatch: {sorted(abis)}')
    digest = hashlib.sha256()
    with artifact.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    checksum = digest.hexdigest()
    return {'package': PACKAGE, 'versionCode': version_code, 'versionName': version_name,
            'uploadCertificateSha256': signer, 'abis': sorted(abis),
            'artifactSha256': checksum, 'bytes': artifact.stat().st_size, 'passed': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--version-code', type=int, required=True)
    parser.add_argument('--version-name', required=True)
    parser.add_argument('--expected-signer', required=True)
    parser.add_argument('--actual-signer', required=True)
    args = parser.parse_args()
    try:
        evidence = verify(**vars(args))
    except (ValueError, OSError, ET.ParseError, zipfile.BadZipFile) as error:
        print(json.dumps({'passed': False, 'error': str(error)}, indent=2))
        return 1
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
