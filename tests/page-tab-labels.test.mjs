import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findPrintedPageCounter, mergedPageTabLabels, parsePrintedPageCounter,
} from "../src/viewer/navigation/page-tab-labels.js";

const viewerMarkup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const minimapSource = readFileSync(new URL("../src/viewer/navigation/minimap.js", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
const viewport = {
  width: 612, height: 792,
  convertToViewportPoint: (x, y) => [x, 792 - y],
};
const at = (text, x, pdfY) => ({ str: text, transform: [1, 0, 0, 10, x, pdfY] });
const c = (text, zone = "footer") => ({ ...parsePrintedPageCounter(text), zone });

test("preserves embedded PDF PageLabels including roman numerals, resets and prefixes", () => {
  assert.deepEqual(mergedPageTabLabels(5, ["i", "ii", "1", "2", "A-1"]), ["i", "ii", "1", "2", "A-1"]);
  assert.deepEqual(mergedPageTabLabels(2, ["1"]), ["1", "2"]);
});

test("finds printed marginal counters without interpreting ordinary text as pagination", () => {
  assert.deepEqual(findPrintedPageCounter([at("50", 280, 400), at("17", 310, 38)], viewport),
    { label: "17", number: 17, kind: "arabic", explicit: false, zone: "footer" });
  assert.equal(findPrintedPageCounter([at("33", 280, 400)], viewport), null);
  assert.equal(findPrintedPageCounter([at("2026 annual report", 210, 40)], viewport), null);
});

test("recognizes Page X of Y split across selectable PDF text spans", () => {
  assert.deepEqual(findPrintedPageCounter([
    at("Page", 245, 35), at("24", 281, 35), at("of", 301, 35), at("65", 320, 35),
  ], viewport), { label: "24", number: 24, kind: "arabic", explicit: true, zone: "footer" });
});

test("only trusts standalone counters backed by adjacent printed pagination", () => {
  assert.deepEqual(mergedPageTabLabels(6, null, [
    null, c("i"), c("ii"), c("1"), c("2"), c("73"),
  ]), ["1", "i", "ii", "1", "2", "6"]);
  assert.deepEqual(mergedPageTabLabels(3, null, [
    c("Page 20 of 30"), null, c("Page 22 of 30"),
  ]), ["20", "2", "22"]);
});

test("ignores implausible counters and supports literal Roman case", () => {
  for (const text of ["42nd Street", "Page 300 of 20", "IL", "2026-10-08"]) {
    assert.equal(parsePrintedPageCounter(text), null);
  }
  assert.equal(parsePrintedPageCounter("XIV")?.number, 14);
  assert.equal(parsePrintedPageCounter("XIV")?.label, "XIV");
});

test("right-side rail integrates with the viewer and persists its own preference", () => {
  assert.match(viewerMarkup, /id="page-tabs"[^>]*aria-label="Document pages"/);
  assert.match(viewerMarkup, /id="minimap-page-tabs-toggle"/);
  assert.match(viewerMarkup, /src="viewer\/navigation\/page-tabs\.js"/);
  assert.match(minimapSource, /localStorage\.setItem\(PAGE_TABS_STORAGE_KEY, String\(enabled\)\)/);
  assert.match(viewerSource, /pdf-viewer-page-changed/);
});

test("numbered page tabs expose an opt-in under More PDF tools", () => {
  assert.match(viewerMarkup, /id="tools-menu"[\\s\\S]*id="page-tabs-opt-in" class="checkbox-input" type="checkbox"/);
  assert.match(viewerMarkup, /id="minimap-page-tabs-toggle"[\\s\\S]*?hidden/);
  assert.match(minimapSource, /PAGE_TABS_OPT_IN_STORAGE_KEY = "pdf-viewer-page-tabs-opt-in"/);
  assert.match(minimapSource, /pageTabsOptedIn && storedPageTabs === "true"/);
});
