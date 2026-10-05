import base64
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


HOST = Path(__file__).resolve().parents[1] / "native/pdfmagic-enhancer-host.py"
spec = importlib.util.spec_from_file_location("enhancer_host", HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class NativeEnhancerTests(unittest.TestCase):
    def test_duplicate_processes_share_progress_and_one_result(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            first = directory / "first.pdf"
            second = directory / "second.pdf"
            first.write_bytes(b"%PDF-1.7\nidentical document")
            second.write_bytes(first.read_bytes())
            bootstrap = f"""
import importlib.util, sys, time
from pathlib import Path
spec = importlib.util.spec_from_file_location('host', {str(HOST)!r})
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
directory = Path({folder!r})
def create(report):
    with (directory / 'runs').open('a') as counter:
        counter.write('run\\n')
    report({{'type': 'progress', 'stage': 'review', 'completed': 1, 'total': 2}})
    (directory / 'started').touch()
    time.sleep(0.8)
    output = directory / 'enhanced.pdf'
    output.write_bytes(b'%PDF-1.7\\nenhanced output')
    return output
result = host.shared_enhancement(Path(sys.argv[1]), create, True, directory / 'jobs')
host.send_message({{'ok': True, 'outputUrl': result.as_uri()}})
"""
            owner = subprocess.Popen([sys.executable, "-c", bootstrap, str(first)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            follower = None
            try:
                deadline = time.monotonic() + 5
                while not (directory / "started").exists():
                    if owner.poll() is not None or time.monotonic() > deadline:
                        self.fail("owner did not start")
                    time.sleep(0.01)
                follower = subprocess.Popen([sys.executable, "-c", bootstrap, str(second)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                streams = [owner.communicate(timeout=5), follower.communicate(timeout=5)]
                self.assertEqual(owner.returncode, 0, streams[0][1])
                self.assertEqual(follower.returncode, 0, streams[1][1])
                self.assertEqual((directory / "runs").read_text(), "run\n")
                results = []
                for stdout, _ in streams:
                    frames = []
                    offset = 0
                    while offset < len(stdout):
                        length = struct.unpack("<I", stdout[offset:offset + 4])[0]
                        frames.append(json.loads(stdout[offset + 4:offset + 4 + length]))
                        offset += 4 + length
                    self.assertIn({"type": "progress", "stage": "review", "completed": 1, "total": 2}, frames)
                    results.append(frames[-1]["outputUrl"])
                self.assertEqual(results[0], results[1])
            finally:
                for process in [owner, follower]:
                    if process is not None and process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_completed_output_is_reused_and_hash_is_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / "scan.pdf"
            output = directory / "enhanced.pdf"
            source.write_bytes(b"original PDF")
            jobs = directory / "jobs"
            def create(report):
                output.write_bytes(b"enhanced PDF")
                return output
            with patch.object(host, "send_message"):
                first = host.shared_enhancement(source, create, True, jobs)
                def unexpected(report):
                    self.fail("a duplicate request started OCR")
                self.assertEqual(host.shared_enhancement(source, unexpected, True, jobs), first)
                self.assertEqual(host.shared_enhancement(output, unexpected, True, jobs), first)
                output.write_bytes(b"changed output")
                self.assertEqual(host.shared_enhancement(source, create, False, jobs), first)
                self.assertEqual(output.read_bytes(), b"enhanced PDF")

    def test_stale_job_can_retry_and_changed_input_starts_new_job(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / "scan.pdf"
            output = directory / "enhanced.pdf"
            jobs = directory / "jobs"
            jobs.mkdir()
            source.write_bytes(b"first PDF")
            host.write_job(jobs / (host.document_hash(source) + ".json"), {"status": "running"})
            def create(report):
                output.write_bytes(source.read_bytes() + b" enhanced")
                return output
            host.shared_enhancement(source, create, False, jobs)
            source.write_bytes(b"second PDF")
            host.shared_enhancement(source, create, False, jobs)
            self.assertEqual(output.read_bytes(), b"second PDF enhanced")

    def test_failed_job_releases_lock_and_can_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / "scan.pdf"
            source.write_bytes(b"PDF")
            def fail(report):
                raise RuntimeError("OCR failed")
            with self.assertRaisesRegex(RuntimeError, "OCR failed"):
                host.shared_enhancement(source, fail, False, directory / "jobs")
            def succeed(report):
                return source
            self.assertEqual(host.shared_enhancement(source, succeed, False, directory / "jobs"), source.resolve())

    def test_closed_tab_does_not_discard_shared_job(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / "scan.pdf"
            source.write_bytes(b"PDF")
            def create(report):
                report({"type": "progress", "stage": "review", "completed": 1, "total": 1})
                return source
            with patch.object(host, "send_message", side_effect=BrokenPipeError):
                self.assertEqual(host.shared_enhancement(source, create, True, directory / "jobs"), source.resolve())

    def test_progress_stream_contains_framed_updates_and_final_result(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder).resolve()
            source = directory / "scan.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            (directory / "ocr-scanned-pdf.sh").write_text(
                'printf "PDF_MAGIC_PROGRESS ocr 2\\n"\n'
                'printf "PDF_MAGIC_PROGRESS review 2\\n"\n'
                'printf "Reviewed page 1/2\\nReviewed page 2/2\\n"\n'
                'printf "PDF_MAGIC_PROGRESS finalizing\\n"\n'
                'cp "$1" "$2"\n'
            )
            bootstrap = f"""
import importlib.util
spec = importlib.util.spec_from_file_location('host', {str(HOST)!r})
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.load_config = lambda: {{'enhancer_dir': {folder!r}}}
host.Path.home = lambda: host.Path({folder!r})
host.stamp_source_url = lambda *_: None
raise SystemExit(host.main())
"""
            message = json.dumps({"action": "enhance-pdf", "sourceUrl": source.as_uri(),
                                  "referenceUrl": "https://example.com/scan.pdf", "progress": True}).encode()
            result = subprocess.run([sys.executable, "-c", bootstrap],
                                    input=struct.pack("<I", len(message)) + message,
                                    capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            frames = []
            offset = 0
            while offset < len(result.stdout):
                length = struct.unpack("<I", result.stdout[offset:offset + 4])[0]
                frames.append(json.loads(result.stdout[offset + 4:offset + 4 + length]))
                offset += 4 + length
            self.assertEqual(offset, len(result.stdout))
            self.assertEqual(frames[0], {"type": "progress", "stage": "ocr"})
            self.assertIn({"type": "progress", "stage": "review", "completed": 1, "total": 2}, frames)
            self.assertTrue(frames[-1]["ok"])
            self.assertTrue(frames[-1]["outputUrl"].endswith("scan-enhanced-ocr.pdf"))

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
host.Path.home = lambda: host.Path({folder!r})
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
            (directory / "ocr-scanned-pdf.sh").write_text('echo "This PDF is digitally signed." >&2\nexit 3\n')
            source = directory / "scan.pdf"
            source.write_bytes(b"%PDF-1.7")
            with patch.object(host, "load_config", return_value={"enhancer_dir": folder}), \
                 patch.object(host, "input_from_url", return_value=(source, True)), \
                 patch.object(host.Path, "home", return_value=directory):
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
