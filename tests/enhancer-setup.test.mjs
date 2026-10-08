import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRepositoryUrl,
  shellQuote,
  makeInstallerScript,
  makeSetupZip,
} from "../src/viewer/enhancer-setup-download.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

test("accepts existing fork and upstream GitHub URLs", () => {
  assert.equal(normalizeRepositoryUrl("https://github.com/owner/enhancer"), "https://github.com/owner/enhancer.git");
  assert.equal(normalizeRepositoryUrl("https://github.com/owner/enhancer.git/"), "https://github.com/owner/enhancer.git");
});

test("rejects non-GitHub URLs, credentials, fragments and injected paths", () => {
  for (const url of [
    "https://evil.example/owner/enhancer",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/user@evil.example/owner/repo",
    "https://github.com/owner/repo?x=1",
    "https://github.com/owner/repo#readme",
    "http://github.com/owner/repo",
  ]) {
    assert.throws(() => normalizeRepositoryUrl(url));
  }
});

test("generated installer uses chosen fork and folder without shell interpolation", () => {
  const script = makeInstallerScript({
    extensionId,
    repositoryUrl: "https://github.com/tester/enhancer",
    checkoutPath: "/Users/tester/My 'Enhancer' files",
  });
  assert.ok(script.includes("--repo 'https://github.com/tester/enhancer.git'"));
  assert.ok(script.includes("--directory " + shellQuote("/Users/tester/My 'Enhancer' files")));
  assert.ok(script.includes("PDF_MAGIC_SETUP_APPROVED=1 bash -s"));
  assert.ok(shellQuote("it\'s").includes(String.raw`'"'"'`));
  assert.throws(() => makeInstallerScript({
    extensionId,
    repositoryUrl: "https://github.com/tester/enhancer",
    checkoutPath: "/tmp/folder\nmalicious",
  }));
});

test("ZIP contains user-runnable macOS script, shell script, and instructions", () => {
  const script = makeInstallerScript({ extensionId, repositoryUrl: "https://github.com/PDF-magic/enhancer" });
  const zip = makeSetupZip(script);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 3);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const names = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const fileName = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    names.push(fileName);
    if (fileName.endsWith(".command") || fileName.endsWith(".sh")) {
      assert.equal((view.getUint32(offset + 38, true) >>> 16) & 0o777, 0o755);
    }
    offset += 46 + nameLength;
  }
  assert.deepEqual(names, ["Install PDF Magic.command", "Install PDF Magic.sh", "README.txt"]);
});
