// The browser can download a user-run installer, but it cannot register native messaging hosts.
const INSTALLER_URL = "https://raw.githubusercontent.com/PDF-magic/viewer/main/native/install-host.sh";
const encoder = new TextEncoder();

export function normalizeRepositoryUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error("Enter a GitHub repository URL, such as https://github.com/your-name/enhancer");
  }
  const parts = url.pathname.replace(/\/+$|\.git$/g, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" ||
      url.username || url.password || url.port || url.search || url.hash ||
      parts.length !== 2 || !parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)) ||
      parts.some((part) => part === "." || part === "..")) {
    throw new Error("Choose a GitHub repository URL in the form https://github.com/owner/repository");
  }
  return `https://github.com/${parts.join("/")}.git`;
}

export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

export function makeInstallerScript({ extensionId, repositoryUrl, checkoutPath = "" }) {
  if (!/^[a-p]{32}$/.test(extensionId || "")) {
    throw new Error("Cannot determine the Chrome/Brave extension ID");
  }
  const repo = normalizeRepositoryUrl(repositoryUrl);
  const location = String(checkoutPath).trim();
  if (/[\r\n\0]/.test(location)) {
    throw new Error("The checkout folder must be a single filesystem path");
  }
  const args = [shellQuote(extensionId), "--repo", shellQuote(repo)];
  if (location) args.push("--directory", shellQuote(location));
  return `#!/usr/bin/env bash
set -euo pipefail
finish() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\\nSetup did not complete (exit %s). Review the error above.\\n' "$status"
  fi
  if [ -t 0 ]; then
    printf '\\nPress Return to close this window... '
    read -r _ || true
  fi
}
trap finish EXIT

printf 'PDF Magic Enhancer — clone and register native helper\\n'
printf 'This script downloads the official PDF Magic installer, clones or reuses the chosen repository, and registers the helper for this extension.\\n\\n'
curl -fsSL ${shellQuote(INSTALLER_URL)} | PDF_MAGIC_SETUP_APPROVED=1 bash -s -- ${args.join(" ")}
printf '\\nSetup completed. Return to the PDF viewer and click Enhance.\\n'
`;
}

// Store-only ZIP creator. Unix executable mode survives macOS Archive Utility extraction.
// The archive includes a macOS .command file so the user need not paste anything in Terminal.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(target, offset, value) {
  target[offset] = value & 255;
  target[offset + 1] = (value >>> 8) & 255;
}

function write32(target, offset, value) {
  write16(target, offset, value);
  write16(target, offset + 2, value >>> 16);
}

export function makeSetupZip(script) {
  const readme = [
    "PDF Magic Enhancer setup",
    "",
    "macOS: Extract this ZIP and open Install PDF Magic.command.",
    "If macOS warns about an unidentified script, review the script before allowing it.",
    "Linux: Extract this ZIP and run bash 'Install PDF Magic.sh' locally.",
    "",
    "You must explicitly run the downloaded installer. Browser extensions",
    "cannot install native-messaging helpers or clone Git repositories themselves.",
    "The installer requires git, curl and python3. The OCR workflow additionally",
    "requires ocrmypdf and qpdf (on macOS: brew install ocrmypdf).",
    "",
  ].join("\n");
  const files = [
    { name: "Install PDF Magic.command", content: script, mode: 0o100755 },
    { name: "Install PDF Magic.sh", content: script, mode: 0o100755 },
    { name: "README.txt", content: readme, mode: 0o100644 },
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 6, 0x800); // UTF-8 file names
    write32(local, 14, checksum);
    write32(local, 18, data.length);
    write32(local, 22, data.length);
    write16(local, 26, name.length);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    write32(central, 0, 0x02014b50);
    write16(central, 4, (3 << 8) | 20); // made by Unix
    write16(central, 6, 20);
    write16(central, 8, 0x800);
    write32(central, 16, checksum);
    write32(central, 20, data.length);
    write32(central, 24, data.length);
    write16(central, 28, name.length);
    write32(central, 38, (file.mode << 16) >>> 0);
    write32(central, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralLength = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054b50);
  write16(end, 8, files.length);
  write16(end, 10, files.length);
  write32(end, 12, centralLength);
  write32(end, 16, offset);

  const zip = new Uint8Array(offset + centralLength + end.length);
  let cursor = 0;
  for (const piece of [...locals, ...centrals, end]) {
    zip.set(piece, cursor);
    cursor += piece.length;
  }
  return zip;
}

export function downloadSetupZip(options) {
  const script = makeInstallerScript(options);
  const zip = makeSetupZip(script);
  const blobUrl = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "PDF-Magic-Enhancer-Setup.zip";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
