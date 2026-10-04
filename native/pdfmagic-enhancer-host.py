#!/usr/bin/env python3
"""Chrome native-messaging bridge for PDF-magic/enhancer."""

from __future__ import annotations

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
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

HOST_CONFIG = Path.home() / ".config" / "pdf-magic" / "enhancer-host.json"


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
    )

    qpdf = shutil.which("qpdf")
    if qpdf:
        subprocess.run([qpdf, "--check", str(output_path)], check=True)


def enhance_pdf(source_url: str, reference_url: str) -> Path:
    config = load_config()
    enhancer_dir = Path(str(config["enhancer_dir"])).expanduser().resolve()
    enhancer = enhancer_dir / "ocr-scanned-pdf.sh"
    if not enhancer.is_file():
        raise FileNotFoundError(f"enhancer script not found: {enhancer}")

    with tempfile.TemporaryDirectory(prefix="pdf-magic-enhancer-") as temp_name:
        temporary_directory = Path(temp_name)
        input_path, is_local = input_from_url(source_url, temporary_directory)
        output_directory = input_path.parent if is_local else Path.home() / "Downloads"
        output_path = unique_output(output_directory, safe_stem(source_url))

        subprocess.run(
            ["/bin/bash", str(enhancer), str(input_path), str(output_path)],
            check=True,
        )
        output_path = rename_for_ocr_title(output_path)
        stamp_source_url(output_path, reference_url)
        return output_path.resolve()


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
        pdf.docinfo["/PDFMagicSourceURL"] = pikepdf.String(source_url)
        pdf.save(temporary)

    os.replace(temporary, path)
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--stamp":
        return stamp_mode()

    try:
        message = read_message()
        if message.get("action") != "enhance-pdf":
            raise ValueError("unsupported native-host action")

        source_url = str(message.get("sourceUrl") or "")
        reference_url = str(message.get("referenceUrl") or "")
        if not source_url or not reference_url:
            raise ValueError("sourceUrl and referenceUrl are required")

        output_path = enhance_pdf(source_url, reference_url)
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
