import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rawMetadataSections } from "../src/viewer/raw-metadata.js";

const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
test("raw metadata follows Rotate right in the ⋯ menu, independent of Sections", () => {
  const menu = html.slice(html.indexOf('id="tools-menu"'), html.indexOf('id="print-pdf"'));
  assert.ok(menu.indexOf('id="view-raw-metadata"') > menu.indexOf('id="rotate-right"'));
  assert.ok(menu.indexOf('id="view-raw-metadata"') < menu.indexOf('class="menu-separator"'));
  assert.match(html, /id="raw-metadata-dialog"/);
  assert.match(viewer, /installRawMetadataViewer\(pdfDocument/);
});
test("raw view preserves Info values, custom XMP, original XMP XML", () => {
  const xml = "<x:xmpmeta>RAW</x:xmpmeta>";
  const value = rawMetadataSections({
    info: { Title: " Raw  ", CreationDate: "D:20090101000000Z", Custom: 42 },
    metadata: { getAll: () => ({ "dc:title": "XMP", "custom:field": "value" }), getRaw: () => xml },
    contentLength: 22,
  });
  assert.deepEqual(value.map(x => x.title), ["PDF Info dictionary", "XMP parsed fields", "Raw XMP XML", "PDF response metadata"]);
  assert.match(value[0].text, /"Title": " Raw  "/);
  assert.match(value[1].text, /"custom:field"/);
  assert.equal(value[2].text, xml);
});
test("metadata action is absent when there are only PDF.js derived properties", () => {
  assert.deepEqual(rawMetadataSections({ info: { PDFFormatVersion: "1.7", IsLinearized: false }, contentLength: 10 }), []);
  assert.deepEqual(rawMetadataSections(null), []);
});
test("malformed XMP cannot conceal useful PDF Info", () => {
  const result=rawMetadataSections({ info: { Author: "Legacy" }, metadata: { getAll() { throw Error(); }, getRaw() { throw Error(); } } });
  assert.equal(result.length, 1);
  assert.match(result[0].text, /Legacy/);
});
