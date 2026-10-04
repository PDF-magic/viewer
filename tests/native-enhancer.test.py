import base64
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
    def test_uploaded_pdf_uses_browser_bytes_without_http_download(self):
        data = b"%PDF-1.7\nloaded browser data"
        messages = [
            {"action": "enhance-pdf-chunk", "data": base64.b64encode(data).decode()},
            {"action": "enhance-pdf-finish"},
        ]
        def enhance(source_url, reference_url, uploaded_path):
            self.assertEqual(uploaded_path.read_bytes(), data)
            self.assertEqual(source_url, "https://www.sec.gov/example.pdf")
            self.assertEqual(reference_url, source_url)
            return Path("/tmp/enhanced.pdf")
        with patch.object(host, "read_message", side_effect=messages), \
             patch.object(host, "send_message") as send, \
             patch.object(host, "enhance_pdf", side_effect=enhance), \
             patch.object(host, "urlopen", side_effect=AssertionError("must not download")):
            result = host.enhance_uploaded_pdf({
                "sourceUrl": "https://www.sec.gov/example.pdf",
                "referenceUrl": "https://www.sec.gov/example.pdf",
                "byteLength": len(data),
            })
            self.assertEqual(result, Path("/tmp/enhanced.pdf"))
            self.assertEqual(send.call_count, 2)

    def test_incomplete_upload_does_not_run_ocr(self):
        with patch.object(host, "read_message", return_value={"action": "enhance-pdf-finish"}), \
             patch.object(host, "send_message"), \
             patch.object(host, "enhance_pdf") as enhance:
            with self.assertRaisesRegex(ValueError, "incomplete PDF upload"):
                host.enhance_uploaded_pdf({
                    "sourceUrl": "https://example.com/scan.pdf",
                    "referenceUrl": "https://example.com/scan.pdf",
                    "byteLength": 10,
                })
            enhance.assert_not_called()

    def test_noisy_ocr_preserves_native_response_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            source = directory / "scan.pdf"
            source.write_bytes(b"test PDF")
            (directory / "ocr-scanned-pdf.sh").write_text(
                '[ "$3" = "--force-ocr" ] && [ "$4" = "--ai-review" ] || exit 2\n'
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

    def test_ocr_failure_reports_the_underlying_reason(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / "ocr-scanned-pdf.sh").touch()
            source = directory / "scan.pdf"
            source.write_bytes(b"%PDF-1.7")
            with patch.object(host, "load_config", return_value={"enhancer_dir": folder}), \
                 patch.object(host, "input_from_url", return_value=(source, True)), \
                 patch.object(host.subprocess, "run", return_value=subprocess.CompletedProcess(
                     [], 3, stderr="This PDF is digitally signed."
                 )):
                with self.assertRaisesRegex(RuntimeError, "digitally signed"):
                    host.enhance_pdf(source.as_uri(), "https://example.com/scan.pdf")

    def test_web_copy_finishes_in_application_data(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            source = directory / "uploaded.pdf"
            source.write_bytes(b"%PDF-1.7\nloaded data")
            (directory / "ocr-scanned-pdf.sh").write_text('cp "$1" "$2"\n')
            with patch.object(host, "load_config", return_value={"enhancer_dir": folder}), \
                 patch.object(host.Path, "home", return_value=directory), \
                 patch.object(host.sys, "platform", "darwin"), \
                 patch.object(host, "stamp_source_url"), \
                 patch.object(host, "urlopen", side_effect=AssertionError("must not download")):
                result = host.enhance_pdf(
                    "https://www.sec.gov/source.pdf", "https://www.sec.gov/source.pdf",
                    uploaded_path=source,
                )
                self.assertEqual(result, directory / "Library/Application Support/PDF Magic/Enhanced/source-enhanced-ocr.pdf")
                self.assertEqual(result.read_bytes(), source.read_bytes())

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
