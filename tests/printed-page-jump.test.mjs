import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
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

test("clicking total page count requests the final physical page", () => {
  const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/viewer/navigation/page-number-input.js", import.meta.url), "utf8");
  assert.match(html, /<button id="page-count" type="button" aria-label="Go to last page"/);
  assert.match(html, /id="page-number"[^>]*aria-label="Current page"/);
  assert.match(css, /#page-count:focus-visible/);

  const handlers = {};
  const changes = [];
  let selected = false;
  const input = {
    max: "", value: "2",
    addEventListener(type, fn) { handlers[type] = fn; },
    select() { selected = true; },
    dispatchEvent(event) { changes.push([event.type, event.bubbles, this.value]); },
  };
  const button = { addEventListener(type, fn) { handlers["count:" + type] = fn; } };
  runInNewContext(script, {
    document: { querySelector(id) { return id === "#page-number" ? input : id === "#page-count" ? button : null; } },
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
  });

  handlers["count:click"]();
  assert.equal(input.value, "2");
  assert.equal(changes.length, 0);
  input.max = "9";
  handlers["count:click"]();
  assert.equal(input.value, "9");
  assert.deepEqual(changes, [["change", true, "9"]]);
  handlers.click();
  assert.ok(selected, "the current page is still selectable");
});

test("compact two-row search ends beside Sweetie Bot instead of leaving a large gap", () => {
  const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.css", import.meta.url), "utf8");
  const viewerCss = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
  const toolbarScript = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.js", import.meta.url), "utf8");

  assert.match(toolbarScript, /TOOLBAR_ROW_BREAKPOINT\s*=\s*900/);
  assert.match(html, /class="search-tools"[\s\S]*?id="search-input"[\s\S]*?class="search-actions"[\s\S]*?id="summarize-chatgpt"/);

  const twoRow = layout.match(/:where\(:root\.toolbar-two-rows\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(twoRow, "the narrow layout must retain its second toolbar row");
  const search = twoRow.match(/  \.search-tools\s*\{([^}]*)\}/)?.[1];
  const actions = twoRow.match(/  \.search-actions\s*\{([^}]*)\}/)?.[1];
  assert.ok(search && actions);
  assert.match(search, /top:\s*56px;/);
  assert.match(search, /left:\s*8px;/);
  assert.match(search, /width:\s*auto;/);
  assert.match(actions, /top:\s*56px;/);
  const searchRightInset = Number(search.match(/right:\s*(\d+)px;/)?.[1]);
  const buttonRightInset = Number(actions.match(/right:\s*(\d+)px;/)?.[1]);
  const markButton = viewerCss.match(/\.mark-button\s*\{([^}]*)\}/)?.[1];
  const buttonWidth = Number(markButton?.match(/width:\s*(\d+)px;/)?.[1]);
  assert.equal(buttonWidth, 30, "Sweetie Bot uses the shared mark-button width");

  for (const width of [320, 500, 720, 900]) {
    const searchRightEdge = width - searchRightInset;
    const sweetieLeftEdge = width - buttonRightInset - buttonWidth;
    assert.equal(sweetieLeftEdge - searchRightEdge, 8, `search/Sweetie spacing at ${width}px`);
    assert.ok(searchRightEdge > 8 + buttonWidth + 8 + 40, "search field remains usable");
  }
});
