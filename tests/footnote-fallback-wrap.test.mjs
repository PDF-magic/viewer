import assert from "node:assert/strict";
import test from "node:test";
import { candidateForPage } from "../src/viewer/navigation/footnote-index.js";

// A condensed text-layer reproduction of NBER w9126, printed page 19:
// footnote 19 wraps to two hanging lines and a printed page counter follows.
const viewport = {
  width: 612, height: 792,
  convertToViewportPoint(x, y) { return [x, 792 - y]; },
};

function line(text, x, y, width, height = 11) {
  return { str: text, width, height, transform: [1, 0, 0, height, x, 792 - y] };
}

test("fallback footnote highlights every wrapped line, excluding the prior note and page number", () => {
  const items = [
    line("18 The miscellaneous category is omitted.", 90, 615, 275),
    line("from the regressions.", 71, 629, 140),
    line("19 Two firms reached agreement before the annual", 90, 652, 420),
    line("meeting; the statistical analysis is unchanged.", 71, 666, 410),
    line("The indicator remains one or zero.", 71, 680, 295),
    line("19", 301, 733, 12, 12),
  ];
  const note = candidateForPage(items, viewport, 19, 19, 19);
  assert.ok(note);
  assert.equal(note.highlightRegions.length, 3);
  assert.match(note.text, /statistical analysis is unchanged/);
  assert.match(note.text, /remains one or zero/);
  assert.doesNotMatch(note.text, /miscellaneous|regressions/);
  assert.ok(note.highlightRegions.every((region) => region.top > 0.8 && region.top < 0.9));
});

test("fallback footnote stops before an adjacent numbered note", () => {
  const items = [
    line("19 First note spans", 90, 652, 250),
    line("another line of text.", 71, 666, 210),
    line("20 Next footnote starts here.", 90, 681, 320),
  ];
  const note = candidateForPage(items, viewport, 19, 19, 19);
  assert.ok(note);
  assert.equal(note.highlightRegions.length, 2);
  assert.doesNotMatch(note.text, /Next footnote/);
});
