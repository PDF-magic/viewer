"""Exercise the installer's generated native launcher without user settings."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "native/install-host.sh"
REGISTRATION = INSTALLER.read_text().split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"


class NativeHostLinkTest(unittest.TestCase):
    def install(self, root, linked=True):
        source = root / "viewer 'checkout'" / "native" / "pdfmagic-enhancer-host.py"
        source.parent.mkdir(parents=True)
        source.write_text("print('checkout version 1')\n")
        installed = root / "installed" / "pdfmagic-enhancer-host.py"
        installed.parent.mkdir()
        installed.write_text("print('installed fallback')\n")
        manifests = root / "manifests"
        manifests.mkdir()
        subprocess.run([
            sys.executable, "-c", REGISTRATION,
            str(root / "config.json"), str(installed), str(root / "enhancer"),
            EXTENSION_ID, str(source) if linked else "", str(manifests),
        ], check=True, capture_output=True, text=True)
        manifest = json.loads((manifests / "org.pdfmagic.enhancer.json").read_text())
        self.assertEqual(manifest["path"], str(installed.resolve()))
        self.assertEqual(manifest["allowed_origins"], [f"chrome-extension://{EXTENSION_ID}/"])
        return source, installed

    def run_host(self, installed, *args):
        return subprocess.run([
            sys.executable, str(installed), *args,
        ], check=True, capture_output=True, text=True).stdout.strip()

    def test_next_launch_loads_updated_checkout_and_preserves_cli_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            source, installed = self.install(Path(directory))
            self.assertTrue(installed.stat().st_mode & 0o111)
            self.assertEqual(self.run_host(installed), "checkout version 1")
            source.write_text("import sys\nprint('checkout version 2', *sys.argv[1:])\n")
            self.assertEqual(self.run_host(installed, "--stamp", "file with spaces.pdf"),
                             "checkout version 2 --stamp file with spaces.pdf")
            source.unlink()
            self.assertEqual(self.run_host(installed), "installed fallback")

    def test_standalone_setup_keeps_its_installed_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            source, installed = self.install(Path(directory), linked=False)
            self.assertEqual(self.run_host(installed), "installed fallback")
            self.assertFalse(installed.with_name("pdfmagic-enhancer-host-fallback.py").exists())


if __name__ == "__main__":
    unittest.main()
