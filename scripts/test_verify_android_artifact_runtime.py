import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name('verify-android-artifact-runtime.py')
PRODUCTION_URL = b'https://clever-route.cleversystem.ai'


class AndroidArtifactRuntimeTests(unittest.TestCase):
    def verify(self, suffix, payload, member=None):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / ('release' + suffix)
            bundle = member or ('base/assets/index.android.bundle' if suffix == '.aab'
                                else 'assets/index.android.bundle')
            with zipfile.ZipFile(artifact, 'w') as archive:
                archive.writestr(bundle, payload)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), '--artifact', str(artifact)],
                capture_output=True, text=True, check=False,
            )
            return result.returncode, json.loads(result.stdout)

    def test_production_bundle_passes_for_aab_and_apk(self):
        for suffix in ('.aab', '.apk'):
            with self.subTest(suffix=suffix):
                code, evidence = self.verify(suffix, b'\x00' + PRODUCTION_URL + b'\x00')
                self.assertEqual(code, 0)
                self.assertTrue(evidence['passed'])
                self.assertEqual(evidence['productionUrlOccurrences'], 1)

    def test_wrong_endpoint_fails(self):
        code, evidence = self.verify('.aab', b'https://localhost:8443')
        self.assertEqual(code, 1)
        self.assertFalse(evidence['passed'])
        self.assertEqual(evidence['productionUrlOccurrences'], 0)

    def test_mixed_production_and_qa_endpoints_fail(self):
        code, evidence = self.verify('.apk', PRODUCTION_URL + b'\x00https://localhost:8443')
        self.assertEqual(code, 1)
        self.assertFalse(evidence['passed'])
        self.assertEqual(evidence['forbiddenEndpointOccurrences'], {'https://localhost:8443': 1})

    def test_endpoint_in_an_unrelated_zip_entry_cannot_pass(self):
        code, evidence = self.verify('.aab', PRODUCTION_URL, member='metadata.txt')
        self.assertEqual(code, 2)
        self.assertFalse(evidence['passed'])
        self.assertIn('error', evidence)

    def test_cash_qa_endpoint_cannot_pass_as_production(self):
        code, evidence = self.verify('.apk', PRODUCTION_URL + b'\x00https://localhost:8445')
        self.assertEqual(code, 1)
        self.assertEqual(evidence['forbiddenEndpointOccurrences'], {'https://localhost:8445': 1})


if __name__ == '__main__':
    unittest.main()
