import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { footnoteToMarkdown } from "../src/viewer/selection/markdown-copy.js";
import { footnotesForPage } from "../src/viewer/navigation/footnote-index.js";

const source = readFileSync(
  new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url), "utf8",
).replace(/^import .*$/gm, "").replace(/^export .*$/gm, "");

function makeViewer({ enabled = true, noteText = "A [citation] with *emphasis*.",
    rejectClipboard = false } = {}) {
  const listeners = new Map();
  const events = [];
  const copied = [];
  const toggle = { checked: enabled };
  const note = {
    number: 12, pageNumber: 2, endPageNumber: 3, yRatio: 0.8,
    text: noteText, highlightRegions: [], continues: false,
  };
  const page = {
    async getTextContent() { return { items: [] }; },
    getViewport() { return { width: 612, height: 792 }; },
  };
  const pdfDocument = { numPages: 3, async getPage() { return page; } };
  const nodes = {
    "#page-number": { value: "2" }, "#copy-as-markdown": toggle,
  };
  const context = vm.createContext({
    document: { querySelector(selector) { return nodes[selector] ?? null; } },
    window: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      dispatchEvent(event) { events.push(event); },
    },
    CustomEvent: class { constructor(type, options) {
      this.type = type; this.detail = options.detail;
    } },
    navigator: { clipboard: { async writeText(value) {
      if (rejectClipboard) throw new Error("Denied");
      copied.push(value);
    } } },
    pdfDocumentSessionReady: Promise.resolve({ document: pdfDocument, operators: {} }),
    appendFootnotesForPage(index) { index.push(note); },
    candidateForPage() { return null; },
    footnoteToMarkdown, Map, Number, Promise, String,
  });
  vm.runInContext(source, context);
  const flush = async () => {
    // Allow the jump's PDF lookup, clipboard write, and toast to finish.
    for (let index = 0; index < 3; index += 1) await new Promise(setImmediate);
  };
  return {
    events, copied, toggle, listeners, flush,
    async click() {
      listeners.get("pdf-viewer-inline-footnote-jump")({ detail: { number: 12, originPage: 2 } });
      await flush();
    },
  };
}

test("formats recovered cross-page footnotes as escaped Markdown definitions", () => {
  assert.equal(footnoteToMarkdown({
    number: 12, text: "A [citation] with *emphasis*. Continued on the next page.",
  }), "[^12]: A \\[citation\\] with \\*emphasis\\*. Continued on the next page.");
  assert.equal(footnoteToMarkdown({ number: 12, text: "" }), null);
  assert.equal(footnoteToMarkdown({ number: 0, text: "No" }), null);
});

test("clicking an inline footnote reference copies its full Markdown definition when enabled", async () => {
  const viewer = makeViewer();
  await viewer.click();
  assert.deepEqual(viewer.copied, ["[^12]: A \\[citation\\] with \\*emphasis\\*."]);
  assert.equal(viewer.events.filter(event => event.type === "pdf-viewer-footnote-jump").length, 1);
  assert.ok(viewer.events.some(event => event.type === "pdf-viewer-toast" &&
    event.detail.message === "Copied footnote 12 as Markdown"));
});

test("disabled Markdown setting retains navigation without writing the clipboard", async () => {
  const viewer = makeViewer({ enabled: false });
  await viewer.click();
  assert.deepEqual(viewer.copied, []);
  assert.equal(viewer.events.filter(event => event.type === "pdf-viewer-footnote-jump").length, 1);
});

test("footnote lookup does not register a removed toolbar form listener", async () => {
  const viewer = makeViewer();
  assert.equal(viewer.listeners.has("form:submit"), false);
  await viewer.click();
  assert.equal(viewer.events.filter(event => event.type === "pdf-viewer-footnote-jump").length, 1);
});

test("unextractable notes never overwrite the clipboard", async () => {
  const viewer = makeViewer({ noteText: " " });
  await viewer.click();
  assert.deepEqual(viewer.copied, []);
  assert.ok(viewer.events.some(event => event.type === "pdf-viewer-toast" &&
    event.detail.message === "Footnote 12 has no extractable text to copy"));
  assert.equal(viewer.events.filter(event => event.type === "pdf-viewer-footnote-jump").length, 1);
});

test("clipboard failures do not block footnote navigation", async () => {
  const viewer = makeViewer({ rejectClipboard: true });
  await viewer.click();
  assert.deepEqual(viewer.copied, []);
  assert.ok(viewer.events.some(event => event.type === "pdf-viewer-toast" &&
    event.detail.message === "Could not copy footnote 12"));
});

test("SEC November 2007 TIC footnotes separate arithmetic-only note 13 from note 12", () => {
  // Reproduces the geometry of 2007-11.pdf page 173: the note 13 body
  // begins with a number, and the multiplication sign uses a smaller glyph.
  const height = 789;
  const viewport = { width: 612, height, convertToViewportPoint: (x, y) => [x, height - y] };
  const item = (str, x, y, size, width) => ({
    str, width, height: size, transform: [1, 0, 0, size, x, height - y],
  });
  const items = [
    item("The reporting burden is estimated", 75, 184, 12, 220),
    item("12", 298, 177, 6, 8),
    item("from industry discussions", 308, 184, 12, 190),
    item("The participants would make disclosures", 75, 270, 12, 275),
    item("13", 353, 263, 6, 8),
    item("per year.", 362, 270, 12, 80),
    item("12", 74, 487, 8, 10),
    item("Based on discussions with industry representatives", 110, 490, 12, 320),
    item("agreement six times a year, and others would do so seven times a year.", 74, 674, 12, 445),
    item("13", 74, 692, 8, 10),
    item("6.63", 110, 695, 12, 28),
    item("X", 142, 695, 8, 8),
    item("800 = 5,304.", 153, 695, 12, 78),
    item("13", 303, 747, 12, 13), // printed page number, not a note
  ];
  const notes = footnotesForPage(items, viewport, 173, [{ x: 74, y: 367, width: 300 }]);
  assert.deepEqual(notes.map(({ number }) => number), [12, 13]);
  assert.match(notes[0].text, /others would do so seven times a year\\.$/);
  assert.doesNotMatch(notes[0].text, /6\\.63|5,304/);
  assert.equal(notes[1].text, "6.63 X 800 = 5,304.");
  assert.ok(notes[0].highlightRegions.every(region => region.top + region.height < 687 / height));
  assert.ok(notes[1].highlightRegions.every(region => region.top > 680 / height));
});
