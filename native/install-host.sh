#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./native/install-host.sh CHROME_EXTENSION_ID [PDF_MAGIC_ENHANCER_DIR] [--fork-if-available]

Register the PDF Magic enhancer native-messaging host for Chrome and Brave.
If PDF_MAGIC_ENHANCER_DIR is omitted, a sibling ../enhancer checkout is reused
when available; otherwise the installer creates a managed enhancer checkout.
With --fork-if-available, an authenticated GitHub CLI session creates or reuses
your personal fork before cloning. If GitHub CLI is unavailable, upstream is used.
EOF
}

if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage >&2
  exit 2
fi

extension_id=$1
shift
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  printf 'Expected a 32-character Chrome/Brave extension ID.\n' >&2
  exit 2
fi

enhancer_arg=""
fork_if_available=false
for argument in "$@"; do
  case "$argument" in
    --fork-if-available)
      fork_if_available=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      printf 'Unknown option: %s\n' "$argument" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$enhancer_arg" ]]; then
        printf 'Pass at most one PDF_MAGIC_ENHANCER_DIR.\n' >&2
        exit 2
      fi
      enhancer_arg=$argument
      ;;
  esac
done

if [[ "${PDF_MAGIC_SETUP_APPROVED:-0}" != "1" ]]; then
  cat <<EOF
PDF Magic enhancer setup will:
  - acquire or reuse a local PDF-magic/enhancer checkout
  - install a local copy of the native-messaging bridge
  - register that bridge for Chrome and Brave

EOF
  if "$fork_if_available"; then
    printf '%s\n' 'If GitHub CLI is signed in, setup may create or reuse your GitHub fork of PDF-magic/enhancer.'
  fi
  if [[ ! -t 0 ]]; then
    printf '%s\n' 'Refusing non-interactive setup without PDF_MAGIC_SETUP_APPROVED=1.' >&2
    exit 3
  fi
  read -r -p "Continue? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) printf '%s\n' 'Setup cancelled.'; exit 0 ;;
  esac
fi

source_path=${BASH_SOURCE[0]:-}
script_dir=""
viewer_dir=""
if [[ -n "$source_path" && -f "$source_path" ]]; then
  script_dir=$(CDPATH= cd -- "$(dirname -- "$source_path")" && pwd)
  viewer_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
fi

case "$(uname -s)" in
  Darwin)
    manifest_dirs=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    managed_enhancer_dir="$HOME/Library/Application Support/PDF Magic/Enhancer"
    ;;
  Linux)
    manifest_dirs=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    managed_enhancer_dir="$HOME/.local/share/pdf-magic/enhancer"
    ;;
  *)
    printf 'Unsupported platform for automatic Chrome/Brave native-host registration.\n' >&2
    exit 1
    ;;
esac

enhancer_dir=$enhancer_arg
if [[ -z "$enhancer_dir" && -n "$viewer_dir" && -f "$viewer_dir/../enhancer/ocr-scanned-pdf.sh" ]]; then
  enhancer_dir=$(CDPATH= cd -- "$viewer_dir/../enhancer" && pwd)
fi
if [[ -z "$enhancer_dir" ]]; then
  enhancer_dir=$managed_enhancer_dir
fi

if [[ ! -f "$enhancer_dir/ocr-scanned-pdf.sh" ]]; then
  if [[ -e "$enhancer_dir" ]]; then
    printf 'Enhancer destination exists but is not a PDF-magic/enhancer checkout: %s\n' "$enhancer_dir" >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    printf 'git is required to acquire PDF-magic/enhancer.\n' >&2
    exit 1
  fi

  repository_url="https://github.com/PDF-magic/enhancer.git"
  if "$fork_if_available" && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    github_login=$(gh api user --jq .login 2>/dev/null || true)
    if [[ -n "$github_login" ]]; then
      if ! gh repo view "$github_login/enhancer" >/dev/null 2>&1; then
        gh api --method POST repos/PDF-magic/enhancer/forks >/dev/null 2>&1 || true
        for _ in {1..20}; do
          gh repo view "$github_login/enhancer" >/dev/null 2>&1 && break
          sleep 0.5
        done
      fi
      if gh repo view "$github_login/enhancer" >/dev/null 2>&1; then
        repository_url="https://github.com/$github_login/enhancer.git"
        printf 'Using GitHub fork: %s/enhancer\n' "$github_login"
      else
        printf '%s\n' 'Could not prepare a personal fork; cloning PDF-magic/enhancer instead.' >&2
      fi
    fi
  fi

  mkdir -p "$(dirname -- "$enhancer_dir")"
  printf 'Cloning enhancer into %s\n' "$enhancer_dir"
  git clone "$repository_url" "$enhancer_dir"
fi

if [[ ! -f "$enhancer_dir/ocr-scanned-pdf.sh" ]]; then
  printf 'PDF Magic enhancer is missing ocr-scanned-pdf.sh: %s\n' "$enhancer_dir" >&2
  exit 1
fi

config_dir="$HOME/.config/pdf-magic"
config_path="$config_dir/enhancer-host.json"
host_install_dir="$config_dir/native"
host_path="$host_install_dir/pdfmagic-enhancer-host.py"
host_source=""
if [[ -n "$script_dir" && -f "$script_dir/pdfmagic-enhancer-host.py" ]]; then
  host_source="$script_dir/pdfmagic-enhancer-host.py"
fi

mkdir -p "$config_dir" "$host_install_dir" "${manifest_dirs[@]}"

if [[ -n "$host_source" ]]; then
  cp "$host_source" "$host_path"
else
  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl is required when install-host.sh is run without the viewer checkout.\n' >&2
    exit 1
  fi
  temporary_host="$host_path.tmp"
  trap 'rm -f -- "$temporary_host"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/PDF-magic/viewer/main/native/pdfmagic-enhancer-host.py" -o "$temporary_host"
  mv "$temporary_host" "$host_path"
  trap - EXIT
fi
chmod +x "$host_path"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required to register the PDF Magic native host.\n' >&2
  exit 1
fi

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
printf 'Installed native bridge: %s\n' "$host_path"
