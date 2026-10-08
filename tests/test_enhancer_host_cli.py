"""Regression coverage for the browser native-host / enhancer CLI boundary."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


HOST_PATH = Path(__file__).resolve().parents[1] / "native" / "pdfmagic-enhancer-host.py"
SPEC = importlib.util.spec_from_file_location("pdfmagic_enhancer_host", HOST_PATH)
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)


class EnhancerCliTest(unittest.TestCase):
    def test_light_enhancement_uses_only_supported_ocr_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            enhancer_dir = folder / "enhancer"
            enhancer_dir.mkdir()
            executable = enhancer_dir / "ocr-scanned-pdf.sh"
            executable.write_text("#!/usr/bin/env bash\n")
            input_file = folder / "input.pdf"
            input_file.write_bytes(b"%PDF-1.7\n")
            output_file = folder / "output.pdf"
            calls = []
            def capture_command(command, progress, report_progress=None):
                calls.append(command)

            with (
                patch.object(host, "load_config", return_value={"enhancer_dir": str(enhancer_dir)}),
                patch.object(host, "unique_output", return_value=output_file),
                patch.object(host, "run_enhancer", side_effect=capture_command),
                patch.object(host, "rename_for_ocr_title", side_effect=lambda path: path),
                patch.object(host, "stamp_source_url") as stamp,
                patch.object(host, "shared_enhancement", side_effect=lambda source, create, progress, output: create(lambda report: None)),
            ):
                result = host.enhance_pdf(
                    "https://example.org/document.pdf",
                    "https://example.org/document.pdf",
                    uploaded_path=input_file,
                    enhancement_mode="light",
                )
            self.assertEqual(result, output_file)
            self.assertEqual(calls, [[
                "/bin/bash", str(executable), str(input_file), str(output_file), "--skip-text"
            ]])
            stamp.assert_called_once_with(output_file, "https://example.org/document.pdf")


if __name__ == "__main__":
    unittest.main()
