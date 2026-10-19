import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filterOutlineHeadings, looksLikeBookmarkData } from "../src/viewer/navigation/outline-filter.js";

const leaf = title => ({ title, dest: [0], items: [] });

test("spreadsheet identifiers in original FCIC exhibit bookmarks are not section headings", () => {
  const names = ["Stock_Chart", "C_chart_rate", "Top15_bearish", "Summary_Table_ALL", "aurelius",
    "barclays", "data2", "rankdat", "tab_sharecode", "chart_sep2", "ods_chart_bigrun 62",
    "C_chart", "Goldman Sachs Chart"];
  const result = filterOutlineHeadings([{ title: "SEC_OEA_FCIC_001853", dest: [0], items: names.map(leaf) }]);
  assert.equal(result.hidden, names.length);
  assert.deepEqual(result.outline.map(item => item.title), ["SEC_OEA_FCIC_001853"]);
  assert.deepEqual(result.outline[0].items, []);
});

test("numeric table cells are removed while true headings and their source positions remain", () => {
  const names = ["Short Selling in Initial Public Offerings", "1. Introduction", "Table 1",
    "Summary Statistics on IPOs", "Variable", "Mean", "Median", "$14.82", "14.50",
    "0.04%", "(0.29%)", "9.41%", "85", "109", "97", "97", "Figure 1", "Figure 2"];
  const result = filterOutlineHeadings([{ title: "SEC_OEA_FCIC_002450 - 002501", dest: [0], items: names.map(leaf) }]);
  assert.deepEqual(result.outline[0].items.map(item => item.title), [
    "Short Selling in Initial Public Offerings", "1. Introduction", "Table 1", "Figure 1", "Figure 2",
  ]);
  assert.equal(result.outline[0].items[2].pdfMagicSourcePosition, 3);
  assert.equal(result.hidden, names.length - 5);
});

test("short or human-authored outlines are unchanged even if they have generic words", () => {
  for (const names of [
    ["Agenda", "Data Sources", "General", "Background", "Results"],
    ["C_chart", "Mean", "Agenda"],
    ["1. Introduction", "2. Methodology", "3. Findings"],
  ]) {
    const result = filterOutlineHeadings(names.map(leaf));
    assert.equal(result.hidden, 0);
    assert.deepEqual(result.outline.map(item => item.title), names);
  }
  assert.equal(looksLikeBookmarkData("Variable"), true);
  assert.equal(looksLikeBookmarkData("3. Settlement timing"), false);
});

test("viewer provides access to all original PDF bookmarks", () => {
  const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  assert.match(viewer, /filterOutlineHeadings\(outline\)/);
  assert.match(viewer, /showAllBookmarks \? sectionOriginalOutline : sectionFilteredOutline/);
  assert.match(markup, /id="section-bookmark-toggle"/);
});
