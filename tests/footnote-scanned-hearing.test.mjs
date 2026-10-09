import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendFootnotesForPage } from "../src/viewer/navigation/footnote-index.js";

// Original OCR geometry, including scan tilt and raster-only separator lines.
const pages = JSON.parse(readFileSync(new URL("./fixtures/footnotes-1973-hearing.json", import.meta.url)));

test("scanned hearing recovers the flattened label and full tilted note paragraph", () => {
  const notes = [];
  let previous;
  for (const page of pages) {
    const viewport = { width: page.width, height: page.height,
      convertToViewportPoint: (x, y) => [x, page.height - y] };
    appendFootnotesForPage(notes, page.items, viewport, page.n, { fnArray: [], argsArray: [] }, undefined, previous);
    previous = { items: page.items, viewport };
  }
  assert.deepEqual(notes.map(note => [note.number, note.pageNumber]), [[1, 181]]);
  assert.equal(notes[0].text, "The 60-day period with which the Commission is required to act with regard to clearing agencies is unduly short in view of the fact that the notice of filing must be sent out for public comment. Since the Commission must prepare a release announcing the filing, await comments on the filing, and analyze these comments, we suggest that the Commission be allowed 120 days to act on the case of clearing agencies.");
  assert.ok(notes[0].highlightRegions.every(region => region.pageNumber === 181 && region.top > 0.87 && region.top < 0.93));
});

test("current-page lookup finds the complete scan note without decoding other pages", async () => {
  const { default: vm } = await import("node:vm");
  const source = readFileSync(new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url), "utf8");
  const context = vm.createContext({ appendFootnotesForPage, pageCache: new Map(), lookupRequestId: 1 });
  vm.runInContext(source.slice(source.indexOf("async function pageData("), source.indexOf("function scrollToTarget(")), context);
  const page = pages.find(page => page.n === 181);
  const pdf = { numPages: 532, async getPage(number) {
    assert.equal(number, 181);
    return { getTextContent: async () => ({ items: page.items }), getViewport: () => ({
      width: page.width, height: page.height, convertToViewportPoint: (x, y) => [x, page.height - y] }),
    getOperatorList() { throw new Error("Drawing data should not be decoded"); } };
  } };
  const note = await context.findFootnoteTarget(pdf, 1, 181, 1);
  assert.equal(note.pageNumber, 181);
  assert.equal(note.continues, false);
  assert.match(note.text, /allowed 120 days/);
});
