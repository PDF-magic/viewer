import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../src/viewer/navigation/document-scrubber.js", import.meta.url),
  "utf8",
);

test("document scrubber is a full-range bottom navigation control", () => {
  assert.match(markup, /id="document-scrubber"/);
  assert.match(markup, /id="document-scrubber-range"[\s\S]*type="range"/);
  assert.match(markup, /viewer\/navigation\/document-scrubber\.js/);
  assert.match(styles, /\.document-scrubber\s*{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*auto 0 0;/);
  assert.match(styles, /--scrubber-progress/);
});

test("document scrubber spans every page and jumps continuously while dragged", () => {
  assert.match(source, /totalPages\s*=\s*Math\.max\(1, session\.document\.numPages\)/);
  assert.match(source, /range\.max\s*=\s*String\(totalPages\)/);
  assert.match(source, /addEventListener\("input",\s*\(\)\s*=>\s*navigateToPage\(range\.value\)\)/);
  assert.match(source, /pageNumberInput\.dispatchEvent\(new Event\("change"/);
});

test("document scrubber tracks the page at the readable viewport center", () => {
  assert.match(source, /function pageAtViewportCenter\(\)/);
  assert.match(source, /elementFromPoint\(window\.innerWidth \/ 2, y\)/);
  assert.match(source, /window\.addEventListener\("scroll", scheduleTracking/);
});
