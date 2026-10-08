import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { updatePdfFaviconForLocalSource } from "../src/viewer/local-file-favicon.js";

function makeFavicon() {
  const attributes = { href: "assets/luna-mark.png", type: "image/png" };
  return {
    attributes,
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
}

test("local file PDFs use the sparkle emoji favicon", () => {
  const favicon = makeFavicon();
  assert.equal(updatePdfFaviconForLocalSource("file:///Users/wynn/report.pdf", favicon), true);
  assert.deepEqual(favicon.attributes, {
    href: "assets/sparkle-favicon.svg",
    type: "image/svg+xml",
  });
});

test("web, extension, and invalid sources keep the regular favicon", () => {
  for (const source of [
    "https://example.org/report.pdf",
    "http://localhost/file.pdf",
    "chrome-extension://abc/viewer.html",
    "blob:https://example.org/uuid",
    "not a URL",
    null,
  ]) {
    const favicon = makeFavicon();
    assert.equal(updatePdfFaviconForLocalSource(source, favicon), false);
    assert.deepEqual(favicon.attributes, {
      href: "assets/luna-mark.png",
      type: "image/png",
    });
  }
});

test("missing favicon element is harmless", () => {
  assert.equal(updatePdfFaviconForLocalSource("file:///tmp/report.pdf", null), false);
});

test("sparkle favicon asset contains the requested emoji", () => {
  const svg = readFileSync(new URL("../src/assets/sparkle-favicon.svg", import.meta.url), "utf8");
  assert.match(svg, /✨/);
});
