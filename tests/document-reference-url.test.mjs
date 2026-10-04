import assert from "node:assert/strict";
import test from "node:test";

import { referenceUrlFromPdfMetadata } from "../src/viewer/document-reference-url.js";

test("prefers the XMP href tag over legacy document-info metadata", () => {
  assert.equal(
    referenceUrlFromPdfMetadata(
      { Custom: { PDFMagicSourceURL: "https://example.com/legacy.pdf" } },
      { get: (key) => key === "pdfmagic:href" ? "https://example.com/source.pdf?x=1&y=2" : null },
    ),
    "https://example.com/source.pdf?x=1&y=2",
  );
});

test("falls back to legacy metadata when the XMP href tag is invalid", () => {
  assert.equal(
    referenceUrlFromPdfMetadata(
      { Custom: { PDFMagicSourceURL: "https://example.com/legacy.pdf" } },
      { get: () => "not a URL" },
    ),
    "https://example.com/legacy.pdf",
  );
});

test("prefers the PDF Magic document-info source URL", () => {
  assert.equal(
    referenceUrlFromPdfMetadata(
      { Custom: { PDFMagicSourceURL: "https://example.com/original.pdf?download=1" } },
      null,
    ),
    "https://example.com/original.pdf?download=1",
  );
});

test("accepts a PDF Magic XMP source URL fallback", () => {
  const metadata = {
    get(key) {
      return key === "pdfmagic:sourceurl" ? "https://example.com/source.pdf" : null;
    },
  };

  assert.equal(
    referenceUrlFromPdfMetadata(
      { Custom: { PDFMagicSourceURL: "not a URL" } },
      metadata,
    ),
    "https://example.com/source.pdf",
  );
});

test("returns null when document metadata has no usable reference URL", () => {
  assert.equal(referenceUrlFromPdfMetadata({ Custom: {} }, null), null);
});
