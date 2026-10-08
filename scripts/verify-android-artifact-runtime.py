#!/usr/bin/env python3
"""Reject release artifacts with missing production or known QA endpoint bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


PRODUCTION_URL = b'https://clever-route.cleversystem.ai'
FORBIDDEN_ENDPOINTS = (
    b'https://localhost:8443',
    b'http://localhost:8443',
    b'https://127.0.0.1:8443',
    b'https://localhost:8445',
    b'http://localhost:8445',
    b'https://127.0.0.1:8445',
)
BUNDLE_MEMBERS = {
    '.aab': 'base/assets/index.android.bundle',
    '.apk': 'assets/index.android.bundle',
}


def inspect_artifact(artifact):
    member = BUNDLE_MEMBERS.get(artifact.suffix.lower())
    if member is None:
        raise ValueError('Expected an .aab or .apk artifact')
    with zipfile.ZipFile(artifact) as archive:
        if archive.namelist().count(member) != 1:
            raise ValueError('Artifact must contain exactly one ' + member)
        bundle = archive.read(member)
    artifact_hash = hashlib.sha256()
    with artifact.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            artifact_hash.update(chunk)
    forbidden = {value.decode(): bundle.count(value)
                 for value in FORBIDDEN_ENDPOINTS if value in bundle}
    production_count = bundle.count(PRODUCTION_URL)
    return {
        'artifact': str(artifact),
        'artifactSha256': artifact_hash.hexdigest(),
        'bundleMember': member,
        'bundleSha256': hashlib.sha256(bundle).hexdigest(),
        'expectedProductionUrl': PRODUCTION_URL.decode(),
        'productionUrlOccurrences': production_count,
        'forbiddenEndpointOccurrences': forbidden,
        'passed': production_count > 0 and not forbidden,
        'scope': 'Embedded endpoint bytes only; signing, other runtime settings, and device connectivity require separate verification.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True, type=Path, help='Release AAB or APK to inspect')
    artifact = parser.parse_args().artifact.resolve()
    try:
        evidence = inspect_artifact(artifact)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print(json.dumps({'artifact': str(artifact), 'passed': False, 'error': str(error)}, indent=2))
        return 2
    print(json.dumps(evidence, indent=2))
    return 0 if evidence['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
