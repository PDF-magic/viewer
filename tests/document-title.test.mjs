import assert from "node:assert/strict";
import test from "node:test";

import { metadataValue, pdfMetadataTitle } from "../src/viewer/pdf-metadata-title.js";

function xmp(fields) {
  return { get(key) { return fields[key]; } };
}

test("PDF Info Title takes precedence over XMP and is normalized for the tab", () => {
  assert.equal(pdfMetadataTitle(
    { Title: "  A Book\nAbout Markets  " },
    xmp({ "dc:title": "Different XMP Title" }),
  ), "A Book About Markets");
});

test("XMP dc:title is used when the PDF Info title is missing or blank", () => {
  assert.equal(pdfMetadataTitle({}, xmp({ "dc:title": "  XMP Book Title  " })), "XMP Book Title");
  assert.equal(pdfMetadataTitle({ Title: "   " }, xmp({ "dc:title": ["First", "Second"] })), "First, Second");
});

test("missing, empty, or unreadable titles leave the filename fallback available", () => {
  for (const [info, metadata] of [
    [{}, null],
    [{ Title: "" }, xmp({ "dc:title": "  " })],
    [null, null],
    [{ Title: {} }, xmp({ "dc:title": null })],
  ]) {
    assert.equal(pdfMetadataTitle(info, metadata), "");
  }
});

test("other metadata fields still prefer Info over XMP", () => {
  assert.equal(metadataValue({ Author: "Info Author" }, xmp({ "dc:creator": "XMP Author" }), "Author", "dc:creator"), "Info Author");
});

test("document identity first uses the filename, then the embedded PDF title even without an outline", async () => {
  const previous = Object.fromEntries(["window", "document", "localStorage", "chrome", "setInterval"].map(key => [key, globalThis[key]]));
  let resolveMetadata;
  let onMetadataRequested;
  const metadataRequested = new Promise(resolve => { onMetadataRequested = resolve; });

  const fakeDocument = {
    title: "PDF Viewer",
    querySelector() { return null; },
  };

  try {
    globalThis.document = fakeDocument;
    globalThis.window = {
      location: { search: "?url=" + encodeURIComponent("file:///Users/Wynn/draft%20report.pdf") },
      addEventListener() {},
    };
    globalThis.localStorage = { getItem() { return null; } };
    globalThis.chrome = {};
    globalThis.setInterval = () => 1;

    const { publishPdfDocument } = await import("../src/viewer/pdf-document-session.js");
    publishPdfDocument({
      getMetadata() {
        onMetadataRequested();
        return new Promise(resolve => { resolveMetadata = resolve; });
      },
    }, {});

    const loadIdentity = import("../src/viewer/document-identity.js");
    await metadataRequested;
    assert.equal(fakeDocument.title, "draft report.pdf");

    resolveMetadata({ info: { Title: "  Embedded Title  " }, metadata: null });
    await loadIdentity;
    assert.equal(fakeDocument.title, "Embedded Title");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
