"""Verify native-host metadata stamping prefers the Enhancer's Python venv."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HOST = Path(__file__).resolve().parents[1] / "native" / "pdfmagic-enhancer-host.py"
spec = importlib.util.spec_from_file_location("pdfmagic_enhancer_host", HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class PythonVirtualEnvironmentTests(unittest.TestCase):
    def test_host_uses_enhancer_venv_for_pikepdf_before_global_interpreters(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            python = directory / "enhancer" / ".venv" / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_text("#!/bin/sh\nexit 0\n")
            config = directory / "enhancer-host.json"
            config.write_text(json.dumps({"enhancer_dir": str(directory / "enhancer")}))
            with patch.object(host, "HOST_CONFIG", config), \
                 patch.object(host.subprocess, "run") as run, \
                 patch.object(host.shutil, "which", return_value=None):
                selected = host.pikepdf_python()
            self.assertEqual(selected, [str(python)])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], [str(python), "-c", "import pikepdf"])

    def test_unconfigured_host_keeps_the_prior_interpreter_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "missing-config.json"
            with patch.object(host, "HOST_CONFIG", config), \
                 patch.object(host.subprocess, "run") as run, \
                 patch.object(host.shutil, "which", return_value=None):
                selected = host.pikepdf_python()
            self.assertEqual(selected, [host.sys.executable])
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
