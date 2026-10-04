import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { footnotesForPage } from "../src/viewer/navigation/footnote-index.js";

const source = readFileSync(new URL("../src/viewer/navigation/document-scrubber.js", import.meta.url), "utf8");
const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y] };
const item = (str, height, x, y) => ({ str, height, transform: [1, 0, 0, height, x, y] });
const body = [item("Body text", 12, 60, 200), item("More body text", 12, 60, 300), item("Body continues", 12, 60, 400)];
const noteItems = [...body, item("7", 8, 60, 660), item("First note text", 8, 80, 660), item("Continued citation", 8, 60, 676), item("42 Second note text", 8, 60, 704), item("9", 10, 300, 760)];

test("index extracts note numbers and text, excluding footer page numbers", () => {
  const notes = footnotesForPage(noteItems, viewport, 9);
  assert.deepEqual(notes.map(({ number }) => number), [7, 42]);
  assert.equal(notes[0].text, "First note text Continued citation");
  assert.equal(notes[1].text, "Second note text");
  assert.equal(notes[1].pageNumber, 9);
});

test("ordinary numbered paragraphs and page counters do not create notes", () => {
  assert.deepEqual(footnotesForPage([...body, item("1 A numbered paragraph", 12, 60, 700), item("2", 10, 300, 760)], viewport, 2), []);
});

async function loadScrubber(pages) {
  const elements = new Map();
  const jumps = [];
  const frames = [];
  const properties = {};
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, value: "1", clientWidth: 600, listeners: {}, attributes: {},
      style: { setProperty: (key, value) => { properties[key] = value; } },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect: () => ({ height: 28, width: 600, left: 0 }),
    });
    return elements.get(selector);
  }
  const context = vm.createContext({
    document: { querySelector: element, documentElement: element("root"), elementFromPoint: () => null },
    window: { addEventListener() {}, innerHeight: 800, innerWidth: 1000 },
    pdfDocumentSessionReady: Promise.resolve({ document: {
      numPages: pages.length,
      getPage: async (number) => ({ getTextContent: async () => ({ items: pages[number - 1] }), getViewport: () => viewport }),
    } }),
    footnotesForPage, scrollToTarget: (note) => jumps.push(note),
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    setTimeout: (callback) => { callback(); }, console,
  });
  vm.runInContext(source.replace(/^import .*$/gm, "").replace("void initializeScrubber();", "globalThis.ready = initializeScrubber();"), context);
  await context.ready;
  return { element, jumps, frames, properties };
}

test("scrubber stays hidden and reserves no space on documents without footnotes", async () => {
  const { element, properties } = await loadScrubber([body, body]);
  assert.equal(element("#document-scrubber").hidden, true);
  assert.equal(properties["--document-scrubber-height"], undefined);
});

test("slider counts note occurrences and navigates to their page and vertical position", async () => {
  const { element, jumps, frames, properties } = await loadScrubber([body, noteItems, body]);
  const range = element("#document-scrubber-range");
  assert.equal(element("#document-scrubber").hidden, false);
  assert.equal(range.max, "2");
  assert.equal(properties["--document-scrubber-height"], "28px");
  range.value = "2";
  range.listeners.input();
  while (frames.length) frames.shift()();
  assert.equal(jumps[0].number, 42);
  assert.equal(jumps[0].pageNumber, 2);
  assert.equal(jumps[0].yRatio, 704 / 800);
  assert.equal(element("#document-scrubber-current").textContent, "42");
  assert.match(element("#document-scrubber-preview").textContent, /Second note text/);
});
