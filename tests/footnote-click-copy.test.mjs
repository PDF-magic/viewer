import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { footnoteToMarkdown } from "../src/viewer/selection/markdown-copy.js";

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
