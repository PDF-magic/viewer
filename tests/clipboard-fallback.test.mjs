import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/viewer/clipboard-fallback.js", import.meta.url),
  "utf8",
);
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

function clipboardFixture(nativeWriteText) {
  let textarea;
  let execCommandCalls = 0;
  const clipboard = nativeWriteText ? { writeText: nativeWriteText } : {};
  const document = {
    activeElement: null,
    body: {
      append(element) {
        textarea = element;
      },
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {},
        value: "",
      };
    },
    execCommand(command) {
      assert.equal(command, "copy");
      execCommandCalls += 1;
      return true;
    },
  };
  const navigator = { clipboard };

  vm.runInNewContext(source, { document, navigator });

  return {
    clipboard: navigator.clipboard,
    copiedText: () => textarea?.value,
    execCommandCalls: () => execCommandCalls,
  };
}

test("clipboard writes fall back when the host page blocks the async Clipboard API", async () => {
  const fixture = clipboardFixture(async () => {
    throw new Error("clipboard-write blocked by Permissions Policy");
  });

  await fixture.clipboard.writeText("https://archive.org/example.pdf#page=7");

  assert.equal(fixture.execCommandCalls(), 1);
  assert.equal(fixture.copiedText(), "https://archive.org/example.pdf#page=7");
});

test("normal clipboard writes keep using the async Clipboard API", async () => {
  const writes = [];
  const fixture = clipboardFixture(async (text) => writes.push(text));

  await fixture.clipboard.writeText("https://example.com/document.pdf");

  assert.deepEqual(writes, ["https://example.com/document.pdf"]);
  assert.equal(fixture.execCommandCalls(), 0);
});

test("the clipboard fallback loads before viewer copy handlers", () => {
  const fallbackIndex = markup.indexOf('src="viewer/clipboard-fallback.js"');
  const viewerIndex = markup.indexOf('src="viewer/viewer.js"');
  const fileCopyIndex = markup.indexOf('src="viewer/sharing/copy-file-url.js"');

  assert.notEqual(fallbackIndex, -1);
  assert.ok(fallbackIndex < viewerIndex);
  assert.ok(fallbackIndex < fileCopyIndex);
});
