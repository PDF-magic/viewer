import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { confirmedPrintedPageLabels, parsePrintedPageCounter } from "../src/viewer/navigation/page-tab-labels.js";
import { createPageLabelIndex, matchingDocumentPageLabels } from "../src/viewer/navigation/printed-page-index.js";
import { printedPageShortcutQuery } from "../src/viewer/navigation/printed-page-shortcut.js";

const fixturePage = (footer) => ({
  getViewport() {
    return { width: 612, height: 792, convertToViewportPoint: (x, y) => [x, 792 - y] };
  },
  async getTextContent() {
    return { items: footer ? [{ str: footer, transform: [1, 0, 0, 10, 290, 40] }] : [] };
  },
});

function fakePdf(footers, labels = null) {
  const seen = [];
  return {
    numPages: footers.length,
    seen,
    async getPageLabels() { return labels; },
    async getPage(page) {
      seen.push(page);
      return fixturePage(footers[page - 1]);
    },
  };
}

test("printed page search uses PDF PageLabels, not physical page positions", async () => {
  const index = createPageLabelIndex(fakePdf([null, null, null, null, null], ["i", "ii", "1", "2", "A-1"]));
  await index.loadMetadata();
  assert.deepEqual(index.getLabels(), ["i", "ii", "1", "2", "A-1"]);
  assert.deepEqual(matchingDocumentPageLabels("1", index.getConfirmedLabels()), [3]);
  assert.deepEqual(matchingDocumentPageLabels("II", index.getConfirmedLabels()), [2]);
  assert.deepEqual(matchingDocumentPageLabels("a-1", index.getConfirmedLabels()), [5]);
  await index.scan();
});

test("on-demand scanning recognizes verified margin numbers after front matter", async () => {
  const pdf = fakePdf([null, "Page 1", "Page 2", "Page 3", null]);
  const index = createPageLabelIndex(pdf);
  await index.loadMetadata();
  assert.deepEqual(pdf.seen, [], "indexing is not eager");
  await index.scan();
  assert.deepEqual(index.getConfirmedLabels(), [null, "1", "2", "3", null]);
  assert.deepEqual(matchingDocumentPageLabels("2", index.getConfirmedLabels()), [3]);
  assert.deepEqual(matchingDocumentPageLabels("5", index.getConfirmedLabels()), []);
});

test("ambiguous restarted page numbers are returned in PDF order for cycling", async () => {
  const index = createPageLabelIndex(fakePdf([null, null, null, null], ["1", "2", "1", "2"]));
  await index.loadMetadata();
  assert.deepEqual(matchingDocumentPageLabels("1", index.getConfirmedLabels()), [1, 3]);
});

test("unknown printed pages do not become searchable PDF index guesses", () => {
  const labels = confirmedPrintedPageLabels(3, null, [
    parsePrintedPageCounter("31"), null, parsePrintedPageCounter("33"),
  ]);
  assert.deepEqual(labels, [null, null, null]);
  assert.deepEqual(matchingDocumentPageLabels("2", labels), []);
  assert.deepEqual(matchingDocumentPageLabels("007", ["7"]), [1]);
});

test("page tabs and printed lookup share a resumable scan, even with tabs hidden", async () => {
  const pdf = fakePdf(["Page 1", "Page 2", "Page 3", "Page 4"]);
  const index = createPageLabelIndex(pdf);
  let allow = 2;
  await index.scan(() => pdf.seen.length < allow);
  assert.deepEqual(pdf.seen, [1, 2]);
  await index.scan();
  assert.deepEqual(pdf.seen, [1, 2, 3, 4]);
  assert.deepEqual(index.getConfirmedLabels(), ["1", "2", "3", "4"]);
});

test("standalone printed page search is wired separately from the physical page field", () => {
  const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/viewer/navigation/printed-page-jump.js", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("../src/viewer/navigation/page-tabs.js", import.meta.url), "utf8");
  assert.match(html, /id="printed-page-jump"/);
  assert.match(html, /id="printed-page-number"/);
  assert.match(html, /viewer\/navigation\/printed-page-jump\.js/);
  assert.match(script, /pageIndex\.scan\(\)/);
  assert.match(script, /physicalPage\.dispatchEvent\(new Event\("change"/);
  assert.match(tabs, /pageLabelIndexReady/);
  const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  assert.match(viewer, /document.activeElement === document.querySelector\("#printed-page-number"\)/);
});

test("asterisk suffix requests printed labels rather than PDF page indices", () => {
  assert.equal(printedPageShortcutQuery("181*"), "181");
  assert.equal(printedPageShortcutQuery(" iv* "), "iv");
  assert.equal(printedPageShortcutQuery("A-2 *"), "A-2");
  assert.equal(printedPageShortcutQuery("181"), null);
  assert.equal(printedPageShortcutQuery("*"), "");
  assert.deepEqual(matchingDocumentPageLabels(printedPageShortcutQuery("181*"), ["1", "2", "181"]), [3]);
});

test("standalone printed search defaults off, but * uses the ordinary field", () => {
  const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.js", import.meta.url), "utf8");
  assert.match(html, /id="printed-page-jump"[^>]* hidden>/);
  assert.match(html, /id="printed-page-jump-opt-in"/);
  assert.match(html, /id="page-number"[^>]*inputmode="text"/);
  assert.match(css, /\.printed-page-control\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(settings, /apply\(localStorage\.getItem\(PRINTED_PAGE_JUMP_STORAGE_KEY\) === "true", false\)/);
  assert.match(settings, /form\.hidden = !enabled/);
  assert.match(viewer, /printedPageShortcutQuery\(pageNumberInput\.value\)/);
  assert.match(viewer, /"pdf-viewer-printed-page-request"/);
  const jump = readFileSync(new URL("../src/viewer/navigation/printed-page-jump.js", import.meta.url), "utf8");
  assert.match(jump, /addEventListener\("pdf-viewer-printed-page-request"/);
  assert.match(viewer, /"pdf-viewer-toast"/);
  assert.match(toolbar, /pageNumberInput\.value\.trim\(\)\.endsWith\("\*"\)/);
});
