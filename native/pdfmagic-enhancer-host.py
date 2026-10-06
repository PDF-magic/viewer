#!/usr/bin/env python3
"""Chrome native-messaging bridge for PDF-magic/enhancer."""

from __future__ import annotations

import base64
from collections import deque
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

HOST_CONFIG = Path.home() / ".config" / "pdf-magic" / "enhancer-host.json"


def document_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_job(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_job(path: Path, state: dict[str, object]) -> None:
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        json.dump(state, output)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def completed_output(state: dict[str, object]) -> Path | None:
    if state.get("status") != "complete" or not isinstance(state.get("output"), str):
        return None
    output = Path(state["output"])
    try:
        if output.is_file() and document_hash(output) == state.get("outputHash"):
            return output
    except OSError:
        pass
    return None


def shared_enhancement(input_path: Path, create, progress: bool, directory: Path) -> Path:
    """Serialize owners by input bytes and let duplicate hosts follow their job."""
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    identity = document_hash(input_path)
    state_path = directory / f"{identity}.json"
    waited = False
    last_event = None

    def notify(event):
        if progress:
            try:
                send_message(event)
            except BrokenPipeError:
                # Closing the initiating tab must not discard a shared job.
                pass

    with (directory / f"{identity}.lock").open("a") as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                waited = True
                event = read_job(state_path).get("progress")
                if progress and isinstance(event, dict) and event != last_event:
                    notify(event)
                    last_event = event
                time.sleep(0.25)
        try:
            state = read_job(state_path)
            cached = completed_output(state)
            if cached is not None:
                return cached
            if waited and state.get("status") == "failed":
                raise RuntimeError(str(state.get("error") or "Shared PDF enhancement failed"))
            state = {"status": "running"}
            write_job(state_path, state)

            def report(event):
                state["progress"] = event
                write_job(state_path, state)
                notify(event)

            try:
                output = create(report).resolve()
                output_hash = document_hash(output)
                state = {"status": "complete", "output": str(output), "outputHash": output_hash}
                write_job(state_path, state)
                # An enhanced PDF is also an alias for the completed result.
                # Never overwrite another job that is already running for it.
                if output_hash != identity:
                    with (directory / f"{output_hash}.lock").open("a") as alias_lock:
                        try:
                            fcntl.flock(alias_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        except BlockingIOError:
                            pass
                        else:
                            write_job(directory / f"{output_hash}.json", state)
                return output
            except Exception as error:
                write_job(state_path, {"status": "failed", "error": str(error)})
                raise
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def read_message() -> dict[str, object]:
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        raise ValueError("missing native-message header")
    length = struct.unpack("<I", header)[0]
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        raise ValueError("incomplete native-message payload")
    return json.loads(payload.decode("utf-8"))


def send_message(payload: dict[str, object]) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_config() -> dict[str, object]:
    if not HOST_CONFIG.is_file():
        raise FileNotFoundError(
            f"native host is not configured; run native/install-host.sh ({HOST_CONFIG})"
        )
    return json.loads(HOST_CONFIG.read_text())


def safe_stem(source_url: str) -> str:
    parsed = urlparse(source_url)
    candidate = Path(unquote(parsed.path)).name or "document.pdf"
    stem = Path(candidate).stem if "." in candidate else candidate
    stem = re.sub(r"-enhanced-ocr(?:-\d+)?$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", stem).strip(" .-_")
    return stem or "document"


def unique_output(directory: Path, stem: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{stem}-enhanced-ocr.pdf"
    index = 2
    while (
        candidate.exists()
        or candidate.with_suffix(".txt").exists()
        or candidate.with_suffix(".tagging.json").exists()
        or candidate.with_suffix(".review.jsonl").exists()
    ):
        candidate = directory / f"{stem}-enhanced-ocr-{index}.pdf"
        index += 1
    return candidate


def prettify_ocr_heading(value: str) -> str:
    text = re.sub(r"\s+", " ", value).strip(" .-_")
    if not text:
        return ""

    letters = [character for character in text if character.isalpha()]
    uppercase_ratio = (
        sum(character.isupper() for character in letters) / len(letters)
        if letters
        else 0
    )
    if uppercase_ratio < 0.9:
        return text

    small_words = {
        "A",
        "AN",
        "AND",
        "AS",
        "AT",
        "BY",
        "FOR",
        "FROM",
        "IN",
        "OF",
        "ON",
        "OR",
        "THE",
        "TO",
        "WITH",
    }
    raw_words = text.split()
    words: list[str] = []
    for index, word in enumerate(raw_words):
        core = re.sub(r"[^A-Za-z]", "", word)
        if not core:
            words.append(word)
        elif core in small_words and index not in {0, len(raw_words) - 1}:
            words.append(word.lower())
        elif core.isupper() and len(core) <= 4:
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def filename_stem(value: str) -> str | None:
    text = re.sub(r"\s+", " ", value).strip()
    text = re.sub(r'[\x00-\x1f/:*?"<>|\\]+', "-", text)
    text = re.sub(r"\s*-\s*", " - ", text)
    text = text.strip(" .-_")
    if not text:
        return None
    return text[:140].rstrip(" .-_")


def ocr_title_stem(report_path: Path) -> str | None:
    try:
        report = json.loads(report_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    headings = report.get("headings")
    if not isinstance(headings, list):
        return None

    structural_heading = re.compile(
        r"^(?:appendix|chapter|contents|index|introduction|part|preface|"
        r"section|table(?:\s+of\s+contents)?)\b",
        re.IGNORECASE,
    )
    candidates: list[tuple[int, str]] = []
    for heading in headings:
        if not isinstance(heading, dict):
            continue
        try:
            page = int(heading.get("page", 0))
        except (TypeError, ValueError):
            continue
        text = prettify_ocr_heading(str(heading.get("text") or ""))
        if (
            page < 1
            or page > 2
            or len(text) < 4
            or len(text) > 140
            or structural_heading.match(text)
        ):
            continue
        candidates.append((page, text))

    if not candidates:
        return None

    title_page = min(page for page, _text in candidates)
    parts: list[str] = []
    for page, text in candidates:
        if page != title_page or text in parts:
            continue
        proposed = " - ".join([*parts, text])
        if len(proposed) > 140:
            if not parts:
                parts.append(text[:140].rstrip())
            break
        parts.append(text)
        if len(parts) == 3:
            break

    return filename_stem(" - ".join(parts))


def rename_for_ocr_title(output_path: Path) -> Path:
    report_path = output_path.with_suffix(".tagging.json")
    title_stem = ocr_title_stem(report_path)
    if not title_stem:
        return output_path

    preferred_output = output_path.parent / f"{title_stem}-enhanced-ocr.pdf"
    if preferred_output == output_path:
        return output_path

    titled_output = unique_output(output_path.parent, title_stem)
    moves = [
        (output_path, titled_output),
        (output_path.with_suffix(".txt"), titled_output.with_suffix(".txt")),
        (report_path, titled_output.with_suffix(".tagging.json")),
    ]
    if not all(source.exists() for source, _destination in moves):
        return output_path
    review_path = output_path.with_suffix(".review.jsonl")
    if review_path.exists():
        moves.append((review_path, titled_output.with_suffix(".review.jsonl")))

    for source, destination in moves:
        source.replace(destination)

    titled_report = titled_output.with_suffix(".tagging.json")
    try:
        report = json.loads(titled_report.read_text())
        report["output"] = str(titled_output)
        titled_report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    except (OSError, json.JSONDecodeError, TypeError):
        pass

    return titled_output


def input_from_url(source_url: str, temporary_directory: Path) -> tuple[Path, bool]:
    parsed = urlparse(source_url)
    if parsed.scheme == "file":
        path = Path(unquote(parsed.path)).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"local PDF not found: {path}")
        return path, True

    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"unsupported PDF source scheme: {parsed.scheme or '(none)'}")

    input_path = temporary_directory / f"{safe_stem(source_url)}.pdf"
    request = Request(
        source_url,
        headers={"User-Agent": "Mozilla/5.0 PDFMagicEnhancer/1.0"},
    )
    with urlopen(request, timeout=120) as response, input_path.open("wb") as output:
        shutil.copyfileobj(response, output)
    return input_path, False


def pikepdf_python() -> list[str]:
    candidates: list[list[str]] = [[sys.executable], ["python3"]]
    ocrmypdf = shutil.which("ocrmypdf")
    if ocrmypdf:
        first_line = Path(ocrmypdf).read_text(errors="ignore").splitlines()[0]
        if first_line.startswith("#!"):
            candidates.append(shlex.split(first_line[2:]))

    for command in candidates:
        try:
            subprocess.run(
                [*command, "-c", "import pikepdf"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return command
        except (OSError, subprocess.CalledProcessError):
            continue

    raise RuntimeError("could not find the Python environment that provides pikepdf")


def stamp_source_url(output_path: Path, reference_url: str) -> None:
    subprocess.run(
        [
            *pikepdf_python(),
            str(Path(__file__).resolve()),
            "--stamp",
            str(output_path),
            reference_url,
        ],
        check=True,
        stdout=sys.stderr,
    )

    qpdf = shutil.which("qpdf")
    if qpdf:
        subprocess.run([qpdf, "--warning-exit-0", "--check", str(output_path)], check=True, stdout=sys.stderr)


def progress_from_log(line: str) -> dict[str, object] | None:
    marker = re.search(r"PDF_MAGIC_PROGRESS (ocr|review|finalizing)(?: (\d+))?", line)
    if marker:
        event = {"type": "progress", "stage": marker[1]}
        if marker[1] == "review" and marker[2]:
            event.update(completed=0, total=int(marker[2]))
        return event
    reviewed = re.search(r"Reviewed page (\d+)/(\d+)", line)
    if reviewed:
        return {"type": "progress", "stage": "review", "completed": int(reviewed[1]), "total": int(reviewed[2])}
    return None


def run_enhancer(command: list[str], progress: bool, report_progress=None) -> None:
    if not progress and report_progress is None:
        result = subprocess.run(command, stdout=sys.stderr, stderr=subprocess.PIPE, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip()[-2000:] or f"PDF enhancement failed (exit {result.returncode})")
        return
    logs = deque(maxlen=80)
    environment = {**os.environ, "PYTHONUNBUFFERED": "1"}
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, bufsize=1, env=environment) as process:
        for line in process.stdout:
            logs.append(line)
            print(line, file=sys.stderr, end="")
            event = progress_from_log(line)
            if event:
                if report_progress is not None:
                    report_progress(event)
                elif progress:
                    send_message(event)
        code = process.wait()
    if code:
        raise RuntimeError("".join(logs).strip()[-2000:] or f"PDF enhancement failed (exit {code})")


def enhancement_options(mode: str) -> list[str]:
    if mode == "light":
        return ["--skip-text"]
    if mode == "deep":
        return ["--force-ocr", "--ai-review"]
    raise ValueError(f"unsupported enhancement mode: {mode}")


def enhance_pdf(
    source_url: str,
    reference_url: str,
    uploaded_path: Path | None = None,
    progress: bool = False,
    enhancement_mode: str = "deep",
) -> Path:
    config = load_config()
    enhancer_dir = Path(str(config["enhancer_dir"])).expanduser().resolve()
    enhancer = enhancer_dir / "ocr-scanned-pdf.sh"
    if not enhancer.is_file():
        raise FileNotFoundError(f"enhancer script not found: {enhancer}")

    with tempfile.TemporaryDirectory(prefix="pdf-magic-enhancer-") as temp_name:
        temporary_directory = Path(temp_name)
        input_path, is_local = (
            (uploaded_path, False) if uploaded_path is not None
            else input_from_url(source_url, temporary_directory)
        )
        # Browser-launched helpers can create Downloads files yet be denied
        # permission to replace them during tagging. Keep web copies in app data.
        web_output_directory = (
            Path.home() / "Library/Application Support/PDF Magic/Enhanced"
            if sys.platform == "darwin"
            else Path.home() / ".local/share/pdf-magic/enhanced"
        )
        output_directory = input_path.parent if is_local else web_output_directory
        options = enhancement_options(enhancement_mode)
        def create(report):
            output_path = unique_output(output_directory, safe_stem(source_url))
            run_enhancer(
                ["/bin/bash", str(enhancer), str(input_path), str(output_path), *options],
                progress, report_progress=report,
            )
            report({"type": "progress", "stage": "finalizing"})
            output_path = rename_for_ocr_title(output_path)
            stamp_source_url(output_path, reference_url)
            return output_path

        return shared_enhancement(input_path, create, progress, web_output_directory / ".jobs")


def enhance_uploaded_pdf(message: dict[str, object]) -> Path:
    source_url = str(message.get("sourceUrl") or "")
    reference_url = str(message.get("referenceUrl") or "")
    byte_length = message.get("byteLength")
    enhancement_mode = str(message.get("enhancementMode") or "deep")
    if not source_url or not reference_url:
        raise ValueError("sourceUrl and referenceUrl are required")
    if type(byte_length) is not int or byte_length <= 0:
        raise ValueError("positive PDF byteLength is required")
    with tempfile.TemporaryDirectory(prefix="pdf-magic-upload-") as folder:
        path = Path(folder) / "source.pdf"
        received = 0
        with path.open("wb") as output:
            send_message({"ok": True})
            while True:
                chunk = read_message()
                if chunk.get("action") == "enhance-pdf-finish":
                    break
                if chunk.get("action") != "enhance-pdf-chunk":
                    raise ValueError("expected PDF chunk or finish")
                data = base64.b64decode(chunk.get("data", ""), validate=True)
                if not data or len(data) > 256 * 1024:
                    raise ValueError("invalid PDF chunk size")
                received += len(data)
                if received > byte_length:
                    raise ValueError("PDF upload exceeds declared byteLength")
                output.write(data)
                send_message({"ok": True})
        if received != byte_length:
            raise ValueError("incomplete PDF upload")
        with path.open("rb") as uploaded:
            if b"%PDF-" not in uploaded.read(1024):
                raise ValueError("uploaded document is not a PDF")
        return enhance_pdf(
            source_url,
            reference_url,
            uploaded_path=path,
            enhancement_mode=enhancement_mode,
            **({"progress": True} if message.get("progress") else {}),
        )


def stamp_mode() -> int:
    if len(sys.argv) != 4:
        print("Usage: pdfmagic-enhancer-host.py --stamp OUTPUT.pdf SOURCE_URL", file=sys.stderr)
        return 2

    import pikepdf

    path = Path(sys.argv[2]).resolve()
    source_url = sys.argv[3].strip()
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    if not source_url:
        raise ValueError("SOURCE_URL must not be empty")

    temporary = path.with_name(f".{path.name}.metadata.tmp")
    if temporary.exists():
        temporary.unlink()

    with pikepdf.open(path) as pdf:
        pikepdf.models.PdfMetadata.register_xml_namespace(
            "https://pdfmagic.org/ns/1.0/", "pdfmagic"
        )
        with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as metadata:
            metadata["pdfmagic:href"] = source_url
        if "/PDFMagicSourceURL" in pdf.docinfo:
            del pdf.docinfo["/PDFMagicSourceURL"]
        pdf.save(temporary)

    os.replace(temporary, path)
    return 0


def main() -> int:
    # Browsers launched from Finder do not inherit the shell's Homebrew PATH.
    os.environ["PATH"] = os.pathsep.join(
        ["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", os.defpath)]
    )
    if len(sys.argv) > 1 and sys.argv[1] == "--stamp":
        return stamp_mode()

    try:
        message = read_message()
        if message.get("action") not in {"enhance-pdf", "enhance-pdf-start"}:
            raise ValueError("unsupported native-host action")

        source_url = str(message.get("sourceUrl") or "")
        reference_url = str(message.get("referenceUrl") or "")
        if not source_url or not reference_url:
            raise ValueError("sourceUrl and referenceUrl are required")

        output_path = (
            enhance_uploaded_pdf(message) if message["action"] == "enhance-pdf-start"
            else enhance_pdf(
                source_url,
                reference_url,
                enhancement_mode=str(message.get("enhancementMode") or "deep"),
                **({"progress": True} if message.get("progress") else {}),
            )
        )
        send_message(
            {
                "ok": True,
                "outputUrl": output_path.as_uri(),
                "referenceUrl": reference_url,
            }
        )
        return 0
    except Exception as error:
        send_message({"ok": False, "error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
