import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url),
  "utf8",
);
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

function loadFootnoteHelpers() {
  const context = vm.createContext({
    document: {
      querySelector() {
        return null;
      },
    },
    Map,
    Math,
    Number,
    Promise,
    RegExp,
    String,
  });
  const runnableSource = (readFileSync(new URL("../src/viewer/navigation/footnote-index.js", import.meta.url), "utf8") + source).replace(/^import .*$/gm, "").replace(/^export \{.*$/gm, "").replace(/^export /gm, "");
  vm.runInContext(runnableSource, context);
  return context;
}

test("inline font fragments do not split a single-column footnote highlight", () => {
  const { footnotesForPage } = loadFootnoteHelpers();
  const viewport = { width: 612, height: 792, convertToViewportPoint: (x, y) => [x, y] };
  const item = (str, x, y, width, height = 12) => ({ str, width, height, transform: [1, 0, 0, height, x, y] });
  const items = [];
  for (let line = 0; line < 10; line++) {
    const y = 200 + line * 17;
    items.push(item("Body prefix", 72, y, 141), item("changed font", 216, y, 149),
      item("body suffix", 368, y, 170));
  }
  items.push(item("13", 72, 630, 7, 7), item("Interestingly, this happened despite", 82, 634, 169),
    item("substantive", 254, 634, 54), item("prevention planning in Section VI", 311, 634, 224),
    item("disclosure framework continues", 72, 651, 466),
    item("14", 72, 680, 7, 7), item("See another note.", 82, 684, 140));
  const notes = footnotesForPage(items, viewport, 6, [{ x: 72, y: 620, width: 240 },
    { x: 254, y: 635, width: 280 }, { x: 270, y: 652, width: 266 }]);
  const note = notes.find(note => note.number === 13);
  assert.match(note.text, /despite substantive prevention planning/);
  assert.equal(note.highlightRegions.length, 2);
  assert.ok(note.highlightRegions[0].left + note.highlightRegions[0].width > 0.87);
  assert.doesNotMatch(note.text, /another note/);
});

test("footnote navigation is exposed in the tools menu", () => {
  assert.match(markup, /id="footnote-jump"/);
  assert.match(markup, /id="footnote-number"/);
  assert.match(markup, /viewer\/navigation\/footnote-jump\.js/);
  assert.match(styles, /\.tool-footnote-jump/);
  assert.match(styles, /\.tool-footnote-status\[data-state="error"\]/);
});

test("footnote lookup prefers a lower-page note over body text and centered page numbers", () => {
  const { candidateForPage } = loadFootnoteHelpers();
  assert.equal(typeof candidateForPage, "function");

  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint(x, y) {
      return [x, y];
    },
  };
  const items = [
    { str: "12 ordinary numbered paragraph", height: 12, transform: [1, 0, 0, 12, 60, 280] },
    { str: "Body copy", height: 12, transform: [1, 0, 0, 12, 60, 320] },
    { str: "12", height: 10, transform: [1, 0, 0, 10, 300, 760] },
    { str: "12", height: 8, transform: [1, 0, 0, 8, 62, 690] },
    { str: "Footnote text continues here", height: 8, transform: [1, 0, 0, 8, 82, 690] },
  ];

  const candidate = candidateForPage(items, viewport, 12, 4, 4);
  assert.equal(candidate.pageNumber, 4);
  assert.equal(candidate.label, "12");
  assert.ok(candidate.xRatio < 0.2);
  assert.ok(candidate.yRatio > 0.8);
});

test("footnote lookup rejects a centered footer page number by itself", () => {
  const { candidateForPage } = loadFootnoteHelpers();
  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint(x, y) {
      return [x, y];
    },
  };
  const items = [
    { str: "Body copy", height: 12, transform: [1, 0, 0, 12, 60, 320] },
    { str: "12", height: 10, transform: [1, 0, 0, 10, 300, 760] },
  ];

  assert.equal(candidateForPage(items, viewport, 12, 4, 4), undefined);
});


test("footnote navigation scrolls once to the note without an intermediate page jump", () => {
  const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  const start = viewerSource.indexOf("function goToFootnote(");
  const end = viewerSource.indexOf("function showToast(", start);
  const events = [];
  const context = vm.createContext({
    pdfDocument: {},
    pageElements: [null, { getBoundingClientRect: () => ({ top: 10000, height: 1200 }) }],
    setCurrentPage: (pageNumber) => events.push({ pageNumber }),
    highlightFootnote() {},
    rotation: 0,
    document: { querySelector: (selector) => ({ getBoundingClientRect: () => ({ height: selector === ".toolbar" ? 52 : 28 }) }) },
    window: { innerHeight: 900, scrollY: 200, scrollTo: (options) => events.push(options) },
  });
  vm.runInContext(viewerSource.slice(start, end), context);
  context.goToFootnote({ pageNumber: 2, yRatio: 0.8 });
  assert.equal(events.length, 2);
  assert.equal(events[0].pageNumber, 2);
  assert.equal(events[1].top, 10698);
  assert.equal(events[1].behavior, "instant");
});
