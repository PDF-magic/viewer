import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HOST = Path(__file__).resolve().parents[1] / "native/pdfmagic-enhancer-host.py"
spec = importlib.util.spec_from_file_location("enhancer_host", HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class NativeEnhancerTests(unittest.TestCase):
    def test_noisy_ocr_preserves_native_response_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            source = directory / "scan.pdf"
            source.write_bytes(b"test PDF")
            (directory / "ocr-scanned-pdf.sh").write_text(
                'printf "OCR progress on stdout\\n"\ncp "$1" "$2"\n'
            )
            bootstrap = f"""
import importlib.util
spec = importlib.util.spec_from_file_location('host', {str(HOST)!r})
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.load_config = lambda: {{'enhancer_dir': {folder!r}}}
host.stamp_source_url = lambda *_: None
raise SystemExit(host.main())
"""
            message = json.dumps({
                "action": "enhance-pdf",
                "sourceUrl": source.as_uri(),
                "referenceUrl": "https://example.com/scan.pdf",
            }).encode()
            result = subprocess.run(
                [sys.executable, "-c", bootstrap],
                input=struct.pack("<I", len(message)) + message,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            length = struct.unpack("<I", result.stdout[:4])[0]
            self.assertEqual(len(result.stdout), length + 4)
            response = json.loads(result.stdout[4:])
            self.assertTrue(response["ok"])
            self.assertEqual(response["outputUrl"], (directory / "scan-enhanced-ocr.pdf").as_uri())
            self.assertIn(b"OCR progress on stdout", result.stderr)

    def test_metadata_and_qpdf_logs_use_stderr(self):
        with patch.object(host, "pikepdf_python", return_value=["python3"]), \
             patch.object(host.shutil, "which", return_value="qpdf"), \
             patch.object(host.subprocess, "run") as run:
            host.stamp_source_url(Path("enhanced.pdf"), "https://example.com/scan.pdf")
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                self.assertIs(call.kwargs["stdout"], sys.stderr)


if __name__ == "__main__":
    unittest.main()
