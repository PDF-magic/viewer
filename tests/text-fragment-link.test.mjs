import assert from "node:assert/strict";
import test from "node:test";
import {
  pdfTextFragmentFromUrl,
  pdfTextFragmentUrl,
  textFragmentExcerpt,
} from "../src/viewer/sharing/text-fragment.js";

test("copies a source PDF URL with page and text fragment", () => {
  const url = pdfTextFragmentUrl("https://example.org/report.pdf?draft=2#page=1", "Direct   Registration\nSystem", 12);
  assert.equal(url, "https://example.org/report.pdf?draft=2#page=12:~:text=Direct%20Registration%20System");
  assert.deepEqual(pdfTextFragmentFromUrl(url), { text: "Direct Registration System", pageNumber: 12 });
});

test("escapes punctuation reserved by the text-fragment grammar", () => {
  const url = pdfTextFragmentUrl("https://example.org/a.pdf", "trade-off, equity & (custody)", 3);
  assert.match(url, /trade%2Doff%2C%20equity%20%26%20%28custody%29/);
  assert.equal(pdfTextFragmentFromUrl(url).text, "trade-off, equity & (custody)");
});

test("supports text-only fragments without a page", () => {
  const url = pdfTextFragmentUrl("https://example.org/a.pdf", "exact phrase");
  assert.equal(url, "https://example.org/a.pdf#:~:text=exact%20phrase");
  assert.deepEqual(pdfTextFragmentFromUrl(url), { text: "exact phrase", pageNumber: null });
});

test("abbreviates long selections at a word boundary", () => {
  const excerpt = textFragmentExcerpt("first " + "word ".repeat(80));
  assert.ok(excerpt.length <= 180);
  assert.ok(excerpt.startsWith("first word"));
  assert.ok(excerpt.endsWith("word"));
});

test("rejects empty, malformed or non-linkable input", () => {
  assert.equal(pdfTextFragmentUrl("https://example.org/a.pdf", "  ", 1), null);
  assert.equal(pdfTextFragmentUrl("not a URL", "test", 1), null);
  assert.equal(pdfTextFragmentUrl("javascript:alert(1)", "test", 1), null);
  assert.equal(pdfTextFragmentFromUrl("https://example.org/a.pdf#page=5"), null);
  assert.equal(pdfTextFragmentFromUrl("https://example.org/a.pdf#:~:text=%E0%A4%A"), null);
});

test("allows local PDFs while retaining the original file path", () => {
  assert.equal(pdfTextFragmentUrl("file:///Users/me/archive.pdf", "hello", 2),
    "file:///Users/me/archive.pdf#page=2:~:text=hello");
});
