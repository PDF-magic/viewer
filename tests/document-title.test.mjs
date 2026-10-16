import assert from "node:assert/strict";
import test from "node:test";

import { metadataField, metadataValue, pdfMetadataTitle } from "../src/viewer/pdf-metadata-title.js";

function xmp(fields) {
  return { get(key) { return fields[key]; } };
}

test("XMP Title takes precedence over PDF Info and is normalized for the tab", () => {
  assert.equal(pdfMetadataTitle(
    { Title: "  A Book\nAbout Markets  " },
    xmp({ "dc:title": "Different XMP Title" }),
  ), "Different XMP Title");
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

test("XMP values take precedence with PDF Info fallback", () => {
  assert.equal(metadataValue({ Author: "Info Author" }, xmp({ "dc:creator": "XMP Author" }), "Author", "dc:creator"), "XMP Author");
  assert.equal(metadataValue({ Author: "Info Author" }, xmp({ "dc:creator": " " }), "Author", "dc:creator"), "Info Author");
  assert.equal(metadataValue({ Keywords: "Legacy" }, xmp({ "dc:subject": ["Markets", "Securities"] }), "Keywords", ["pdf:keywords", "dc:subject"]), "Markets, Securities");
  assert.equal(metadataValue({ Title: "Fallback" }, { get() { throw Error("bad XMP"); } }, "Title", "dc:title"), "Fallback");
});

test("differences are detected while preserving both metadata sources", () => {
  assert.deepEqual(metadataField({ Title: "Old title" }, xmp({ "dc:title": "New title" }), "Title", "dc:title"), {
    value: "New title", source: "XMP", xmpValue: "New title", infoValue: "Old title", conflict: true,
  });
  assert.equal(metadataField({ Title: " Same  title " }, xmp({ "dc:title": "Same title" }), "Title", "dc:title").conflict, false);
  assert.equal(metadataField({ Title: "Fallback" }, null, "Title", "dc:title").source, "PDF Info");
  assert.equal(metadataField({}, null, "Title", "dc:title").conflict, false);
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
