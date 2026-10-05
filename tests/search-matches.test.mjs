import assert from "node:assert/strict";
import test from "node:test";
import { findSearchMatches } from "../src/viewer/search/search-matches.js";

for (const leading of [14, 24]) {
  test(`wrapped and paragraph-spaced text remain searchable with ${leading}-point leading`, () => {
    const item = (str, y) => ({ str, height: 12, transform: [12, 0, 0, 12, 72, y], hasEOL: true });
    const items = [item("First wrapped", 700), item("line ends", 700 - leading),
      item("Second paragraph", 700 - leading * 2 - 12),
      item("continues here", 700 - leading * 3 - 12)];
    assert.equal(findSearchMatches(items, "wrapped line").length, 1);
    assert.equal(findSearchMatches(items, "ends Second").length, 1);
    assert.equal(findSearchMatches(items, "ends\n\n    Second paragraph").length, 1);
    assert.equal(findSearchMatches(items, "paragraph continues").length, 1);
    assert.deepEqual(findSearchMatches(items, "paragraph continues")[0].ranges,
      [{ itemIndex: 2, start: 7, end: 16 }, { itemIndex: 3, start: 0, end: 9 }]);
  });
}

test("multiline occurrences keep the source ranges for every matching line", () => {
  const items = [{ str: "Market structure", hasEOL: true }, { str: "reform continues." },
    { str: "Market structure reform" }];
  const matches = findSearchMatches(items, "structure\nreform");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(match => match.ordinal), [0, 1]);
  assert.deepEqual(matches[0].ranges, [
    { itemIndex: 0, start: 7, end: 16 }, { itemIndex: 1, start: 0, end: 6 },
  ]);
  assert.deepEqual(matches[1].ranges, [{ itemIndex: 2, start: 7, end: 23 }]);
});

test("normalization maps ligatures and collapsed whitespace to original text", () => {
  const items = [{ str: "The ofﬁce\t\t rules" }];
  const [match] = findSearchMatches(items, "OFFICE rules");
  const [range] = match.ranges;
  assert.equal(items[0].str.slice(range.start, range.end), "ofﬁce\t\t rules");
});

test("wrapped URLs highlight all source fragments", () => {
  const items = [{ str: "See https://example.com/", hasEOL: true }, { str: "long-" }, { str: "document.pdf" }];
  const [match] = findSearchMatches(items, "https://example.com/long-document.pdf");
  assert.deepEqual(match.ranges.map(range => items[range.itemIndex].str.slice(range.start, range.end)),
    ["https://example.com/", "long-", "document.pdf"]);
});

test("separate normalized matches can refer to the same original ligature", () => {
  const matches = findSearchMatches([{ str: "ﬀ" }], "f");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0].ranges, matches[1].ranges);
});
