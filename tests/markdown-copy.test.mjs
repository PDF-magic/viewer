import assert from "node:assert/strict";
import test from "node:test";
import { fontTraits, hasPdfWordGap, markdownFromRuns, markPdfTextStyles, selectionToMarkdown, installMarkdownCopy } from "../src/viewer/selection/markdown-copy.js";

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


test("recovers whitespace before italic runs from PDF text geometry", () => {
  const item = (str, x, width, options = {}) => ({
    str, width, height: 10, dir: "ltr", transform: [10, 0, 0, 10, x, 100], ...options,
  });
  const plain = item("investing is", 100, 55, { fontName: "plain" });
  const italic = item("much too complex", 158, 89, { fontName: "italic" });
  const continued = item(" or requires a ", 247, 80, { fontName: "plain" });
  const spans = [{ dataset: {} }, { dataset: {} }, { dataset: {} }];
  markPdfTextStyles({ commonObjs: { get(name) {
    return { name: name === "italic" ? "Times-Italic" : "Times-Roman" };
  } } }, { items: [plain, italic, continued], styles: {} }, spans);
  assert.equal(spans[1].dataset.markdownSpaceBefore, "true");
  assert.equal(spans[2].dataset.markdownSpaceBefore, undefined);
  assert.equal(markdownFromRuns([
    { text: plain.str },
    { text: italic.str, italic: true, spaceBefore: spans[1].dataset.markdownSpaceBefore === "true" },
    { text: continued.str },
    { text: "full-time commitment,", italic: true },
  ]), "investing is _much too complex_ or requires a _full-time commitment,_");
});

test("does not add spaces within words, before punctuation, or over existing whitespace", () => {
  const item = (str, x, width, options = {}) => ({
    str, width, height: 10, dir: "ltr", transform: [10, 0, 0, 10, x, 100], ...options,
  });
  assert.equal(hasPdfWordGap(item("pre", 100, 13), item("fix", 113, 12)), false);
  assert.equal(hasPdfWordGap(item("end", 100, 16), item(".", 116, 3)), false);
  assert.equal(hasPdfWordGap(item("is ", 100, 14), item("much", 114, 23)), false);
  assert.equal(markdownFromRuns([{ text: "is " }, { text: "much", italic: true, spaceBefore: true }]), "is _much_");
  assert.equal(markdownFromRuns([{ text: "pre" }, { text: "fix", italic: true }]), "pre_fix_");
});

test("handles rotated text but ignores baseline changes and existing line breaks", () => {
  const rotated = (str, y, width) => ({
    str, width, height: 10, dir: "ltr", transform: [0, 10, -10, 0, 100, y],
  });
  const plain = { str: "is", width: 9, height: 10, dir: "ltr", transform: [10, 0, 0, 10, 100, 100] };
  assert.equal(hasPdfWordGap(rotated("is", 100, 9), rotated("much", 112, 20)), true);
  assert.equal(hasPdfWordGap(plain, { ...plain, str: "much", transform: [10, 0, 0, 10, 113, 120] }), false);
  assert.equal(hasPdfWordGap({ ...plain, hasEOL: true }, { ...plain, str: "much", transform: [10, 0, 0, 10, 113, 100] }), false);
  assert.equal(markdownFromRuns([
    { text: "It is", role: "P", block: "2" },
    { text: "rather than research or trade", italic: true, spaceBefore: true,
      newLine: true, role: "P", block: "2" },
  ]), "It is _rather than research or trade_");
});

async function copyPetitionSelection(pageNumber, start, end, options = {}) {
  const { readFileSync } = await import("node:fs");
  const { appendFootnotesForPage } = await import("../src/viewer/navigation/footnote-index.js");
  const pages = JSON.parse(readFileSync(new URL("./fixtures/footnotes-sta-petition.json", import.meta.url)));
  const viewport = page => ({
    width: page.width, height: page.height,
    convertToViewportPoint: (x, y) => [x, page.height - y],
  });
  const operators = page => ({ fnArray: [], argsArray: page.rules.map(rule =>
    [null, [[0]], [rule.x, page.height - rule.y, rule.x + rule.width, page.height - rule.y]]) });
  const footnotes = [];
  let previousPageText;
  for (const page of pages.slice(0, pageNumber)) {
    appendFootnotesForPage(footnotes, page.items, viewport(page), page.n,
      operators(page), undefined, previousPageText);
    previousPageText = { items: page.items, viewport: viewport(page) };
  }

  const layer = { closest: selector => selector === ".text-layer" ? layer : null };
  const spans = [];
  const includedNodes = new Set();
  for (const page of pages.slice(pageNumber - 1, pageNumber)) {
    const pageElement = { dataset: { page: String(page.n) } };
    const textItems = page.items.filter(item => typeof item.str === "string");
    const pageSpans = textItems.map((item, index) => {
      const node = { textContent: item.str, parentElement: layer };
      const span = { node, dataset: {},
        closest: selector => selector === ".page" ? pageElement : null };
      const include = index >= start && index <= end;
      if (include && item.str) includedNodes.add(node);
      return span;
    });
    markPdfTextStyles({ getViewport: () => viewport(page) },
      { items: page.items, styles: {} }, pageSpans);
    spans.push(...pageSpans);
  }
  const selection = {
    isCollapsed: false, rangeCount: 1,
    anchorNode: [...includedNodes][0], focusNode: [...includedNodes].at(-1),
    getRangeAt: () => ({ intersectsNode: node => includedNodes.has(node),
      startContainer: null, endContainer: null }),
  };
  const doc = { createTreeWalker(span) {
    return { nextNode() {
      if (this.done) return false;
      this.done = true; this.currentNode = span.node; return true;
    } };
  } };
  const root = { contains: element => element === layer, querySelectorAll: () => spans };
  const oldNodeFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  try {
    return selectionToMarkdown(root, selection, doc, { footnotes, ...options });
  } finally {
    if (oldNodeFilter === undefined) delete globalThis.NodeFilter;
    else globalThis.NodeFilter = oldNodeFilter;
  }
}

test("separates scanned SEC petition footnote 11 from body text on the same page", async () => {
  const output = await copyPetitionSelection(5, 35, 65);
  assert.match(output, /transfer agents\.\[11\]/);
  assert.match(output, /The relationship between a transfer agent and DTC is commercial in nature/);
  assert.match(output, /transfer agents\.\[11\]\n\n\[11\]:/);
  assert.doesNotMatch(output, /develop policies, oversee/);
  assert.match(output, /organization it also may adopt/);
  assert.match(output, /take disciplinary action against/);
  assert.match(output, /\[11\]: In fact, immobilization of securities/);
  assert.ok(output.indexOf("[11]: In fact") < output.indexOf("DTC is subject"));
  assert.equal(output.slice(0, output.indexOf("[11]:")).includes("In fact, immobilization"), false);
});

test("preserves page boundaries rather than guessing continuity from nearby footnotes", () => {
  assert.equal(markdownFromRuns([
    { text: "develop" },
    { text: "policies", newPage: true, joinPreviousPage: true },
  ]), "develop\n\npolicies");
});

test("includes unselected note 12 immediately after its citing paragraph", async () => {
  const output = await copyPetitionSelection(6, 20, 42);
  assert.match(output, /Direct Registration System\.\[12\] DRS permits/);
  assert.match(output, /transfer agent\.\s*\n\n\[12\]: See, e\.g\., NASDAQ Rule 4350\(l\); Section 501\.00 of the NYSE Listed Company Manual\.\n\nTransfer agents/);
  assert.equal((output.match(/\[12\]:/g) || []).length, 1);
  assert.doesNotMatch(output, /\[\^12\]/);
});

test("includes a note for a partial paragraph selection and avoids duplicate selected definitions", async () => {
  const partial = await copyPetitionSelection(6, 26, 31);
  assert.match(partial, /System\.\[12\]/);
  assert.match(partial, /\n\n\[12\]: See, e\.g\., NASDAQ/);
  const selectedNote = await copyPetitionSelection(6, 20, 54);
  assert.equal((selectedNote.match(/\[12\]:/g) || []).length, 1);
  const withoutReference = await copyPetitionSelection(6, 34, 42);
  assert.doesNotMatch(withoutReference, /\[12\]/);
  const plain = await copyPetitionSelection(6, 20, 32, { markdown: false });
  assert.equal(plain, null);
});
