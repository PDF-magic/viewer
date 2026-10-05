#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./native/install-host.sh CHROME_EXTENSION_ID [PDF_MAGIC_ENHANCER_DIR]

Register the PDF Magic enhancer native-messaging host for Chrome and Brave.
If PDF_MAGIC_ENHANCER_DIR is omitted, ../enhancer beside the viewer repo is used.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

extension_id=$1
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  printf 'Expected a 32-character Chrome/Brave extension ID.\n' >&2
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
viewer_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
enhancer_dir=${2:-"$(CDPATH= cd -- "$viewer_dir/../enhancer" 2>/dev/null && pwd || true)"}

if [[ -z "$enhancer_dir" || ! -f "$enhancer_dir/ocr-scanned-pdf.sh" ]]; then
  printf 'PDF Magic enhancer not found. Pass its checkout as the second argument.\n' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    manifest_dirs=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    ;;
  Linux)
    manifest_dirs=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    ;;
  *)
    printf 'Unsupported platform for automatic Chrome native-host registration.\n' >&2
    exit 1
    ;;
esac

config_dir="$HOME/.config/pdf-magic"
config_path="$config_dir/enhancer-host.json"
host_path="$script_dir/pdfmagic-enhancer-host.py"

mkdir -p "$config_dir" "${manifest_dirs[@]}"
chmod +x "$host_path"

python3 - "$config_path" "$host_path" "$enhancer_dir" "$extension_id" "${manifest_dirs[@]}" <<'PY'
import json
from pathlib import Path
import sys

config_path, host_path, enhancer_dir, extension_id, *manifest_dirs = sys.argv[1:]

Path(config_path).write_text(
    json.dumps({"enhancer_dir": str(Path(enhancer_dir).resolve())}, indent=2) + "\n"
)
manifest = json.dumps(
    {
        "name": "org.pdfmagic.enhancer",
        "description": "Run the local PDF Magic enhancer for the PDF Viewer extension",
        "path": str(Path(host_path).resolve()),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    },
    indent=2,
) + "\n"
for manifest_dir in manifest_dirs:
    manifest_path = Path(manifest_dir) / "org.pdfmagic.enhancer.json"
    manifest_path.write_text(manifest)
    print(f"Installed native host: {manifest_path}")
PY

printf 'Configured enhancer: %s\n' "$enhancer_dir"
