#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('verify_play_aab', Path(__file__).with_name('verify-play-aab.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class PlayAabVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.artifact = root / 'app.aab'
        self.manifest = root / 'manifest.xml'
        self.xml = ('<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
                    'package="com.evnsolution.clever.routes" android:versionCode="52" '
                    'android:versionName="1.3.9"><application android:debuggable="false"/></manifest>')
        self.manifest.write_text(self.xml)
        with zipfile.ZipFile(self.artifact, 'w') as archive:
            for abi in verifier.ARM_ABIS:
                archive.writestr(f'base/lib/{abi}/libexample.so', b'fixture')

    def verify(self, **overrides):
        args = dict(artifact=self.artifact, manifest=self.manifest, version_code=52,
                    version_name='1.3.9', expected_signer='a' * 64, actual_signer='A' * 64)
        args.update(overrides)
        return verifier.verify(**args)

    def test_matching_artifact_passes(self):
        self.assertTrue(self.verify()['passed'])

    def test_wrong_signer_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'certificate'):
            self.verify(actual_signer='b' * 64)

    def test_wrong_version_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'versionCode'):
            self.verify(version_code=53)

    def test_wrong_version_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'versionName'):
            self.verify(version_name='1.3.8')

    def test_wrong_package_is_rejected(self):
        self.manifest.write_text(self.xml.replace('com.evnsolution.clever.routes', 'example.qa'))
        with self.assertRaisesRegex(ValueError, 'package'):
            self.verify()

    def test_debuggable_is_rejected(self):
        self.manifest.write_text(self.xml.replace('debuggable="false"', 'debuggable="true"'))
        with self.assertRaisesRegex(ValueError, 'non-debuggable'):
            self.verify()

    def test_emulator_abi_is_rejected(self):
        with zipfile.ZipFile(self.artifact, 'a') as archive:
            archive.writestr('base/lib/x86_64/libexample.so', b'fixture')
        with self.assertRaisesRegex(ValueError, 'ABI'):
            self.verify()

    def test_missing_arm_abi_is_rejected(self):
        with zipfile.ZipFile(self.artifact, 'w') as archive:
            archive.writestr('base/lib/arm64-v8a/libexample.so', b'fixture')
        with self.assertRaisesRegex(ValueError, 'ABI'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
