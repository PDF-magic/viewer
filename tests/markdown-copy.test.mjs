import assert from "node:assert/strict";
import test from "node:test";
import { fontTraits, markdownFromRuns, markPdfTextStyles, selectionToMarkdown, installMarkdownCopy } from "../src/viewer/selection/markdown-copy.js";

test("identifies original PDF font styles rather than PDF.js aliases", () => {
  assert.deepEqual(fontTraits({ name: "ABCDEF+TimesNewRomanPS-BoldItalicMT" }), { bold: true, italic: true });
  assert.deepEqual(fontTraits({ name: "Helvetica-Oblique" }), { bold: false, italic: true });
  assert.deepEqual(fontTraits({ name: "Times-Roman" }), { bold: false, italic: false });
  assert.deepEqual(fontTraits(null, { fontFamily: "serif" }), { bold: false, italic: false });
});

test("serializes mixed italic and bold text with underscores and stars", () => {
  assert.equal(markdownFromRuns([
    { text: "The " }, { text: "important", italic: true }, { text: " ", italic: true },
    { text: "finding", italic: true }, { text: " was " }, { text: "confirmed", bold: true },
    { text: "." },
  ]), "The _important finding_ was **confirmed**.");
});

test("escapes literal Markdown delimiters inside bold italic runs", () => {
  assert.equal(markdownFromRuns([{ text: " *result_[1]* ", italic: true, bold: true }]),
    "**_\\*result\\_\\[1\\]\\*_**");
});

test("retains boundaries between PDF lines and pages", () => {
  assert.equal(markdownFromRuns([
    { text: "first" }, { text: "second", newLine: true }, { text: "third", newPage: true },
  ]), "first\nsecond\n\nthird");
});

test("annotates only PDF.js text spans and tolerates unknown fonts", () => {
  const spans = [{ dataset: {} }, { dataset: {} }, { dataset: {} }];
  const fonts = { g_d0_f1: { name: "Helvetica-Bold" }, g_d0_f2: { name: "Times-Italic" } };
  markPdfTextStyles({ commonObjs: { get(name) { if (!(name in fonts)) throw Error("Font missing"); return fonts[name]; } } }, {
    items: [
      { str: "Good", fontName: "g_d0_f1" },
      { type: "beginMarkedContent" },
      { str: "news", fontName: "g_d0_f2", hasEOL: true },
      { str: "!", fontName: "unknown" },
    ], styles: {},
  }, spans);
  assert.deepEqual(spans.map(span => span.dataset), [
    { markdownItem: "true", markdownBold: "true" },
    { markdownItem: "true", markdownItalic: "true", markdownEol: "true" },
    { markdownItem: "true" },
  ]);
});

test("copies only a partial selection and leaves native copy untouched when disabled", () => {
  const page = {};
  const layer = { };
  const text = { textContent: "interesting", parentElement: layer };
  layer.closest = selector => selector === ".text-layer" ? layer : null;
  const span = { dataset: { markdownItem: "true", markdownItalic: "true" },
    closest: selector => selector === ".page" ? page : null };
  const selection = {
    isCollapsed: false, rangeCount: 1, anchorNode: text, focusNode: text,
    getRangeAt: () => ({
      intersectsNode: node => node === text,
      startContainer: text, startOffset: 0, endContainer: text, endOffset: 8,
    }),
  };
  const root = { contains: element => element === layer, querySelectorAll: () => [span] };
  const doc = {
    createTreeWalker: () => ({ nextNode() { if (this.done) return false; this.done = true; this.currentNode = text; return true; } }),
    getSelection: () => selection,
    addEventListener(type, handler) { assert.equal(type, "copy"); this.onCopy = handler; },
  };
  const oldNodeFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  try {
    assert.equal(selectionToMarkdown(root, selection, doc), "_interest_");
    const toggle = { checked: false };
    installMarkdownCopy(root, toggle, doc);
    let prevented = false;
    const written = {};
    const event = {
      clipboardData: { setData(type, value) { written[type] = value; } },
      preventDefault() { prevented = true; },
    };
    doc.onCopy(event);
    assert.equal(prevented, false);
    toggle.checked = true;
    doc.onCopy(event);
    assert.equal(written["text/plain"], "_interest_");
    assert.equal(written["text/markdown"], "_interest_");
    assert.equal(prevented, true);
    assert.equal(selectionToMarkdown(root, { ...selection, anchorNode: {} }, doc), null);
  } finally {
    if (oldNodeFilter === undefined) delete globalThis.NodeFilter;
    else globalThis.NodeFilter = oldNodeFilter;
  }
});
